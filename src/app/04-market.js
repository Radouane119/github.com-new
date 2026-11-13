const root = document.getElementById("root");

function sma(values, period) {
  const out = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period) sum += values[i];
    if (i === period - 1) out[i] = sum / period;
    if (i >= period) out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function rsi(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const move = values[i] - values[i - 1];
    if (move >= 0) gain += move;
    else loss -= move;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const move = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(move, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-move, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macd(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, i) => (fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null));
  const firstValid = line.findIndex(v => v != null);
  if (firstValid === -1) return { line, signal: Array(values.length).fill(null), hist: Array(values.length).fill(null) };
  const validLine = line.slice(firstValid);
  const signalValid = ema(validLine, 9);
  const signal = line.map((v, i) => (i >= firstValid && i - firstValid < signalValid.length ? signalValid[i - firstValid] : null));
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}

function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = Array(values.length).fill(null);
  const lower = Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = mid[i] + sd * mult;
    lower[i] = mid[i] - sd * mult;
  }
  return { mid, upper, lower };
}

function atr(rows, period = 14) {
  const ranges = rows.map((row, i) => {
    if (i === 0) return Math.abs(row.high - row.low);
    return Math.max(
      Math.abs(row.high - row.low),
      Math.abs(row.high - rows[i - 1].close),
      Math.abs(row.low - rows[i - 1].close),
    );
  });
  return sma(ranges, period);
}

function stdev(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function obv(rows) {
  const out = Array(rows.length).fill(null);
  let val = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = Number.isFinite(rows[i].volume) ? rows[i].volume : 0;
    if (i > 0) {
      if (rows[i].close > rows[i - 1].close) val += v;
      else if (rows[i].close < rows[i - 1].close) val -= v;
    }
    out[i] = val;
  }
  return out;
}

function findSwingStop(rows, direction, lookback = 40) {
  const slice = rows.slice(-lookback);
  let pivot = null;
  for (let i = 2; i < slice.length - 2; i++) {
    if (direction === "SELL" &&
        slice[i].high > slice[i-1].high && slice[i].high > slice[i-2].high &&
        slice[i].high > slice[i+1].high && slice[i].high > slice[i+2].high) {
      if (!pivot || slice[i].high > pivot) pivot = slice[i].high;
    }
    if (direction === "BUY" &&
        slice[i].low < slice[i-1].low && slice[i].low < slice[i-2].low &&
        slice[i].low < slice[i+1].low && slice[i].low < slice[i+2].low) {
      if (!pivot || slice[i].low < pivot) pivot = slice[i].low;
    }
  }
  return pivot;
}

function computeTrailingStop(direction, entry, current, origStop, initialR, atr, trailMult, initRrMult) {
  const tm = (typeof trailMult === "number" && trailMult > 0) ? trailMult : trailingAtrMult;
  const im = (typeof initRrMult === "number" && initRrMult > 0) ? initRrMult : initialRrMult;
  if (direction === "BUY" && current > entry) {
    const level = current - atr * tm;
    const best = Math.max(origStop, entry - initialR * im * atr);
    return Math.max(best, level);
  }
  if (direction === "SELL" && current < entry) {
    const level = current + atr * tm;
    const best = Math.min(origStop, entry + initialR * im * atr);
    return Math.min(best, level);
  }
  return origStop;
}

function mtfAgreementBonus(mtf, dir) {
  let adj = 0, total = 0;
  for (const tf in mtf) {
    const a = mtf[tf];
    if (!a || a.direction === "WAIT") continue;
    const w = tf === "1d" ? 12 : tf === "4h" ? 10 : 6;
    total += w;
    if (a.direction === dir) adj += w; else adj -= w;
  }
  return total > 0 ? Math.round(adj / total * 25) : 0;
}

async function computeMtfAdjustment(base, quote, cfg, dir, contextTfs = ["4h", "1h"]) {
  try {
    // Fetch every context timeframe in parallel; a scan-all call fans these out
    // for dozens of pairs, so sequential awaits dominated the wall clock.
    const fetched = await Promise.all(contextTfs.map(async (tf) => {
      try {
        const rows = await fetchBinanceRows(base, quote, tf);
        return { tf, rows };
      } catch {
        return { tf, rows: [] };
      }
    }));
    const rowsByTf = {};
    let adj = 0;
    let matched = 0;
    let total = 0;
    for (const { tf, rows } of fetched) {
      rowsByTf[tf] = rows;
      const a = rows.length >= 80 ? analyze(rows, cfg) : null;
      if (!a || a.direction === "WAIT") continue;
      const w = mtfWeightOf(tf);
      total += w;
      if (a.direction === dir) { adj += w; matched++; }
      else adj -= w;
    }
    const score = total > 0 ? Math.round(adj / total * 30) : 0;
    return { score, matched, rowsByTf };
  } catch {
    return { score: 0, matched: 0, rowsByTf: {} };
  }
}

function makeOhlc(date, close, previousClose) {
  const open = previousClose ?? close;
  const baseRange = Math.abs(close - open) || Math.abs(close) * 0.0025;
  const spread = Math.max(baseRange * 0.7, Math.abs(close) * 0.0012);
  const high = Math.max(close, open) + spread;
  const low = Math.min(close, open) - spread;
  return {
    date,
    open,
    high,
    low,
    close,
    volume: Math.max(1, Math.round((high - low) * (close + open) / 2 * 100000)),
  };
}

async function fetchFxRows(base, quote) {
  // Frankfurter no longer publishes BGN (Bulgaria adopted the euro), so a
  // history request for it would 404 on every chart open. Fail fast with a
  // readable message instead of logging a failed network request.
  if (!frankfurterCurrencies.has(base) || !frankfurterCurrencies.has(quote)) {
    throw new Error(`Daily history is not available for ${base}/${quote}.`);
  }
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 180);
  const fmt = (date) => date.toISOString().slice(0, 10);
  // Frankfurter serves the whole 180-day window in one response, so there is no
  // need to split the range and merge two payloads - scan-all issues one request
  // per FX pair instead of two.
  const url = `https://api.frankfurter.dev/v1/${fmt(start)}..${fmt(end)}?from=${base}&to=${quote}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const result = await cachedJson(url, {
      ttl: MARKET_TTL.fxDaily,
      key: `fx-daily:${base}/${quote}:${fmt(start)}:${fmt(end)}`,
      provider: "frankfurter",
      signal: controller.signal,
    });
    const data = result.data;
    const allRates = data.rates || {};
    const dates = Object.keys(allRates).sort();
    // Drop gaps/partial rows: a missing quote yields undefined closes -> NaN indicators -> silent all-WAIT.
    const valid = dates.filter((date) => {
      const r = allRates[date]?.[quote];
      return r != null && Number.isFinite(Number(r)) && Number(r) > 0;
    });
    if (valid.length < 80) throw new Error("FX history incomplete for this pair.");
    return valid.map((date, index) => {
      const close = Number(allRates[date][quote]);
      const previous = index > 0 ? Number(allRates[valid[index - 1]][quote]) : close;
      return makeOhlc(date, close, previous);
    });
  } finally {
    clearTimeout(timer);
  }
}

function binanceSymbol(base, quote) {
  const q = quote === "USD" ? "USDT" : quote;
  return base === "XAU" ? `PAXG${q}` : `${base}${q}`;
}

let lastCryptoSource = "Binance";

const bybitInterval = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D" };
const coinbaseGranularity = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };

async function fetchBybitRows(base, quote, interval, limit) {
  const symbol = binanceSymbol(base, quote);
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval[interval] || "D"}&limit=${limit}`;
  const result = await cachedJson(url, {
    ttl: interval === "1d" ? MARKET_TTL.daily : MARKET_TTL.intraday,
    key: `bybit:${symbol}:${interval}:${limit}`,
    provider: "bybit",
  });
  const data = result.data;
  const list = data?.result?.list;
  if (data.retCode !== 0 || !Array.isArray(list) || list.length === 0) throw new Error(`Bybit returned no data for ${base}/${quote}.`);
  return list
    .map((k) => ({
      date: new Date(Number(k[0])).toISOString().slice(0, 10),
      time: new Date(Number(k[0])).toISOString(),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }))
    .filter((row) => Number.isFinite(row.close))
    .sort((a, b) => new Date(a.time) - new Date(b.time));
}

async function fetchCoinbaseRows(base, quote, interval, limit) {
  if (quote !== "USD") throw new Error("Coinbase fallback only supports USD quotes.");
  // Coinbase product IDs are BASE-USD. Do not reuse binanceSymbol(), which
  // deliberately turns a USD quote into USDT (e.g. MATICUSDT-USD is invalid).
  // Polygon migrated its Coinbase market from MATIC to POL.
  const symbol = base === "MATIC" ? "POL" : base === "XAU" ? "PAXG" : base;
  const granularity = coinbaseGranularity[interval] || 86400;
  const url = `https://api.exchange.coinbase.com/products/${symbol}-USD/candles?granularity=${granularity}`;
  const result = await cachedJson(url, {
    ttl: interval === "1d" ? MARKET_TTL.daily : MARKET_TTL.intraday,
    key: `coinbase:${symbol}:${interval}:${limit}`,
    provider: "coinbase",
  });
  const data = result.data;
  if (!Array.isArray(data) || data.length === 0) throw new Error(`Coinbase returned no data for ${base}/${quote}.`);
  return data
    .map((k) => ({
      date: new Date(k[0] * 1000).toISOString().slice(0, 10),
      time: new Date(k[0] * 1000).toISOString(),
      open: Number(k[3]),
      high: Number(k[2]),
      low: Number(k[1]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }))
    .filter((row) => Number.isFinite(row.close))
    .sort((a, b) => new Date(a.time) - new Date(b.time))
    .slice(-limit);
}

const fxMajors = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SGD", "NOK", "SEK", "DKK", "PLN", "CZK", "HUF", "RON", "ISK", "BGN", "TRY", "ZAR", "MXN", "BRL", "CNY", "HKD", "THB", "INR", "KRW", "ILS"]);
// GBP and AUD have Binance USDT books, but their last real trades are from 2023
// (see rowsAreStale), so they cannot seed a live cross. Only EUR is usable free.
const fxLegStale = new Set(["GBP", "AUD"]);
function hasLiveFxLeg(cur) { return cur === "USD" || (fxUsdLegs[cur] && !fxLegStale.has(cur)); }
// Intraday is only advertised when a browser-readable source can actually serve
// it: a Binance USDT cross is possible, or a Twelve Data key is configured. This
// stops the UI from lighting up 1m/1h buttons for pairs that would silently
// degrade to daily.
function fxIntradayable(base, quote) {
  if (nonFiat.has(base) || !fxMajors.has(base) || !fxMajors.has(quote)) return false;
  if (fxApiPrefs.enabled && fxApiPrefs.key) return true;
  return hasLiveFxLeg(base) && hasLiveFxLeg(quote);
}


function bucketTo4h(hourlyRows) {
  const out = [];
  for (let i = 0; i + 4 <= hourlyRows.length; i += 4) {
    const group = hourlyRows.slice(i, i + 4);
    out.push({
      date: group[0].date,
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((r) => r.high)),
      low: Math.min(...group.map((r) => r.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((s, r) => s + r.volume, 0),
    });
  }
  return out;
}

// Currencies Binance lists against USDT. Used as the USD leg for FX crosses,
// because Binance sends Access-Control-Allow-Origin: * and is therefore readable
// from the browser. Yahoo Finance is NOT usable here: it sends no CORS header at
// all, so every browser read is rejected regardless of network health.
const fxUsdLegs = { EUR: "EURUSDT", GBP: "GBPUSDT", AUD: "AUDUSDT" };
const fxUsdLegCache = new Map();

function fxSourceLabel(base, quote) {
  if (fxApiLastUsed) return fxApiLastUsed;
  const legs = [base, quote].filter((c) => c !== "USD" && fxUsdLegs[c]);
  return legs.length > 0 ? `Derived from Binance ${legs.map((c) => fxUsdLegs[c]).join("/")}` : "Binance";
}

async function fetchFxUsdLegSeries(currency, interval) {
  const symbol = fxUsdLegs[currency];
  if (!symbol) return null;
  const cacheKey = symbol + ":" + interval;
  const cached = fxUsdLegCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60000) return cached.series;
  const rows = await fetchBinanceRows(currency, "USDT", interval);
  const series = rows.filter((r) => Number.isFinite(r.close) && r.close > 0);
  fxUsdLegCache.set(cacheKey, { series, at: Date.now() });
  return series;
}

// A USD leg is exactly 1, but it must inherit the timestamps of the real leg so
// the two series line up bar for bar. Synthesising its own clock instead produces
// a set with zero timestamp overlap, i.e. an empty cross.
function unitSeriesFrom(rows) {
  return rows.map((r) => ({ date: r.date, time: r.time, open: 1, high: 1, low: 1, close: 1, volume: r.volume }));
}

// A/B where both legs are quoted as "USD per 1 unit of currency", aligned on
// identical bar timestamps. Bar extremes come from the true per-leg extremes:
// the ratio of two series over one bar peaks at base high / quote low.
function deriveCrossSeries(baseLeg, quoteLeg) {
  const byTime = new Map();
  for (const b of quoteLeg) {
    if (b && Number.isFinite(b.close) && b.close > 0 && Number.isFinite(b.low) && b.low > 0) byTime.set(b.time, b);
  }
  const out = [];
  for (const a of baseLeg) {
    const q = byTime.get(a && a.time);
    if (!q) continue;
    if (!Number.isFinite(a.close) || a.close <= 0 || !Number.isFinite(a.open) || a.open <= 0) continue;
    if (!Number.isFinite(a.high) || !Number.isFinite(a.low)) continue;
    const close = a.close / q.close;
    const open = a.open / q.open;
    const high = a.high / q.low;
    const low = a.low / q.high;
    if (![close, open, high, low].every((v) => Number.isFinite(v) && v > 0)) continue;
    out.push({
      date: a.time.slice(0, 10),
      time: a.time,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: Math.max(1, Math.round(Math.min(a.volume, q.volume))),
    });
  }
  return out;
}

async function fetchFxIntradayCross(base, quote, interval) {
  if (base === "USD" && quote === "USD") return [];
  const [legBase, legQuote] = await Promise.all([
    base === "USD" ? Promise.resolve(null) : fetchFxUsdLegSeries(base, interval).catch(() => null),
    quote === "USD" ? Promise.resolve(null) : fetchFxUsdLegSeries(quote, interval).catch(() => null),
  ]);
  let baseLeg = legBase;
  let quoteLeg = legQuote;
  if (base === "USD" && quoteLeg) baseLeg = unitSeriesFrom(quoteLeg);
  if (quote === "USD" && baseLeg) quoteLeg = unitSeriesFrom(baseLeg);
  if (!baseLeg || !quoteLeg) return [];
  return deriveCrossSeries(baseLeg, quoteLeg);
}

async function fetchForexRows(base, quote, interval = "1d", allowVendor = true) {
  if (interval === "1d") return fetchFxRows(base, quote);
  loadFxApiPrefs();
  fxApiLastUsed = null;
  const binanceInterval = interval === "4h" ? "1h" : interval;
  let derived = [];
  try { derived = await fetchFxIntradayCross(base, quote, binanceInterval); } catch {}
  if (derived.length >= 80) return interval === "4h" ? bucketTo4h(derived) : derived;
  // Both currencies must be quotable against USDT to build a cross. When they are
  // not, fall back to the optional Twelve Data feed before giving up - unless this
  // is an overview scan, where paying the vendor would stall the whole run.
  if (allowVendor) {
    const vendor = await fetchTwelveDataRows(base, quote, interval).catch(() => null);
    if (vendor && vendor.length >= 80) return vendor;
  } else {
    // An overview scan fans out to every FX pair lacking Binance USDT legs. Twelve
    // Data only serves 6 per minute, so buying a series for each one would take
    // minutes and burn most of the free daily budget. ECB daily rates are the
    // honest data for these crosses anyway, so scan them from Frankfurter instead;
    // the single-chart view keeps paying the vendor per request.
    const daily = await fetchFxRows(base, quote).catch(() => null);
    if (daily && daily.length >= 80) return daily;
  }
  const missing = [base, quote].filter((c) => c !== "USD" && !fxUsdLegs[c]);
  const reason = fxApiStatus ? ` (${fxApiStatus})` : "";
  throw new Error(
    missing.length > 0
      ? `No browser-readable intraday feed for ${missing.join("/")} (Binance USDT legs cover ${Object.keys(fxUsdLegs).join(", ")}${fxApiPrefs.enabled && fxApiPrefs.key ? " and Twelve Data returned nothing usable" : "; add a Twelve Data key in Settings to enable it"})${reason}.`
      : `No intraday cross data for ${base}/${quote}${reason}.`
  );
}

const fxApiIntervalMap = { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "1h" };

// Twelve Data's free tier allows about 8 requests/minute and 800/day. An overview
// scan touches every FX pair that lacks Binance USDT legs, so without client-side
// pacing it trips HTTP 429 (pairs silently fall back to WAIT even with a valid
// key) and burns the whole daily budget in a handful of intraday scans. Reserve a
// slot per request, back off on 429, and expose the counter so Settings can report
// usage. 6/min and 760/day leave headroom under the real limits.
const TD_PER_MIN = 6;
const TD_PER_DAY = 760;
const TD_GATE_KEY = "tdGate:v1";
let tdRetryDelayMs = 1500;
const tdGate = { stamps: [], day: "", used: 0, pausedUntil: 0 };
let fxApiStatus = "";

function saveTdGate() {
  try {
    localStorage.setItem(TD_GATE_KEY, JSON.stringify({
      day: tdGate.day,
      used: tdGate.used,
      pausedUntil: tdGate.pausedUntil,
      status: fxApiStatus,
    }));
  } catch {}
}

// The daily budget must survive a reload; otherwise refreshing the page hands
// the provider a brand-new 760-request allowance. Minute stamps are intentionally
// not restored - a new page load starts a fresh pacing window.
function loadTdGate() {
  try {
    const saved = JSON.parse(localStorage.getItem(TD_GATE_KEY) || "null");
    if (!saved) return;
    const today = new Date().toISOString().slice(0, 10);
    if (saved.day !== today) {
      try { localStorage.removeItem(TD_GATE_KEY); } catch {}
      return;
    }
    tdGate.day = today;
    tdGate.used = Math.max(0, Math.min(TD_PER_DAY, Number(saved.used) || 0));
    tdGate.pausedUntil = Math.max(0, Number(saved.pausedUntil) || 0);
    fxApiStatus = typeof saved.status === "string" ? saved.status.slice(0, 120) : "";
  } catch {}
}

function tdReserve(now, ignorePause) {
  if (now == null) now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (tdGate.day !== today) { tdGate.day = today; tdGate.used = 0; tdGate.stamps = []; }
  if (tdGate.used >= TD_PER_DAY) { fxApiStatus = "daily credit budget reached"; saveTdGate(); return -1; }
  if (!ignorePause && now < tdGate.pausedUntil) return tdGate.pausedUntil - now;
  tdGate.stamps = tdGate.stamps.filter((t) => now - t < 60000);
  if (tdGate.stamps.length >= TD_PER_MIN) return 60000 - (now - tdGate.stamps[0]);
  tdGate.stamps.push(now);
  tdGate.used++;
  saveTdGate();
  return 0;
}

function tdNoteRateLimit(now) {
  if (now == null) now = Date.now();
  tdGate.pausedUntil = now + 20000;
  fxApiStatus = "provider rate limit (429) - backing off";
  saveTdGate();
}

async function tdAcquire(ignorePause) {
  for (let i = 0; i < 90; i++) {
    const wait = tdReserve(undefined, ignorePause);
    if (wait === -1) return false;
    if (wait <= 0) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 20000) + 25));
  }
  return true;
}

async function tdFetchJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await tdAcquire(attempt > 0))) throw new Error("Twelve Data daily credit budget is used up (free tier is about 800/day).");
    const res = await fetch(url);
    if (res.status === 429) {
      tdNoteRateLimit();
      if (attempt === 0) await new Promise((r) => setTimeout(r, tdRetryDelayMs));
      continue;
    }
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
    fxApiStatus = "";
    return await res.json();
  }
  throw new Error("Twelve Data kept returning 429 (rate limit); retry in a minute.");
}

function mapTdSeries(data, interval) {
  const rows = [];
  for (const v of Array.isArray(data.values) ? data.values : []) {
    const t = v && v.datetime;
    if (!t) continue;
    const open = Number(v.open), high = Number(v.high), low = Number(v.low), close = Number(v.close);
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue;
    rows.push({ date: String(t).slice(0, 10), time: t, open, high, low, close, volume: Number(v.volume) || 0 });
  }
  rows.reverse();
  if (rows.length < 80) return null;
  fxApiLastUsed = "Twelve Data";
  return interval === "4h" ? bucketTo4h(rows) : rows;
}

async function fetchTwelveDataRows(base, quote, interval) {
  if (!fxApiPrefs.enabled || !fxApiPrefs.key) return null;
  const apiInterval = fxApiIntervalMap[interval] || "1h";
  const url = `https://api.twelvedata.com/time_series?symbol=${base}/${quote}&interval=${apiInterval}&outputsize=1000&timezone=UTC&apikey=${encodeURIComponent(fxApiPrefs.key)}`;
  // Cache by a hash of the API key, never the key itself, so rotating keys
  // invalidates old series without exposing the credential in storage keys.
  const cacheKey = `td:series:${base}/${quote}:${interval}:${marketHash(fxApiPrefs.key)}`;
  const ttl = interval === "1d" ? MARKET_TTL.daily : MARKET_TTL.intraday;
  const cached = readMarketCache(cacheKey, ttl);
  if (cached && !cached.stale) {
    const rows = mapTdSeries(cached.data, interval);
    if (rows) return rows;
  }
  const data = await tdFetchJson(url);
  if (data.status !== "ok") throw new Error(data && data.message ? "Twelve Data: " + data.message : "Twelve Data error");
  const rows = mapTdSeries(data, interval);
  if (!rows) return null;
  writeMarketCache(cacheKey, data, Date.now());
  return rows;
}

// Lightweight live price from Twelve Data. The free plan allows 800 requests/day,
// so each pair is re-quoted at most once a minute and the 30s live loop stays far
// under budget. change is recomputed by the caller from the previous tick.
const fxLiveThrottle = new Map();
async function fetchTwelveDataPrice(base, quote) {
  if (!fxApiPrefs.enabled || !fxApiPrefs.key) return null;
  const key = `${base}/${quote}`;
  const now = Date.now();
  if (now - (fxLiveThrottle.get(key) || 0) < 60000) return null;
  fxLiveThrottle.set(key, now);
  const url = `https://api.twelvedata.com/price?symbol=${base}/${quote}&apikey=${encodeURIComponent(fxApiPrefs.key)}`;
  let data;
  try { data = await tdFetchJson(url); } catch { return null; }
  if (!data || data.status !== "ok") throw new Error(data && data.message ? "Twelve Data: " + data.message : "Twelve Data error");
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, change: null };
}

const barStepMs = { "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };

// Some exchange books are technically "live" but effectively dead. Binance's
// GBPUSDT and AUDUSDT spot pairs, for example, still answer with their last real
// trades from 2023. Serving those bars as current data silently analyses years-old
// prices, so reject any series whose newest bar is implausibly old.
function rowsAreStale(rows, interval) {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  const last = rows[rows.length - 1];
  const stamp = Date.parse(last && last.time ? last.time : last && last.date);
  if (!Number.isFinite(stamp)) return false;
  const step = barStepMs[interval] || 3600000;
  // Four missed bars is a dead feed; the 30-minute floor still absorbs exchange
  // hiccups without letting a 1-minute chart run an hour behind.
  const maxAge = Math.max(step * 4, 30 * 60 * 1000);
  return Date.now() - stamp > maxAge;
}

async function fetchBinanceRows(base, quote, interval = "1d", limitOverride) {
  const symbol = binanceSymbol(base, quote);
  const limit = limitOverride || (interval === "1d" ? 200 : ["4h", "1h", "15m", "30m"].includes(interval) ? 500 : interval === "1m" ? 1000 : 200);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    const result = await cachedJson(url, {
      ttl: interval === "1d" ? MARKET_TTL.daily : MARKET_TTL.intraday,
      key: `binance:${symbol}:${interval}:${limit}`,
      provider: "binance",
      signal: controller.signal,
    });
    const rows = result.data
      .map((k) => ({
        date: new Date(k[0]).toISOString().slice(0, 10),
        time: new Date(k[0]).toISOString(),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      }))
      .filter((row) => Number.isFinite(row.close));
    if (rows.length > 0 && !rowsAreStale(rows, interval)) { clearTimeout(timer); lastCryptoSource = "Binance"; return rows; }
  } catch {}
  clearTimeout(timer);
  try {
    const rows = await fetchBybitRows(base, quote, interval, limit);
    if (!rowsAreStale(rows, interval)) { lastCryptoSource = "Bybit"; return rows; }
  } catch {}
  try {
    // Coinbase only lists crypto products. Fiat bases such as EUR/GBP/AUD have
    // Binance USDT books but no Coinbase product (EURUSDT-USD 404s), so skip it
    // rather than issue a request that is known to fail.
    if (nonFiat.has(base)) {
      const rows = await fetchCoinbaseRows(base, quote, interval, limit);
      if (!rowsAreStale(rows, interval)) { lastCryptoSource = "Coinbase"; return rows; }
    }
  } catch {}
  throw new Error(`Live data unavailable or stale for ${base}/${quote} on Binance, Bybit and Coinbase.`);
}

function tfLabel(tf) {
  return tf === "4h" ? "4-hour" : tf === "1h" ? "1-hour" : tf === "30m" ? "30-minute" : tf === "15m" ? "15-minute" : tf === "1m" ? "1-minute" : "daily";
}

function isScalpTf(tf) {
  return tf === "1m" || tf === "15m" || tf === "30m";
}

function mtfContextTfs(timeframe) {
  const base = ["1d", "4h", "1h"];
  if (timeframe === "1m") return ["1h", "15m", "5m"];
  if (timeframe === "15m") return ["1h", "4h", "1d"];
  if (timeframe === "30m") return ["1h", "4h", "1d"];
  return base;
}

async function fetchLivePrice(base, quote) {
  try {
    if (quote === "USD" && (nonFiat.has(base) || binanceFiat.has(base))) {
      // Binance only has USD(T)-quoted books for these assets. A crypto/crypto
      // cross such as BTC/ETH would build an invalid symbol (BTCETH), so those
      // fall through to the currency-api conversion below instead.
      const symbol = binanceSymbol(base, quote);
      try {
        const result = await cachedJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, { ttl: MARKET_TTL.ticker, key: `binance-ticker:${symbol}`, provider: "binance" });
        const d = result.data;
        const price = Number(d.lastPrice);
        if (Number.isFinite(price)) return { price, change: Number(d.priceChangePercent) };
      } catch {}
      try {
        const result = await cachedJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`, { ttl: MARKET_TTL.ticker, key: `bybit-ticker:${symbol}`, provider: "bybit" });
        const t = result.data?.result?.list?.[0];
        if (t && t.lastPrice) return { price: Number(t.lastPrice), change: t.price24hPcnt != null ? Number(t.price24hPcnt) * 100 : null };
      } catch {}
      if (quote === "USD") {
        try {
          const coinbaseBase = base === "MATIC" ? "POL" : base === "XAU" ? "PAXG" : base;
          const result = await cachedJson(`https://api.exchange.coinbase.com/products/${coinbaseBase}-USD/ticker`, { ttl: MARKET_TTL.ticker, key: `coinbase-ticker:${coinbaseBase}`, provider: "coinbase" });
          const d = result.data;
          if (d && d.price) return { price: Number(d.price), change: null };
        } catch {}
      }
      return null;
    }
    if (fxIntradayable(base, quote)) {
      // Intraday FX live price: derive from Binance USDT legs, which are
      // browser-readable. Yahoo is intentionally not used here (no CORS header).
      // Only EUR, GBP and AUD have USDT legs, so quote legs like JPY/CHF/NZD/CAD
      // are missing: dividing by 1 would silently present EUR/USD as EUR/JPY, so
      // the ratio is used only when every non-USD leg resolves.
      try {
        const [legBase, legQuote] = await Promise.all([
          base === "USD" ? Promise.resolve(null) : fetchFxUsdLegSeries(base, "1m").catch(() => null),
          quote === "USD" ? Promise.resolve(null) : fetchFxUsdLegSeries(quote, "1m").catch(() => null),
        ]);
        if (base !== "USD" && legBase && legBase.length > 1 && (quote === "USD" || (legQuote && legQuote.length > 1))) {
          const lastBase = legBase[legBase.length - 1].close;
          const priorBase = legBase[legBase.length - 2].close;
          const lastQuote = legQuote ? legQuote[legQuote.length - 1].close : 1;
          const priorQuote = legQuote ? legQuote[legQuote.length - 2].close : 1;
          const price = lastBase / lastQuote;
          const prior = priorBase / priorQuote;
          if (Number.isFinite(price) && price > 0) {
            return { price, change: Number.isFinite(prior) && prior > 0 ? ((price - prior) / prior) * 100 : null };
          }
        }
      } catch {}
      // No Binance legs (or a missing quote leg): the optional Twelve Data feed
      // serves a live FX price for exactly these pairs.
      const twelve = await fetchTwelveDataPrice(base, quote).catch(() => null);
      if (twelve) return twelve;
    }
    if (frankfurterCurrencies.has(base) && frankfurterCurrencies.has(quote)) {
      try {
        const result = await cachedJson(`https://api.frankfurter.dev/v1/latest?from=${base}&to=${quote}`, { ttl: MARKET_TTL.fxLatest, key: `fx-latest:${base}:${quote}`, provider: "frankfurter" });
        const d = result.data;
        if (d.rates && d.rates[quote] != null) return { price: d.rates[quote], change: null };
      } catch {}
    }
    const converted = await cachedJson(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base.toLowerCase()}.min.json`, { ttl: MARKET_TTL.currency, key: `currency:${base}`, provider: "currency" });
    const d2 = converted.data;
    const rate = d2[base.toLowerCase()]?.[quote.toLowerCase()];
    if (rate) return { price: rate, change: null };
    return null;
  } catch {
    return null;
  }
}

