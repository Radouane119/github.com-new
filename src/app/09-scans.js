function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  // requestAnimationFrame does not fire in a hidden tab, which would latch renderPending
  // on forever and silently drop every later scheduled render. Fall back to a timer.
  let settled = false;
  let fallbackId = null;
  const flush = () => {
    if (settled) return;
    settled = true;
    if (fallbackId !== null) { clearTimeout(fallbackId); fallbackId = null; }
    renderPending = false;
    render();
  };
  fallbackId = setTimeout(flush, 250);
  requestAnimationFrame(flush);
}

async function fetchOverviewRows(pair, tf) {
  const [base, quote] = pair.split("/");
  if (nonFiat.has(base) || (binanceFiat.has(base) && quote === "USD")) {
    return tf && tf !== "1d" ? await fetchBinanceRows(base, quote, tf) : await fetchBinanceRows(base, quote);
  }
  if (!tf || tf === "1d") return await fetchFxRows(base, quote);
  // Scans must not spend Twelve Data credits (6/min) on every leg-less FX pair.
  return await fetchForexRows(base, quote, tf, false);
}

function mtfWeightOf(tf) {
  return tf === "1d" ? 12 : tf === "4h" ? 10 : tf === "1h" ? 8 : 6;
}

async function scanPairForOverview(pair, token) {
  const [base, quote] = pair.split("/");
  const staleScan = () => token != null && token !== multiScan.scanToken;
  try {
    const prevDir = multiScan.results[pair] && !multiScan.results[pair].loading ? multiScan.results[pair].direction : null;
    multiScan.results[pair] = { loading: true, direction: "WAIT", confidence: 0, price: null };
    scheduleRender();
    const scanTf = multiScan.timeframe || "1d";
    const ctxTfs = mtfContextTfs(scanTf).filter(t => t !== scanTf);
    const ctxTf = ctxTfs[0] || "4h";
    const rows = await fetchOverviewRows(pair, scanTf);
    if (staleScan()) return;
    const cfg = loadStrategyConfig();
    const analysis = rows.length >= 80 ? analyze(rows, cfg, pair, true) : null;
    let mtfConf = 0;
    let a4h = null;
    if (analysis && analysis.direction !== "WAIT" && (nonFiat.has(base) || (binanceFiat.has(base) && quote === "USD"))) {
      const mtfAdj = await computeMtfAdjustment(base, quote, cfg, analysis.direction, ctxTfs);
      if (staleScan()) return;
      mtfConf = mtfAdj.score;
      // ctxTf is one of the context timeframes, so its rows already came back
      // with the MTF pass - reuse them instead of issuing a duplicate request.
      const rowsCtx = (mtfAdj.rowsByTf && mtfAdj.rowsByTf[ctxTf]) || [];
      a4h = rowsCtx.length >= 80 ? analyze(rowsCtx, cfg, pair) : null;
    }
    const conf = Math.min(100, Math.max(0, (analysis?.confidence ?? 0) + mtfConf));
    const mtf4hDir = a4h ? a4h.direction : null;
    const task = analysis ? { direction: analysis.direction, confidence: conf, risk: analysis.risk, entry: analysis.entry, stop: analysis.stop, target: analysis.target, volatilityPct: analysis.volatilityPct, buyScore: analysis.buyScore, sellScore: analysis.sellScore, reasons: analysis.reasons, mtf4h: mtf4hDir } : null;
    if (staleScan()) return;
    const isNew = addSignalToHistory(pair, task);
    if (prevDir && task && task.direction !== prevDir && task.direction !== "WAIT" && prevDir !== "WAIT") { try { const actx = new (window.AudioContext || window.webkitAudioContext)(); const osc = actx.createOscillator(); const gain = actx.createGain(); osc.connect(gain); gain.connect(actx.destination); osc.type = "sine"; osc.frequency.setValueAtTime(task.direction === "BUY" ? 880 : 440, actx.currentTime); osc.frequency.setValueAtTime(task.direction === "BUY" ? 1100 : 330, actx.currentTime + 0.1); gain.gain.setValueAtTime(0.15, actx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 0.3); osc.start(); osc.stop(actx.currentTime + 0.3); } catch {} }
    const lastRow = rows.at(-1);
    const price = lastRow ? lastRow.close : null;
    const change = rows.length >= 2 ? ((rows[rows.length - 1].close - rows[rows.length - 2].close) / rows[rows.length - 2].close) * 100 : null;
    if (staleScan()) return;
    multiScan.results[pair] = {
      loading: false, direction: analysis?.direction ?? "WAIT", confidence: conf,
      risk: analysis?.risk ?? "", volatilityPct: analysis?.volatilityPct ?? 0, price, change,
      entry: analysis?.entry, stop: analysis?.stop, target: analysis?.target,
      mtf4h: analysis ? (a4h ? a4h.direction : null) : null, mtfTf: ctxTf,
    };
    if (isNew && task && task.direction !== "WAIT") notifySignal({ direction: task.direction, pair, confidence: task.confidence, risk: task.risk, entry: task.entry });
  } catch {
    if (!staleScan()) multiScan.results[pair] = { loading: false, direction: "WAIT", confidence: 0, price: null };
  }
  scheduleRender();
}

function cancelOverviewScan() {
  multiScan.scanToken++;
  multiScan.scanning = false;
  multiScan.progress = "";
}

async function scanAllPairs() {
  if (multiScan.scanning) cancelOverviewScan();
  const token = ++multiScan.scanToken;
  multiScan.scanning = true;
  multiScan.results = {};
  render();
  const fast = scanPairs.filter(p => nonFiat.has(p.split("/")[0]) || (binanceFiat.has(p.split("/")[0]) && p.split("/")[1] === "USD"));
  const slow = scanPairs.filter(p => !fast.includes(p));
  const total = scanPairs.length;
  let done = 0;
  const bump = () => { if (token !== multiScan.scanToken) return; done++; multiScan.progress = `${done}/${total}`; scheduleRender(); };
  multiScan.progress = `0/${total}`;
  render();
  // Crypto and FX tiers are independent, so run them at the same time instead of
  // one after the other - the scan finishes in roughly the slower tier rather than
  // the sum. Crypto gets a wider fan-out (Binance multiplexes many streams); FX
  // batches stay smaller. The daily FX path is one Frankfurter request per pair
  // and intraday FX no longer calls Twelve Data during a scan, so neither tier can
  // run away with the provider budget.
  const runTier = async (list, limit) => {
    for (let i = 0; i < list.length; i += limit) {
      if (token !== multiScan.scanToken) return;
      await Promise.all(list.slice(i, i + limit).map(async (p) => { await scanPairForOverview(p, token); bump(); }));
    }
  };
  await Promise.all([runTier(fast, 10), runTier(slow, 10)]);
  if (token !== multiScan.scanToken) return;
  multiScan.scanning = false;
  multiScan.progress = "";
  render();
}

async function verifySignals() {
  const pending = autoScan.history.filter(e => e.direction !== "WAIT" && e.result === "pending" && e.stop != null && e.target != null && !e.autoPaper);
  if (pending.length === 0) return;
  const pairs = [...new Set(pending.map(e => e.pair))];
  const priceCache = {};
  for (const pair of pairs) {
    const [base, quote] = pair.split("/");
    try {
      const data = await fetchLivePrice(base, quote);
      if (data) priceCache[pair] = data.price;
    } catch {}
  }
  const now = Date.now();
  let changed = false;
  for (const entry of pending) {
    const current = priceCache[entry.pair];
    if (current == null) continue;
    const age = now - (entry.id || now);
    const stale = age > 7 * 24 * 60 * 60 * 1000;
    if (entry.direction === "BUY") {
      entry.result = current >= entry.target ? "win" : current <= entry.stop ? "loss" : stale ? ((current - entry.entry) / entry.entry) * 100 > 0.3 ? "win" : "loss" : "pending";
    } else {
      entry.result = current <= entry.target ? "win" : current >= entry.stop ? "loss" : stale ? ((current - entry.entry) / entry.entry) * 100 < -0.3 ? "win" : "loss" : "pending";
    }
    if (entry.result !== "pending") {
      changed = true;
      if (mlModel.trained) {
        const pred = mlPredictEntry(entry);
        if (pred) {
          mlStats.filtered++;
          if ((pred.label === "win" && entry.result === "win") || (pred.label === "loss" && entry.result === "loss")) mlStats.filteredCorrect++;
          mlSave();
        }
      }
      mlTrainEntry(entry);
    }
  }
  if (changed) { saveHistory(); render(); }
}

async function updateLivePrice() {
  const pair = `${state.base}/${state.quote}`;
  const result = await fetchLivePrice(state.base, state.quote);
  if (result) {
    const prev = livePrice.price;
    livePrice.price = result.price;
    livePrice.change = result.change != null ? result.change : (prev != null ? ((result.price - prev) / prev) * 100 : null);
    livePrice.timestamp = new Date();
    if (multiScan.results[pair]) {
      multiScan.results[pair].price = result.price;
      multiScan.results[pair].priceUpdatedAt = Date.now();
      if (result.change != null) multiScan.results[pair].change = result.change;
    }
    const pEl = document.getElementById(`op-${pair.replace("/","-")}`);
    if (pEl) pEl.textContent = formatPrice(result.price, pair);
    const cEl = document.getElementById(`oc-${pair.replace("/","-")}`);
    if (cEl && result.change != null) {
      cEl.textContent = (result.change >= 0 ? "+" : "") + result.change.toFixed(1) + "%";
      cEl.className = result.change >= 0 ? "chg-up" : "chg-down";
    }
  }
  const el = document.getElementById("livePrice");
  if (el) renderLivePrice(el);
  refreshFxPositionPrices().catch(() => {});
}

// The overview scanner prices FX from daily ECB candles, which update once a
// day, while crypto's Binance candles move all day. So an open FX position would
// sit frozen between scans. Seed those slots from a live-capable source at most
// every two minutes: Binance legs (free) when the pair has both, otherwise the
// optional Twelve Data price feed.
async function refreshFxPositionPrices() {
  const open = positions.filter(p => !p.closedAt);
  for (const pos of open) {
    const [b, q] = pos.pair.split("/");
    // Crypto is streamed over the Binance WebSocket; every fiat pair can still be
    // marked to a live-ish price (Binance cross or the daily ECB reference), so
    // seed them all rather than leaving non-cross pairs frozen.
    if (nonFiat.has(b)) continue;
    const slot = multiScan.results[pos.pair] || {};
    if (Date.now() - (slot.priceUpdatedAt || 0) < 120000) continue;
    const r = await fetchLivePrice(b, q).catch(() => null);
    if (r && Number.isFinite(r.price) && r.price > 0) {
      multiScan.results[pos.pair] = Object.assign({}, slot, { price: r.price, priceUpdatedAt: Date.now() });
    }
  }
}

function renderLivePrice(el) {
  if (livePrice.price == null) { el.textContent = ""; el.style.display = "none"; return; }
  el.style.display = "inline";
  const change = livePrice.change;
  const arrow = change == null ? "" : change >= 0 ? "▲" : "▼";
  const color = change == null ? "#8c98a5" : change >= 0 ? "#3fb950" : "#f85149";
  const pair = `${state.base}/${state.quote}`;
  el.innerHTML = `${pair} <strong>${formatPrice(livePrice.price, pair)}</strong> <span style="color:${color};font-size:.7rem">${arrow}${change != null ? (change >= 0 ? "+" : "") + change.toFixed(2) + "%" : ""}</span>`;
}

let ws = null;
function connectWS() {
  const binancePairs = scanPairs.filter(p => nonFiat.has(p.split("/")[0]) || (binanceFiat.has(p.split("/")[0]) && p.split("/")[1] === "USD"));
  if (binancePairs.length === 0) return;
  const streams = binancePairs.map(p => { const [b, q] = p.split("/"); return `${binanceSymbol(b, q).toLowerCase()}@ticker`; }).join("/");
  try {
    ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (!msg.data) return;
        const sym = msg.data.s;
        const price = Number(msg.data.c);
        const change = Number(msg.data.P);
        const pair = binancePairs.find(p => binanceSymbol(p.split("/")[0], p.split("/")[1]) === sym);
        if (!pair) return;
        if (multiScan.results[pair]) { multiScan.results[pair].price = price; multiScan.results[pair].change = change; }
        const pId = `op-${pair.replace("/","-")}`;
        const cId = `oc-${pair.replace("/","-")}`;
        const pEl = document.getElementById(pId);
        if (pEl) pEl.textContent = formatPrice(price, pair);
        const cEl = document.getElementById(cId);
        if (cEl) { cEl.textContent = (change >= 0 ? "+" : "") + change.toFixed(1) + "%"; cEl.className = change >= 0 ? "chg-up" : "chg-down"; }
        document.querySelectorAll(".pos-row").forEach(row => {
          if (row.classList.contains("closed")) return;
          const pe = row.querySelector(".pos-pair");
          if (!pe || pe.textContent !== pair) return;
          const spans = row.querySelectorAll(".pos-meta span");
          if (spans.length >= 2) spans[1].textContent = "Cur " + formatPrice(price, pair);
          const pos = positions.find(p => !p.closedAt && p.pair === pair);
          if (!pos) return;
          const pnlVal = pos.direction === "BUY" ? price - pos.entry : pos.entry - price;
          const pnlPct = pos.entry ? (pnlVal / pos.entry) * 100 : 0;
          updateTrailingStop(pos, price);
          savePositions();
          const hitStop = pos.direction === "BUY" ? price <= pos.stop : price >= pos.stop;
          const hitTarget = pos.direction === "BUY" ? price >= pos.target : price <= pos.target;
          if (hitStop || hitTarget) { closeTrade(pos.id, price); return; }
          const pnlEl = row.querySelector(".pos-profit, .pos-loss");
          if (pnlEl) { pnlEl.textContent = (pnlVal >= 0 ? "+" : "") + pnlPct.toFixed(2) + "%"; pnlEl.className = pnlVal >= 0 ? "pos-profit" : "pos-loss"; }
        });
      } catch {}
    };
    ws.onclose = () => { ws = null; setTimeout(connectWS, 5000); };
  } catch {}
}

async function updateOverviewPrices() {
  const pairs = scanPairs;
  if (pairs.length === 0) return;
  try {
    const crypto = pairs.filter(p => nonFiat.has(p.split("/")[0]) && p.split("/")[1] === "USD");
    const cryptoCross = pairs.filter(p => nonFiat.has(p.split("/")[0]) && p.split("/")[1] !== "USD");
    const binanceFx = pairs.filter(p => !nonFiat.has(p.split("/")[0]) && binanceFiat.has(p.split("/")[0]) && p.split("/")[1] === "USD");
    const fx = pairs.filter(p => !nonFiat.has(p.split("/")[0]) && !binanceFx.includes(p));
    const results = {};
    const allBinance = [...crypto, ...binanceFx];
    if (allBinance.length > 0) {
      const data = await Promise.all(allBinance.map(async (pair) => {
        const [base, quote] = pair.split("/");
        try {
          const symbol = binanceSymbol(base, quote);
          const result = await cachedJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, {
            ttl: MARKET_TTL.ticker,
            key: `binance-ticker:${symbol}`,
            provider: "binance",
          });
          const d = result.data;
          const price = Number(d.lastPrice);
          if (!Number.isFinite(price)) return null;
          return { pair, price, change: Number(d.priceChangePercent) };
        } catch { return null; }
      }));
      for (const d of data) { if (d) results[d.pair] = d; }
    }
    // Frankfurter only serves the currencies it still publishes (BGN is gone),
    // so split the FX batch: supported legs go to Frankfurter, everything else
    // (including crypto/crypto crosses) converts through currency-api.
    const ffPairs = fx.filter((p) => {
      const [b, q] = p.split("/");
      return frankfurterCurrencies.has(b) && frankfurterCurrencies.has(q);
    });
    const ffBases = [...new Set(ffPairs.map(p => p.split("/")[0]))];
    const altPairs = fx.filter(p => !ffPairs.includes(p)).concat(cryptoCross);
    const altBases = [...new Set(altPairs.map(p => p.split("/")[0]))];
    if (ffBases.length > 0) {
      const fxData = await Promise.all(ffBases.map(async (base) => {
        try {
          const result = await cachedJson(`https://api.frankfurter.dev/v1/latest?from=${base}`, {
            ttl: MARKET_TTL.fxLatest,
            key: `fx-latest:${base}`,
            provider: "frankfurter",
          });
          return { base, rates: result.data.rates };
        } catch { return null; }
      }));
      for (const fd of fxData) {
        if (!fd) continue;
        for (const pair of ffPairs) {
          const [b, q] = pair.split("/");
          if (b !== fd.base) continue;
          const rate = fd.rates[q];
          if (rate && multiScan.results[pair]) {
            results[pair] = { pair, price: rate, change: null };
          }
        }
      }
    }
    if (altBases.length > 0) {
      const altData = await Promise.all(altBases.map(async (base) => {
        const key = base.toLowerCase();
        try {
          const result = await cachedJson(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${key}.min.json`, {
            ttl: MARKET_TTL.currency,
            key: `currency:${key}`,
            provider: "currency",
          });
          return { base, table: result.data[key] || {} };
        } catch { return null; }
      }));
      for (const ad of altData) {
        if (!ad) continue;
        for (const pair of altPairs) {
          const [b, q] = pair.split("/");
          if (b !== ad.base) continue;
          const rate = ad.table[q.toLowerCase()];
          if (rate && multiScan.results[pair]) {
            results[pair] = { pair, price: rate, change: null };
          }
        }
      }
    }
    for (const pair of Object.keys(results)) {
      if (multiScan.results[pair]) {
        multiScan.results[pair].price = results[pair].price;
        if (results[pair].change != null) multiScan.results[pair].change = results[pair].change;
      }
    }
    for (const pair of Object.keys(results)) {
      const pEl = document.getElementById(`op-${pair.replace("/","-")}`);
      const d = multiScan.results[pair];
      if (pEl && d && d.price != null) pEl.textContent = formatPrice(d.price, pair);
      const cEl = document.getElementById(`oc-${pair.replace("/","-")}`);
      if (cEl && d && d.change != null) {
        cEl.textContent = (d.change >= 0 ? "+" : "") + d.change.toFixed(1) + "%";
        cEl.className = d.change >= 0 ? "chg-up" : "chg-down";
      }
    }
    document.querySelectorAll(".pos-row").forEach(row => {
      if (row.classList.contains("closed")) return;
      const pair = row.querySelector(".pos-pair")?.textContent;
      if (!pair) return;
      const d = multiScan.results[pair];
      if (!d || d.price == null) return;
      const spans = row.querySelectorAll(".pos-meta span");
      if (spans.length >= 2) spans[1].textContent = "Cur " + formatPrice(d.price, pair);
      const pos = positions.find(p => !p.closedAt && p.pair === pair);
      if (!pos) return;
      const price = d.price;
      const pnlVal = pos.direction === "BUY" ? price - pos.entry : pos.entry - price;
      const pnlPct = pos.entry ? (pnlVal / pos.entry) * 100 : 0;
      updateTrailingStop(pos, price);
      savePositions();
      const hitStop = pos.direction === "BUY" ? price <= pos.stop : price >= pos.stop;
      const hitTarget = pos.direction === "BUY" ? price >= pos.target : price <= pos.target;
      if (hitStop || hitTarget) { closeTrade(pos.id, price); return; }
      const pnlEl = row.querySelector(".pos-profit, .pos-loss");
      if (pnlEl) {
        pnlEl.textContent = (pnlVal >= 0 ? "+" : "") + pnlPct.toFixed(2) + "%";
        pnlEl.className = pnlVal >= 0 ? "pos-profit" : "pos-loss";
      }
    });
  } catch (e) { console.warn("livePrice update error:", e); }
}

let scanCountdown = 60;
let scanCountdownId = null;

function startAutoScan() {
  if (autoScan.intervalId) return;
  autoScan.enabled = true;
  scanCountdown = 60;
  updateScanUI();
  (async () => {
    await loadDataOnly();
    recordSignal();
    evaluateAlertConditions();
    render();
    await verifySignals();
    await checkAlerts();
    await updateLivePrice();
    if (livePrice.intervalId) clearInterval(livePrice.intervalId);
    livePrice.intervalId = setInterval(updateLivePrice, 30000);
  })();
  if (scanCountdownId) clearInterval(scanCountdownId);
  scanCountdownId = setInterval(() => { scanCountdown = Math.max(0, scanCountdown - 1); const el = document.getElementById("scanCountdown"); if (el) el.textContent = scanCountdown + "s"; }, 1000);
  autoScan.intervalId = setInterval(async () => {
    scanCountdown = 60;
    await loadDataOnly();
    recordSignal();
    evaluateAlertConditions();
    render();
    await verifySignals();
    await checkAlerts();
  }, 60000);
}

function stopAutoScan() {
  if (autoScan.intervalId) {
    clearInterval(autoScan.intervalId);
    autoScan.intervalId = null;
  }
  if (scanCountdownId) { clearInterval(scanCountdownId); scanCountdownId = null; }
  if (livePrice.intervalId) {
    clearInterval(livePrice.intervalId);
    livePrice.intervalId = null;
    livePrice.price = null;
    livePrice.change = null;
    livePrice.timestamp = null;
  }
  autoScan.enabled = false;
  updateScanUI();
}

function toggleAutoScan() {
  if (autoScan.enabled) {
    stopAutoScan();
  } else {
    startAutoScan();
fetchEconEvents();
  }
}

function switchTF(tf) {
  const ok = nonFiat.has(state.base) || (binanceFiat.has(state.base) && state.quote === "USD") || fxIntradayable(state.base, state.quote);
  if (state.timeframe === tf) return;
  state.timeframe = tf;
  if (ok) load(); else { loadDataOnly(); render(); }
}

async function loadDataOnly() {
  const requestId = ++activeDataRequestId;
  const base = state.base;
  const quote = state.quote;
  let timeframe = state.timeframe;
  state.status = "loading";
  state.error = "";
  state.notice = "";
  state.isDemo = false;
  state.rows = [];
  state.source = "";
  state.cacheLabel = "";
  try {
    const canUseBinance = nonFiat.has(base) || (binanceFiat.has(base) && quote === "USD");
    const fxIntra = fxIntradayable(base, quote);
    let rows;
    let source;
    let gotExchange = false;
    if (canUseBinance) {
      try {
        rows = await fetchBinanceRows(base, quote, timeframe);
        source = timeframe === "1d"
          ? `${lastCryptoSource} ${names[base]}/${quote} daily prices`
          : `${lastCryptoSource} ${names[base]}/${quote} ${tfLabel(timeframe)} prices`;
        gotExchange = true;
      } catch {}
    }
    if (!gotExchange && fxIntra && timeframe !== "1d") {
      try {
        rows = await fetchForexRows(base, quote, timeframe);
        source = `${fxSourceLabel(base, quote)} ${names[base]}/${quote} ${tfLabel(timeframe)} prices`;
      } catch (intradayError) {
        // Intraday FX is not published for every currency pair by any
        // browser-readable source. Degrade to daily ECB reference rates instead
        // of silently falling back to synthetic demo data.
        rows = await fetchFxRows(base, quote);
        state.timeframe = "1d";
        timeframe = "1d";
        state.notice = `Intraday ${base}/${quote} is unavailable (${intradayError.message}) Showing daily rates instead.`;
        source = "Frankfurter.dev daily ECB reference rates";
      }
    } else if (!gotExchange) {
      const wantedTf = timeframe;
      state.timeframe = "1d";
      timeframe = "1d";
      rows = await fetchFxRows(base, quote);
      source = "Frankfurter.dev daily ECB reference rates";
      if (wantedTf !== "1d") state.notice = `Intraday ${base}/${quote} needs a browser-readable feed. Add a free Twelve Data key in Settings for 1m–1h candles; showing daily rates instead.`;
    }
    if (rows.length < 80) throw new Error("Not enough history for strict signal mode.");
    if (requestId !== activeDataRequestId || base !== state.base || quote !== state.quote || timeframe !== state.timeframe) return false;
    state.rows = rows;
    state.source = source;
    const metaKey = lastHttpMeta && typeof lastHttpMeta.key === "string" ? lastHttpMeta.key : "";
    const chartMeta = /^(binance|bybit|coinbase|fx-daily|td:series):/.test(metaKey) ? lastHttpMeta : null;
    state.cacheLabel = chartMeta && chartMeta.age > 1500 ? formatCacheAge(chartMeta.age) : "";
    state.status = "ready";
    return true;
  } catch (error) {
    if (requestId !== activeDataRequestId || base !== state.base || quote !== state.quote || timeframe !== state.timeframe) return false;
    console.error(`[${base}/${quote}] Data fetch failed:`, error?.message || error);
    state.rows = generateFallbackRows(base, quote);
    state.source = "Offline demo data because live market data could not be reached";
    state.cacheLabel = "";
    state.status = "ready";
    state.isDemo = true;
    state.error = "Live data is unavailable in this browser session. Signals are disabled; the chart below is simulated demo data and must not be traded.";
    return true;
  }
}

async function load() {
  const loadId = ++activeLoadId;
  state.status = "loading";
  state.error = "";
  state.rows = [];
  state.source = "";
  state.cacheLabel = "";
  state.mtf = {};
  render();
  const loaded = await loadDataOnly();
  if (!loaded || loadId !== activeLoadId) return;
  const dataRequestId = activeDataRequestId;
  const canMTF = state.status === "ready" && (nonFiat.has(state.base) || (binanceFiat.has(state.base) && state.quote === "USD") || fxIntradayable(state.base, state.quote));
  if (canMTF) {
    const tfs = mtfContextTfs(state.timeframe).filter(tf => tf !== state.timeframe);
    for (const tf of tfs) {
      try { const rows = (nonFiat.has(state.base) || (binanceFiat.has(state.base) && state.quote === "USD")) ? await fetchBinanceRows(state.base, state.quote, tf) : await fetchForexRows(state.base, state.quote, tf); if (rows.length >= 80)       state.mtf[tf] = analyze(rows, loadStrategyConfig()); } catch {}
    }
  }
  if (loadId !== activeLoadId || dataRequestId !== activeDataRequestId) return;
  recordSignal();
  evaluateAlertConditions();
  render();
  await verifySignals();
  await checkAlerts();
  if (autoScan.enabled) updateLivePrice();
}

