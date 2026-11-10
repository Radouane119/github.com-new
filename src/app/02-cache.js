// ---------------------------------------------------------------------------
// Market data cache
// A single fetch layer for provider reads: in-memory + localStorage persistence,
// in-flight dedupe for identical keys, TTL expiry, stale-if-error and a
// per-provider circuit breaker. The cache survives reloads, so a refresh no
// longer re-downloads the whole scan universe.
// ---------------------------------------------------------------------------
const MARKET_CACHE_PREFIX = "mdc:v1:";
const MARKET_CACHE_INDEX_KEY = "mdc:v1:__index";
const MARKET_CACHE_MAX_ENTRIES = 120;
const MARKET_CACHE_MAX_BYTES = 2400000;
const MARKET_BREAKER_LIMIT = 3;
const MARKET_BREAKER_COOLDOWN = 60000;
const MARKET_TTL = {
  ticker: 20000,
  intraday: 60000,
  daily: 30 * 60 * 1000,
  fxDaily: 6 * 60 * 60 * 1000,
  fxLatest: 60 * 60 * 1000,
  econ: 6 * 60 * 60 * 1000,
  currency: 6 * 60 * 60 * 1000,
};
const marketCache = new Map();
const marketInflight = new Map();
const providerBreakers = Object.create(null);
let marketCacheIndex = null;
let lastHttpMeta = null;

function delay(ms) {
  // The unit-test harness stubs setTimeout to a no-op returning 0. Resolve
  // immediately in that case so retry paths never hang the suite.
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms);
    if (handle === 0) resolve();
  });
}

function marketProviderFromUrl(url) {
  const u = String(url);
  if (u.includes("binance.com")) return "binance";
  if (u.includes("bybit.com")) return "bybit";
  if (u.includes("coinbase.com")) return "coinbase";
  if (u.includes("frankfurter")) return "frankfurter";
  if (u.includes("twelvedata")) return "twelvedata";
  if (u.includes("biquote.io")) return "econ";
  if (u.includes("jsdelivr")) return "currency";
  return "http";
}

function marketHash(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function marketCacheLoadIndex() {
  if (marketCacheIndex) return marketCacheIndex;
  try {
    const raw = localStorage.getItem(MARKET_CACHE_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    marketCacheIndex = Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry.k === "string" && Number.isFinite(entry.s))
      : [];
  } catch {
    marketCacheIndex = [];
  }
  return marketCacheIndex;
}

function marketCachePersistIndex() {
  try { localStorage.setItem(MARKET_CACHE_INDEX_KEY, JSON.stringify(marketCacheLoadIndex())); } catch {}
}

function marketCacheEvict(protectKey) {
  const index = marketCacheLoadIndex();
  let total = index.reduce((sum, entry) => sum + (entry.s || 0), 0);
  index.sort((a, b) => (a.t || 0) - (b.t || 0));
  let changed = false;
  while (index.length > MARKET_CACHE_MAX_ENTRIES || total > MARKET_CACHE_MAX_BYTES) {
    const position = index.findIndex((entry) => entry.k !== protectKey);
    if (position === -1) break;
    const oldest = index.splice(position, 1)[0];
    total -= oldest.s || 0;
    try { localStorage.removeItem(MARKET_CACHE_PREFIX + oldest.k); } catch {}
    marketCache.delete(oldest.k);
    changed = true;
  }
  marketCacheIndex = index;
  if (changed) marketCachePersistIndex();
}

function writeMarketCache(key, data, fetchedAt) {
  marketCache.set(key, { data, fetchedAt });
  let size = 0;
  let stored = false;
  try {
    const raw = JSON.stringify({ v: 1, t: fetchedAt, d: data });
    size = raw.length;
    marketCacheEvict(key);
    try { localStorage.setItem(MARKET_CACHE_PREFIX + key, raw); stored = true; } catch {}
  } catch {}
  const index = marketCacheLoadIndex().filter((entry) => entry.k !== key);
  if (stored) index.push({ k: key, t: fetchedAt, s: size });
  marketCacheIndex = index;
  marketCacheEvict();
  marketCachePersistIndex();
}

function readMarketCache(key, ttl) {
  let entry = marketCache.get(key);
  if (!entry) {
    try {
      const raw = localStorage.getItem(MARKET_CACHE_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1 && Number.isFinite(parsed.t)) {
          entry = { data: parsed.d, fetchedAt: parsed.t };
          marketCache.set(key, entry);
        }
      }
    } catch {}
  }
  if (!entry) return null;
  const age = Math.max(0, Date.now() - entry.fetchedAt);
  return { data: entry.data, fetchedAt: entry.fetchedAt, age, stale: ttl != null && age > ttl };
}

function clearMarketCache() {
  try {
    for (const entry of marketCacheLoadIndex()) {
      try { localStorage.removeItem(MARKET_CACHE_PREFIX + entry.k); } catch {}
    }
    localStorage.removeItem(MARKET_CACHE_INDEX_KEY);
  } catch {}
  marketCache.clear();
  marketInflight.clear();
  marketCacheIndex = [];
  for (const provider of Object.keys(providerBreakers)) delete providerBreakers[provider];
  lastHttpMeta = null;
}

function marketCacheStats() {
  const index = marketCacheLoadIndex();
  return {
    entries: index.length,
    bytes: index.reduce((sum, entry) => sum + (entry.s || 0), 0),
  };
}

function marketCacheStatsLabel() {
  const stats = marketCacheStats();
  if (stats.entries === 0) return "Cache is empty";
  return `${stats.entries} entries · ${Math.max(1, Math.round(stats.bytes / 1024))} KB`;
}

function formatCacheAge(ms) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function marketBreaker(provider) {
  if (!provider) return null;
  if (!providerBreakers[provider]) providerBreakers[provider] = { failures: 0, openUntil: 0 };
  return providerBreakers[provider];
}

function marketBreakerBlocked(provider) {
  const breaker = marketBreaker(provider);
  return breaker ? breaker.openUntil > Date.now() : false;
}

function marketBreakerSuccess(provider) {
  const breaker = marketBreaker(provider);
  if (breaker) { breaker.failures = 0; breaker.openUntil = 0; }
}

function marketBreakerFailure(provider) {
  const breaker = marketBreaker(provider);
  if (!breaker) return;
  breaker.failures += 1;
  if (breaker.failures >= MARKET_BREAKER_LIMIT) breaker.openUntil = Date.now() + MARKET_BREAKER_COOLDOWN;
}

async function httpJson(url, opts = {}) {
  const provider = opts.provider || marketProviderFromUrl(url);
  if (marketBreakerBlocked(provider)) {
    const error = new Error(`${provider} is cooling down after repeated failures.`);
    error.circuitOpen = true;
    throw error;
  }
  const attempts = Math.max(0, Number.isFinite(opts.retries) ? opts.retries : 0) + 1;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, opts.signal ? { signal: opts.signal } : undefined);
      if (!response.ok) {
        const error = new Error(`${provider} HTTP ${response.status}`);
        error.httpStatus = response.status;
        // 429, 451 and 5xx mean the provider itself is unhealthy; other 4xx
        // responses (an unknown symbol, for example) must not trip the breaker.
        const outage = response.status === 429 || response.status === 451 || response.status >= 500;
        if (attempt + 1 < attempts && outage) {
          await delay(400 * (attempt + 1));
          continue;
        }
        throw error;
      }
      const data = await response.json();
      marketBreakerSuccess(provider);
      return { data, fetchedAt: Date.now() };
    } catch (error) {
      if (error && error.circuitOpen) throw error;
      lastError = error;
      if (error && error.name === "AbortError") throw error;
      const status = error && error.httpStatus;
      const outage = status == null || status === 429 || status === 451 || status >= 500;
      if (attempt + 1 < attempts && outage) {
        await delay(400 * (attempt + 1));
        continue;
      }
      if (outage) marketBreakerFailure(provider);
      throw error;
    }
  }
  throw lastError || new Error("Request failed");
}

function marketCacheResult(entry, cache, key) {
  const age = Math.max(0, Date.now() - entry.fetchedAt);
  lastHttpMeta = { key, fetchedAt: entry.fetchedAt, age, cache };
  return { data: entry.data, fetchedAt: entry.fetchedAt, age, cache };
}

async function cachedJson(url, opts = {}) {
  const key = opts.key || url;
  const ttl = Number.isFinite(opts.ttl) ? opts.ttl : 0;
  const cached = readMarketCache(key, ttl);
  if (cached && !cached.stale) return marketCacheResult(cached, "hit", key);

  if (!marketInflight.has(key)) {
    const request = httpJson(url, opts)
      .then((result) => {
        writeMarketCache(key, result.data, result.fetchedAt);
        return result;
      })
      .finally(() => marketInflight.delete(key));
    // Mark rejections as handled even when a stale-while-revalidate caller
    // returns without awaiting the shared request.
    request.catch(() => {});
    marketInflight.set(key, request);
  }

  // Stale-while-revalidate hands back the old payload immediately and lets the
  // shared request above refresh it in the background.
  if (cached && opts.swr) return marketCacheResult(cached, "stale", key);

  try {
    const result = await marketInflight.get(key);
    return marketCacheResult({ data: result.data, fetchedAt: result.fetchedAt }, "miss", key);
  } catch (error) {
    if (cached) return marketCacheResult(cached, "stale-error", key);
    throw error;
  }
}

