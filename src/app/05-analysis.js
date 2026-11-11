function seededRandom(seedText) {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fallbackStartPrice(base, quote) {
  if (base === "XAU") return 4100;
  if (base === "BTC") return 65000;
  if (base === "ETH") return 3500;
  if (base === "SOL") return 150;
  if (base === "XRP") return 0.50;
  if (base === "ADA") return 0.45;
  if (base === "DOGE") return 0.12;
  if (base === "DOT") return 7.00;
  if (base === "LINK") return 15.00;
  if (base === "AVAX") return 35.00;
  if (base === "LTC") return 85.00;
  if (base === "BCH") return 350.00;
  if (base === "XLM") return 0.11;
  if (base === "TRX") return 0.25;
  if (base === "ETC") return 22.00;
  if (base === "FIL") return 5.00;
  if (base === "HBAR") return 0.08;
  if (base === "ICP") return 10.00;
  if (base === "VET") return 0.03;
  if (base === "ALGO") return 0.15;
  if (base === "GRT") return 0.18;
  if (base === "SAND") return 0.35;
  if (base === "MANA") return 0.40;
  if (base === "IMX") return 1.50;
  if (base === "THETA") return 1.40;
  if (base === "RUNE") return 4.00;
  if (base === "FLOKI") return 0.00015;
  if (base === "WLD") return 2.20;
  if (base === "TON") return 5.00;
  if (base === "EOS") return 0.70;
  if (base === "XTZ") return 0.90;
  if (base === "CHZ") return 0.06;
  if (base === "GALA") return 0.03;
  if (base === "APE") return 1.20;
  if (base === "DYDX") return 1.30;
  if (base === "PYTH") return 0.35;
  if (base === "JTO") return 2.50;
  if (base === "ORDI") return 40.00;
  if (base === "PENDLE") return 5.00;
  if (base === "EIGEN") return 3.50;
  if (quote === "JPY") return 160;
  if (base === "GBP") return 1.27;
  if (base === "EUR") return 1.08;
  if (base === "USD") { const q = { CHF: 0.89, SGD: 1.35, NOK: 10.8, SEK: 10.5, DKK: 6.9, PLN: 4.0, CZK: 23.0, HUF: 360, RON: 4.6, ISK: 138, BGN: 1.8, TRY: 34, ZAR: 18, MXN: 18.5, BRL: 5.4, CNY: 7.2, HKD: 7.8, THB: 35, INR: 84, KRW: 1370, ILS: 3.7 }[quote]; if (q) return q; }
  if (base === "AUD") return 0.66;
  if (base === "NZD") return 0.61;
  // Any pair left over is fiat-vs-fiat (e.g. NOK/USD, JPY/USD). Derive it from a
  // USD-per-unit table so the inverted direction is not stuck at 1.0.
  const usdPerUnit = { USD: 1, EUR: 1.08, GBP: 1.27, AUD: 0.66, NZD: 0.61, JPY: 0.0063, CHF: 1.12, SGD: 0.74, NOK: 0.093, SEK: 0.095, DKK: 0.145, PLN: 0.25, CZK: 0.043, HUF: 0.0028, RON: 0.217, ISK: 0.0072, BGN: 0.556, TRY: 0.029, ZAR: 0.055, MXN: 0.054, BRL: 0.18, CNY: 0.139, HKD: 0.128, THB: 0.029, INR: 0.0119, KRW: 0.00073, ILS: 0.27 };
  const bRate = usdPerUnit[base];
  const qRate = usdPerUnit[quote];
  if (bRate && qRate) return bRate / qRate;
  return 1.0;
}

function generateFallbackRows(base, quote) {
  const random = seededRandom(`${base}/${quote}`);
  const rows = [];
  const date = new Date();
  date.setDate(date.getDate() - 620);
  let close = fallbackStartPrice(base, quote);
  const dailyVol = base === "XAU" ? 0.008 : nonFiat.has(base) ? 0.025 : quote === "JPY" ? 0.0045 : 0.0038;
  const drift = base === "XAU" ? 0.00008 : nonFiat.has(base) ? 0.0005 : random() > 0.5 ? 0.00012 : -0.0001;

  while (rows.length < 430) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day === 0 || day === 6) continue;
    const wave = Math.sin(rows.length / 18) * dailyVol * 0.42;
    const shock = (random() - 0.5) * dailyVol;
    const previous = close;
    close = Math.max(0.0001, close * (1 + drift + wave + shock));
    rows.push(makeOhlc(date.toISOString().slice(0, 10), close, previous));
  }
  return rows;
}

function detectRegime(rows) {
  if (rows.length < 30) return { type: "ranging", adx: 0 };
  const period = 14;
  const len = rows.length;
  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < len; i++) {
    tr.push(Math.max(
      rows[i].high - rows[i].low,
      Math.abs(rows[i].high - rows[i - 1].close),
      Math.abs(rows[i].low - rows[i - 1].close)
    ));
    const upMove = rows[i].high - rows[i - 1].high;
    const downMove = rows[i - 1].low - rows[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  if (tr.length < period * 2) return { type: "ranging", adx: 0 };
  const smoothedTR = ema(tr, period);
  const smoothedPlusDM = ema(plusDM, period);
  const smoothedMinusDM = ema(minusDM, period);
  const dxValues = [];
  for (let i = 0; i < tr.length; i++) {
    if (smoothedTR[i] == null || smoothedTR[i] === 0 || smoothedPlusDM[i] == null || smoothedMinusDM[i] == null) continue;
    const plusDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
    const minusDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
    const sum = plusDI + minusDI;
    dxValues.push(sum === 0 ? 0 : Math.abs(plusDI - minusDI) / sum * 100);
  }
  if (dxValues.length < period) return { type: "ranging", adx: 0 };
  const adxArr = ema(dxValues, period);
  const adx = adxArr[adxArr.length - 1] || 0;
  return { type: adx > 25 ? "trending" : "ranging", adx: Math.round(adx * 10) / 10 };
}

function computeIchimoku(rows) {
  const len = rows.length;
  const tenkan = Array(len).fill(null);
  const kijun = Array(len).fill(null);
  const senkouA = Array(len).fill(null);
  const senkouB = Array(len).fill(null);
  const chikou = Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    if (i >= 8) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - 8; j <= i; j++) { hi = Math.max(hi, rows[j].high); lo = Math.min(lo, rows[j].low); }
      tenkan[i] = (hi + lo) / 2;
    }
    if (i >= 25) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - 25; j <= i; j++) { hi = Math.max(hi, rows[j].high); lo = Math.min(lo, rows[j].low); }
      kijun[i] = (hi + lo) / 2;
    }
    if (i >= 25) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - 52; j <= i; j++) { if (j >= 0) { hi = Math.max(hi, rows[j].high); lo = Math.min(lo, rows[j].low); } }
      senkouB[i] = (hi + lo) / 2;
    }
    if (tenkan[i] != null && kijun[i] != null) senkouA[i] = (tenkan[i] + kijun[i]) / 2;
    chikou[i] = rows[i].close;
  }
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

function findFibLevels(rows, lookback) {
  const slice = rows.slice(-lookback);
  let hi = -Infinity, lo = Infinity, hiIdx = 0, loIdx = 0;
  slice.forEach((r, i) => { if (r.high > hi) { hi = r.high; hiIdx = i; } if (r.low < lo) { lo = r.low; loIdx = i; } });
  const range = hi - lo;
  if (range <= 0) return [];
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
  const isFibUp = loIdx < hiIdx;
  return levels.map(pct => ({ pct, price: isFibUp ? lo + range * pct : hi - range * pct, label: (pct * 100).toFixed(1) + "%" }));
}

function ichimokuCloudColor(senkouA, senkouB) {
  if (senkouA == null || senkouB == null) return "rgba(100,140,180,0.08)";
  return senkouA > senkouB ? "rgba(63,185,80,0.12)" : "rgba(248,81,73,0.12)";
}

function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;
  const xs = x.slice(-n), ys = y.slice(-n);
  const mx = xs.reduce((s,v) => s+v, 0) / n;
  const my = ys.reduce((s,v) => s+v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a*b; dx += a*a; dy += b*b; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

function corrColor(v) {
  if (v >= 0.7) return "#2ea043";
  if (v >= 0.3) return "#3fb950";
  if (v >= -0.3) return "#73808d";
  if (v >= -0.7) return "#da7733";
  return "#da3633";
}

async function computeCorrelationMatrix() {
  corrData.running = true;
  corrData.matrix = null;
  const pairs = scanPairs.slice(0, 10);
  corrData.pairs = pairs;
  const returns = {};
  for (const pair of pairs) {
    const [base, quote] = pair.split("/");
    try {
      const rows = (nonFiat.has(base) || (binanceFiat.has(base) && quote === "USD")) ? await fetchBinanceRows(base, quote, "1d", 90) : await fetchFxRows(base, quote);
      if (rows.length >= 30) {
        returns[pair] = rows.slice(-60).map((r, i, arr) => i > 0 ? (r.close - arr[i-1].close) / arr[i-1].close : 0).slice(1);
      }
    } catch {}
  }
  const matrix = pairs.map(p1 => pairs.map(p2 => {
    if (!returns[p1] || !returns[p2]) return 0;
    return pearsonCorrelation(returns[p1], returns[p2]);
  }));
  corrData.matrix = matrix;
  corrData.running = false;
  render();
}

function kellyFraction(winRate, avgWin, avgLoss) {
  if (avgWin <= 0 || avgLoss <= 0) return 0;
  const b = avgWin / avgLoss;
  const kelly = (winRate * b - (1 - winRate)) / b;
  return Math.max(0, Math.min(kelly * 0.5, 0.25));
}

function runMonteCarlo(trades, iterations) {
  if (trades.length < 5) return null;
  const wins = trades.filter(t => t.result === "win");
  const losses = trades.filter(t => t.result === "loss");
  if (wins.length === 0 && losses.length === 0) return null;
  const pnls = trades.map(t => t.pnlPct);
  const n = pnls.length;
  const results = [];
  for (let iter = 0; iter < iterations; iter++) {
    const shuffled = [...pnls];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    let eq = 0, peak = 0, maxDD = 0;
    const curve = [0];
    for (const pnl of shuffled) { eq += pnl; curve.push(eq); if (eq > peak) peak = eq; const dd = peak - eq; if (dd > maxDD) maxDD = dd; }
    results.push({ curve, finalEq: eq, maxDD });
  }
  results.sort((a, b) => a.finalEq - b.finalEq);
  const pct = (p) => results[Math.floor(p * results.length)]?.finalEq || 0;
  const ddPct = (p) => results[Math.floor(p * results.length)]?.maxDD || 0;
  const medianCurve = results[Math.floor(0.5 * results.length)]?.curve || [0];
  return {
    p5: pct(0.05), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p95: pct(0.95),
    medianDD: ddPct(0.5), worstDD: ddPct(0.95),
    medianCurve,
  };
}

async function runWalkForward() {
  if (wfState.running) return;
  wfState.running = true;
  wfState.results = null;
  wfState.progress = "";
  render();
  try {
    const rows = await fetchBinanceRows(state.base, state.quote, "1d", 1000);
    if (rows.length < 300) { wfState.running = false; render(); return; }
    const paramGrid = [
      { threshold: 4 }, { threshold: 5 }, { threshold: 6 },
      { riskRewardRatio: 1.5 }, { riskRewardRatio: 2.0 }, { riskRewardRatio: 2.5 },
      { volumeMultiplier: 1.1 }, { volumeMultiplier: 1.3 }, { volumeMultiplier: 1.5 },
    ];
    const windowSize = 200;
    const testSize = 50;
    const segments = Math.floor((rows.length - windowSize) / testSize);
    const wfResults = [];
    for (let seg = 0; seg < segments; seg++) {
      wfState.progress = `${seg + 1}/${segments}`;
      if (seg % 3 === 0) { await new Promise(r => setTimeout(r, 0)); render(); }
      const trainStart = seg * testSize;
      const trainEnd = trainStart + windowSize;
      const testEnd = Math.min(trainEnd + testSize, rows.length);
      if (testEnd > rows.length) break;
      const trainData = rows.slice(trainStart, trainEnd);
      const testData = rows.slice(trainEnd, testEnd);
      let bestCfg = loadStrategyConfig();
      let bestScore = -Infinity;
      let bestTrainWR = 0;
      for (const overrides of paramGrid) {
        const cfg = { ...loadStrategyConfig(), ...overrides };
        const trades = [];
        for (let i = 80; i < trainData.length; i++) {
          const a = analyze(trainData.slice(0, i + 1), cfg);
          if (!a || a.direction === "WAIT") continue;
          const entry = a.entry;
          const isBuy = a.direction === "BUY";
          const riskPct = isBuy ? ((entry - a.stop) / entry) * 100 : ((a.stop - entry) / entry) * 100;
          const rewardPct = isBuy ? ((a.target - entry) / entry) * 100 : ((entry - a.target) / entry) * 100;
          let result = "pending", pnlPct = 0;
          const ex1 = resolveTradeExit(trainData, i, isBuy, a.stop, a.target);
          if (ex1.result !== "pending") { result = ex1.result; pnlPct = result === "win" ? rewardPct : -riskPct; }
          if (result !== "pending") trades.push({ result, pnlPct });
        }
        const w = trades.filter(t => t.result === "win").length;
        const l = trades.filter(t => t.result === "loss").length;
        const score = trades.length > 0 ? (w / trades.length) * 100 + (trades.reduce((s,t) => s + t.pnlPct, 0) * 0.5) : 0;
        if (score > bestScore) { bestScore = score; bestCfg = cfg; bestTrainWR = trades.length > 0 ? (w / trades.length) * 100 : 0; }
      }
      const testTrades = [];
      for (let i = 80; i < testData.length; i++) {
        const a = analyze(testData.slice(0, i + 1), bestCfg);
        if (!a || a.direction === "WAIT") continue;
        const entry = a.entry;
        const isBuy = a.direction === "BUY";
        const riskPct = isBuy ? ((entry - a.stop) / entry) * 100 : ((a.stop - entry) / entry) * 100;
        const rewardPct = isBuy ? ((a.target - entry) / entry) * 100 : ((entry - a.target) / entry) * 100;
        let result = "pending", pnlPct = 0;
        const ex2 = resolveTradeExit(testData, i, isBuy, a.stop, a.target);
        if (ex2.result !== "pending") { result = ex2.result; pnlPct = result === "win" ? rewardPct : -riskPct; }
        if (result !== "pending") testTrades.push({ result, pnlPct });
      }
      const tw = testTrades.filter(t => t.result === "win").length;
      const tl = testTrades.filter(t => t.result === "loss").length;
      wfResults.push({ segment: seg + 1, trainRange: `${trainData[0]?.date}→${trainData.at(-1)?.date}`, testRange: `${testData[0]?.date}→${testData.at(-1)?.date}`, trainWR: Math.round(bestTrainWR), testWR: testTrades.length > 0 ? Math.round((tw / testTrades.length) * 100) : 0, testTrades: testTrades.length, testPnL: testTrades.reduce((s, t) => s + t.pnlPct, 0) });
    }
    const totalTestTrades = wfResults.reduce((s, r) => s + r.testTrades, 0);
    const avgTestWR = totalTestTrades > 0 ? Math.round(wfResults.reduce((s, r) => s + r.testWR, 0) / Math.max(wfResults.length, 1)) : 0;
    const totalTestPnL = wfResults.reduce((s, r) => s + r.testPnL, 0);
    wfState.results = { segments: wfResults, totalTestTrades, avgTestWR, totalTestPnL };
  } catch {}
  wfState.running = false;
  render();
}

async function runStrategyOptimizer() {
  if (optimizerState.running) return;
  optimizerState.running = true;
  optimizerState.results = null;
  optimizerState.progress = "";
  render();
  try {
    const rows = await fetchBinanceRows(state.base, state.quote, "1d", 800);
    if (rows.length < 200) { optimizerState.running = false; render(); return; }
    const thresholds = [4, 5, 6];
    const rrs = [1.5, 2.0, 2.5, 3.0];
    const volMults = [1.1, 1.3, 1.5];
    const combinations = [];
    for (const t of thresholds) for (const r of rrs) for (const v of volMults) combinations.push({ threshold: t, riskRewardRatio: r, volumeMultiplier: v, volatilityMedianMultiplier: 2.5, rsiBuyThreshold: 55, rsiSellThreshold: 45 });
    const total = combinations.length;
    const results = [];
    for (let i = 0; i < total; i++) {
      optimizerState.progress = `${i + 1}/${total}`;
      if (i % 5 === 0) { await new Promise(r => setTimeout(r, 0)); render(); }
      const cfg = combinations[i];
      const trades = [];
      for (let j = 80; j < rows.length; j++) {
        const a = analyze(rows.slice(0, j + 1), cfg);
        if (!a || a.direction === "WAIT") continue;
        const entry = a.entry;
        const isBuy = a.direction === "BUY";
        const riskPctVal = isBuy ? ((entry - a.stop) / entry) * 100 : ((a.stop - entry) / entry) * 100;
        const rewardPct = isBuy ? ((a.target - entry) / entry) * 100 : ((entry - a.target) / entry) * 100;
        let result = "pending", pnlPct = 0;
        for (let k = j + 1; k < rows.length; k++) {
          if (isBuy) { if (rows[k].high >= a.target) { result = "win"; pnlPct = rewardPct; break; } if (rows[k].low <= a.stop) { result = "loss"; pnlPct = -riskPctVal; break; } }
          else { if (rows[k].low <= a.target) { result = "win"; pnlPct = rewardPct; break; } if (rows[k].high >= a.stop) { result = "loss"; pnlPct = -riskPctVal; break; } }
        }
        if (result !== "pending") trades.push({ result, pnlPct });
      }
      const wins = trades.filter(t => t.result === "win").length;
      const losses = trades.filter(t => t.result === "loss").length;
      const totalT = trades.length;
      const wr = totalT > 0 ? Math.round((wins / totalT) * 100) : 0;
      const avgWin = wins > 0 ? trades.filter(t => t.result === "win").reduce((s, t) => s + t.pnlPct, 0) / wins : 0;
      const avgLoss = losses > 0 ? Math.abs(trades.filter(t => t.result === "loss").reduce((s, t) => s + t.pnlPct, 0) / losses) : 0;
      const pf = losses > 0 ? (Math.abs(trades.filter(t => t.result === "win").reduce((s, t) => s + t.pnlPct, 0)) / Math.abs(trades.filter(t => t.result === "loss").reduce((s, t) => s + t.pnlPct, 0))).toFixed(2) : (wins > 0 ? "\u221E" : "0");
      let eq = 0, peak = -Infinity, maxDD = 0;
      trades.forEach(t => { eq += t.pnlPct; if (eq > peak) peak = eq; const dd = peak - eq; if (dd > maxDD) maxDD = dd; });
      results.push({ cfg: { threshold: cfg.threshold, riskRewardRatio: cfg.riskRewardRatio, volumeMultiplier: cfg.volumeMultiplier }, signals: totalT, winRate: wr, pnl: eq, maxDD: maxDD.toFixed(1) + "%", pf });
    }
    results.sort((a, b) => b.pnl - a.pnl);
    optimizerState.results = results;
  } catch {}
  optimizerState.running = false;
  render();
}

function sendScheduledReport() {
  if (!webhookUrl || !isValidWebhookUrl(webhookUrl)) return;
  const hist = autoScan.history.filter(e => e.direction !== "WAIT");
  const resolved = hist.filter(e => e.result === "win" || e.result === "loss");
  const wins = resolved.filter(e => e.result === "win").length;
  const losses = resolved.filter(e => e.result === "loss").length;
  const wr = resolved.length > 0 ? Math.round((wins / resolved.length) * 100) : 0;
  const closed = positions.filter(p => p.closedAt);
  const totalPnl = closed.reduce((s, p) => s + (p.pnlCurrency || 0), 0);
  const open = positions.filter(p => !p.closedAt);
  const msg = `📊 *${strategyName || "Trading"} Performance Report*\n\nWin Rate: ${wr}% (${wins}W/${losses}L)\nTotal Signals: ${hist.length}\nTotal P/L: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}\nOpen Positions: ${open.length}\nTimestamp: ${new Date().toLocaleString()}`;
  fetch(webhookUrl + (webhookUrl.includes("?") ? "&" : "?") + "parse_mode=Markdown&text=" + encodeURIComponent(msg)).catch(() => {});
  scheduleState.lastSent = new Date();
  saveScheduleState();
}

function startSchedule() {
  if (scheduleState.intervalId) return;
  scheduleState.enabled = true;
  scheduleState.intervalId = setInterval(sendScheduledReport, 6 * 60 * 60 * 1000);
  saveScheduleState();
}

function stopSchedule() {
  if (scheduleState.intervalId) { clearInterval(scheduleState.intervalId); scheduleState.intervalId = null; }
  scheduleState.enabled = false;
  saveScheduleState();
}

function startReplay(pair) {
  if (replayState.intervalId) { clearInterval(replayState.intervalId); replayState.intervalId = null; }
  const [base, quote] = pair.split("/");
  replayState.pair = pair;
  replayState.trades = [];
  replayState.direction = null;
  replayState.confidence = 0;
  fetchBinanceRows(base, quote, "1d", 500).then(rows => {
    if (rows.length < 120) return;
    replayState.rows = rows;
    replayState.currentBar = 120;
    replayState.active = true;
    advanceReplay();
    render();
  });
}

function advanceReplay() {
  const { rows, currentBar } = replayState;
  if (currentBar >= rows.length) { stopReplay(); return; }
  const slice = rows.slice(0, currentBar + 1);
  const cfg = loadStrategyConfig();
  const analysis = slice.length >= 80 ? analyze(slice, cfg) : null;
  replayState.direction = analysis?.direction || "WAIT";
  replayState.confidence = analysis?.confidence || 0;
  if (analysis && analysis.direction !== "WAIT") {
    const lastPrice = rows[currentBar].close;
    const isBuy = analysis.direction === "BUY";
    let result = null;
    for (let j = currentBar + 1; j < Math.min(currentBar + 30, rows.length); j++) {
      if (isBuy) { if (rows[j].high >= analysis.target) { result = "win"; break; } if (rows[j].low <= analysis.stop) { result = "loss"; break; } }
      else { if (rows[j].low <= analysis.target) { result = "win"; break; } if (rows[j].high >= analysis.stop) { result = "loss"; break; } }
    }
    replayState.trades.push({ bar: currentBar, date: rows[currentBar].date, direction: analysis.direction, confidence: analysis.confidence, entry: analysis.entry, stop: analysis.stop, target: analysis.target, result: result || "pending" });
  }
}

function stopReplay() {
  if (replayState.intervalId) { clearInterval(replayState.intervalId); replayState.intervalId = null; }
  replayState.active = false;
}

function stepReplay() {
  if (!replayState.active) return;
  replayState.currentBar++;
  advanceReplay();
  render();
}

function toggleReplayPlay() {
  if (replayState.intervalId) { clearInterval(replayState.intervalId); replayState.intervalId = null; render(); return; }
  replayState.intervalId = setInterval(() => { if (replayState.currentBar >= replayState.rows.length) { stopReplay(); render(); return; } replayState.currentBar++; advanceReplay(); render(); }, replayState.speed);
  render();
}

function addPaperTrade(direction, pair, entry, stop, target, signalId, sizeFactor) {
  const id = Date.now();
  paperState.openPositions.push({ id, pair, direction, entry, stop, target, time: new Date(), exitPrice: null, pnlPct: 0, size: sizeFactor || 1, originalStop: stop, takenPartial: false, highWater: entry, lowWater: entry, signalId: signalId || null });
  savePaperState();
  return id;
}

function openManualPaperTrade(direction) {
  const els = ["paperEntry", "paperStop", "paperTarget"].map(id => document.getElementById(id));
  const entry = els[0] ? Number(els[0].value) : NaN;
  const stop = els[1] ? Number(els[1].value) : NaN;
  const target = els[2] ? Number(els[2].value) : NaN;
  if (![entry, stop, target].every(Number.isFinite) || entry <= 0 || stop <= 0 || target <= 0) {
    showToast("Enter valid Entry, Stop and Target prices.", "warn");
    return;
  }
  const valid = direction === "BUY" ? (stop < entry && target > entry) : (stop > entry && target < entry);
  if (!valid) {
    showToast("Prices must satisfy stop–entry–target ordering.", "warn");
    return;
  }
  const sf = mlSizingFactor(state.rows.length > 0 ? analyze(state.rows, loadStrategyConfig()) : null, 0.5);
  addPaperTrade(direction, `${state.base}/${state.quote}`, entry, stop, target, null, sf);
  showToast(`Opened paper ${direction} on ${state.base}/${state.quote} (size ${sf.toFixed(2)}x)`, "ok");
  render();
}

function closePaperTrade(id, exitPrice) {
  const pos = paperState.openPositions.find(p => p.id === id);
  if (!pos) return;
  pos.exitPrice = exitPrice;
  pos.pnlPct = pos.direction === "BUY" ? ((exitPrice - pos.entry) / pos.entry) * 100 : ((pos.entry - exitPrice) / pos.entry) * 100;
  pos.closedTime = new Date();
  paperState.balance += paperState.balance * (pos.pnlPct / 100) * (pos.size ?? 1);
  paperState.trades.push({ ...pos });
  paperState.openPositions = paperState.openPositions.filter(p => p.id !== id);
  paperState.equityCurve.push({ time: new Date(), balance: paperState.balance });
  savePaperState();
  if (pos.signalId != null) {
    const entry = autoScan.history.find(e => e.id === pos.signalId);
    if (entry && entry.result === "pending") {
      entry.result = pos.pnlPct >= 0 ? "win" : "loss";
      entry.exitPrice = exitPrice;
      entry.pnlPct = pos.pnlPct;
      entry.closedTime = new Date();
      saveHistory();
      mlTrainEntry(entry);
    }
  }
}

function autoCheckPaperPositions() {
  const partCfg = loadStrategyConfig().partialTakePct ?? 50;
  const atrMult = loadStrategyConfig().trailingAtrMult ?? 3;
  for (const pos of [...paperState.openPositions]) {
    const r = multiScan.results[pos.pair];
    if (!r || !r.price) continue;
    const price = r.price;
    const isBuy = pos.direction === "BUY";
    const risk = Math.abs(pos.entry - pos.originalStop);
    if (risk <= 0) continue;
    if (isBuy) pos.highWater = Math.max(pos.highWater || pos.entry, price);
    else pos.lowWater = Math.min(pos.lowWater || pos.entry, price);
    const favorDist = isBuy ? price - pos.entry : pos.entry - price;
    const hitStop = isBuy ? price <= pos.stop : price >= pos.stop;
    const hitTarget = isBuy ? price >= pos.target : price <= pos.target;
    if (hitStop || hitTarget) { closePaperTrade(pos.id, price); continue; }
    const atHalf = favorDist >= risk * 1;
    if (atHalf && !pos.takenPartial) {
      pos.takenPartial = true;
      const partPct = partCfg;
      const remainPct = Math.max(0, 1 - partPct / 100);
      if (remainPct > 0) {
        const partialPnl = favorDist / pos.entry * 100 * (partPct / 100);
        paperState.balance += paperState.balance * (partialPnl / 100);
        pos.size = remainPct;
        const be = isBuy ? pos.entry + Math.max(risk * 0.1, Math.abs(pos.entry - pos.entry) === 0 ? 0 : risk * 0.1) : pos.entry - Math.max(risk * 0.1, risk * 0.1);
        if (isBuy) pos.stop = Math.max(pos.stop, pos.entry + risk * 0.1);
        else pos.stop = Math.min(pos.stop, pos.entry - risk * 0.1);
        paperState.equityCurve.push({ time: new Date(), balance: paperState.balance });
        savePaperState();
      } else {
        closePaperTrade(pos.id, price); continue;
      }
    }
    if (atHalf) {
      const newStop = isBuy
        ? Math.max(pos.stop, pos.entry + risk * 0.4)
        : Math.min(pos.stop, pos.entry - risk * 0.4);
      if (isBuy && newStop > pos.stop) { pos.stop = newStop; }
      if (!isBuy && newStop < pos.stop) { pos.stop = newStop; }
    }
  }
}

