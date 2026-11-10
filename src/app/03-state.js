function cleanPair(value) {
  const pair = cleanText(value, 24).toUpperCase().trim();
  return PAIR_RE.test(pair) ? pair : null;
}

function sanitizePairList(raw, limit = 500) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw.slice(0, limit)) {
    const pair = cleanPair(item);
    if (pair && !seen.has(pair)) { seen.add(pair); out.push(pair); }
  }
  return out;
}

// Only https URLs for Discord or Telegram are accepted. A malicious imported
// backup must not be able to point the webhook at an arbitrary host.
const WEBHOOK_HOSTS = new Set(["discord.com", "discordapp.com", "api.telegram.org"]);

function isValidWebhookUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (WEBHOOK_HOSTS.has(host)) return true;
  return host.endsWith(".discord.com") || host.endsWith(".discordapp.com");
}

function sanitizeHistoryEntry(raw) {
  if (!isPlainObject(raw)) return null;
  const pair = cleanPair(raw.pair);
  const timestamp = new Date(raw.timestamp);
  const direction = raw.direction === "BUY" || raw.direction === "SELL" ? raw.direction : null;
  if (!pair || !direction || Number.isNaN(timestamp.getTime())) return null;
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.slice(0, 20).map((reason) => ({
        ok: !!(isPlainObject(reason) && reason.ok),
        text: cleanText(isPlainObject(reason) ? reason.text : reason, 240),
      }))
    : [];
  return {
    id: numOrNull(raw.id) ?? timestamp.getTime(),
    timestamp,
    pair,
    direction,
    confidence: clampNum(raw.confidence, 0, 100, 0),
    risk: cleanText(raw.risk, 48) || "No trade",
    entry: numOrNull(raw.entry),
    stop: numOrNull(raw.stop),
    target: numOrNull(raw.target),
    volatilityPct: Math.max(0, numOrNull(raw.volatilityPct) ?? 0),
    buyScore: numOrNull(raw.buyScore) ?? 0,
    sellScore: numOrNull(raw.sellScore) ?? 0,
    reasons,
    result: ["win", "loss", "pending"].includes(raw.result) ? raw.result : "pending",
  };
}

function sanitizePosition(raw) {
  if (!isPlainObject(raw)) return null;
  const pair = cleanPair(raw.pair);
  const direction = raw.direction === "BUY" || raw.direction === "SELL" ? raw.direction : null;
  const entry = numOrNull(raw.entry);
  const openedAt = new Date(raw.openedAt);
  if (!pair || !direction || entry == null || Number.isNaN(openedAt.getTime())) return null;
  const closedAt = raw.closedAt ? new Date(raw.closedAt) : null;
  return {
    id: typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,48}$/.test(raw.id) ? raw.id : (numOrNull(raw.id) ?? openedAt.getTime()),
    pair,
    direction,
    entry,
    stop: numOrNull(raw.stop),
    target: numOrNull(raw.target),
    openedAt,
    closedAt: closedAt && !Number.isNaN(closedAt.getTime()) ? closedAt : null,
    exitPrice: numOrNull(raw.exitPrice),
    pnl: numOrNull(raw.pnl),
    pnlPct: numOrNull(raw.pnlPct),
    pnlCurrency: numOrNull(raw.pnlCurrency),
    size: numOrNull(raw.size),
    originalStop: numOrNull(raw.originalStop),
    trailingStop: !!raw.trailingStop,
    highWater: numOrNull(raw.highWater),
    lowWater: numOrNull(raw.lowWater),
    atr: numOrNull(raw.atr),
  };
}

function sanitizeAlertHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).map((entry) => {
    if (!isPlainObject(entry)) return null;
    const pair = cleanPair(entry.pair);
    const timestamp = new Date(entry.timestamp);
    if (!pair || Number.isNaN(timestamp.getTime())) return null;
    return {
      timestamp: timestamp.toISOString(),
      pair,
      type: cleanText(entry.type, 32) || "alert",
      message: cleanText(entry.message, 240),
    };
  }).filter(Boolean);
}

function sanitizeAlerts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).map((alert) => {
    if (!isPlainObject(alert)) return null;
    const pair = cleanPair(alert.pair);
    const price = numOrNull(alert.price);
    if (!pair || price == null || price <= 0) return null;
    return {
      id: numOrNull(alert.id) ?? Date.now(),
      pair,
      price,
      dir: alert.dir === "below" ? "below" : "above",
      createdAt: numOrNull(alert.createdAt) ?? Date.now(),
    };
  }).filter(Boolean);
}

function sanitizePriceLevelAlerts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).map((alert) => {
    if (!isPlainObject(alert)) return null;
    const pair = cleanPair(alert.pair);
    const price = numOrNull(alert.price);
    if (!pair || price == null || price <= 0) return null;
    return {
      pair,
      price,
      dir: alert.dir === "below" ? "below" : "above",
      id: numOrNull(alert.id) ?? Date.now(),
    };
  }).filter(Boolean);
}

function sanitizeAlertConditions(raw) {
  if (!isPlainObject(raw)) return;
  for (const key of ["mtf_alignment", "pattern_trend", "high_confidence", "volume_surge"]) {
    const saved = raw[key];
    if (!isPlainObject(saved) || !alertConditions[key]) continue;
    alertConditions[key].enabled = !!saved.enabled;
    const max = key === "high_confidence" ? 100 : 10;
    alertConditions[key].threshold = clampNum(saved.threshold, 0, max, alertConditions[key].threshold);
    alertConditions[key].lastFired = numOrNull(saved.lastFired) ?? 0;
  }
  alertConditions.lastTestResult = cleanText(raw.lastTestResult, 120);
}

function normalizeStrategyConfig(raw) {
  const d = { threshold: 5, riskRewardRatio: 2.0, volumeMultiplier: 1.3, volatilityMedianMultiplier: 2.5, rsiBuyThreshold: 55, rsiSellThreshold: 45, trailingAtrMult: 3, initialRrMult: 1.5, partialTakePct: 50, adxGate: false, feePct: 0.1, riskPerTradePct: 1 };
  if (!isPlainObject(raw)) return { ...d };
  return {
    threshold: Math.round(clampNum(raw.threshold, 3, 7, d.threshold)),
    riskRewardRatio: clampNum(raw.riskRewardRatio, 1, 5, d.riskRewardRatio),
    volumeMultiplier: clampNum(raw.volumeMultiplier, 1, 3, d.volumeMultiplier),
    volatilityMedianMultiplier: clampNum(raw.volatilityMedianMultiplier, 1, 5, d.volatilityMedianMultiplier),
    rsiBuyThreshold: clampNum(raw.rsiBuyThreshold, 30, 70, d.rsiBuyThreshold),
    rsiSellThreshold: clampNum(raw.rsiSellThreshold, 30, 70, d.rsiSellThreshold),
    trailingAtrMult: clampNum(raw.trailingAtrMult, 1, 8, d.trailingAtrMult),
    initialRrMult: clampNum(raw.initialRrMult, 0.5, 5, d.initialRrMult),
    partialTakePct: clampNum(raw.partialTakePct, 0, 100, d.partialTakePct),
    adxGate: !!raw.adxGate,
    feePct: clampNum(raw.feePct, 0, 5, d.feePct),
    riskPerTradePct: clampNum(raw.riskPerTradePct, 0.1, 10, d.riskPerTradePct),
  };
}

function normalizeRiskConfig(raw) {
  const d = { balance: 10000, startingBalance: 10000, riskPct: 1, maxPos: 5, dailyLimit: 5, maxLossStreak: 4, corrCap: 2 };
  if (!isPlainObject(raw)) return { ...d };
  return {
    balance: clampNum(raw.balance, 1, 1e12, d.balance),
    startingBalance: clampNum(raw.startingBalance, 1, 1e12, d.startingBalance),
    riskPct: clampNum(raw.riskPct, 0.1, 10, d.riskPct),
    maxPos: Math.round(clampNum(raw.maxPos, 1, 20, d.maxPos)),
    dailyLimit: clampNum(raw.dailyLimit, 0, 1e9, d.dailyLimit),
    maxLossStreak: Math.round(clampNum(raw.maxLossStreak, 1, 10, d.maxLossStreak)),
    corrCap: Math.round(clampNum(raw.corrCap, 1, 5, d.corrCap)),
  };
}

const ML_FEATURES = ["confidence", "maxScore", "margin", "volatility", "isBuy"];

const mlModel = {
  n: 0, trained: false, minSamples: 8,
  muWin: [0, 0, 0, 0, 0], varWin: [0, 0, 0, 0, 0],
  muLoss: [0, 0, 0, 0, 0], varLoss: [0, 0, 0, 0, 0],
  nWin: 0, nLoss: 0,
};
function mlLoad() {
  try { const s = localStorage.getItem("mlModel"); if (s) Object.assign(mlModel, JSON.parse(s)); } catch {}
  try { const s = localStorage.getItem("mlStats"); if (s) Object.assign(mlStats, JSON.parse(s)); } catch {}
}
function mlSave() {
  try { localStorage.setItem("mlModel", JSON.stringify(mlModel)); } catch {}
  try { localStorage.setItem("mlStats", JSON.stringify(mlStats)); } catch {}
}
function mlReset() {
  mlModel.n = 0; mlModel.trained = false; mlModel.muWin = [0,0,0,0,0]; mlModel.varWin = [0,0,0,0,0];
  mlModel.muLoss = [0,0,0,0,0]; mlModel.varLoss = [0,0,0,0,0]; mlModel.nWin = 0; mlModel.nLoss = 0;
  mlStats = { filtered: 0, filteredCorrect: 0 };
  mlSave();
}
function mlFeaturize(e) {
  const confidence = Number.isFinite(e.confidence) ? Math.max(0, Math.min(100, e.confidence)) : 50;
  const bs = Number.isFinite(e.buyScore) ? e.buyScore : 0;
  const ss = Number.isFinite(e.sellScore) ? e.sellScore : 0;
  const maxScore = Math.max(bs, ss);
  const margin = bs - ss;
  const vol = Number.isFinite(e.volatilityPct) ? Math.max(0, Math.min(20, e.volatilityPct)) : 1.5;
  const isBuy = e.direction === "BUY" ? 1 : 0;
  return [confidence / 100, maxScore / 100, Math.max(-1, Math.min(1, margin / 100)), vol / 10, isBuy];
}
function _updateClass(mu, varr, cnt, f) {
  if (cnt === 0) { for (let i = 0; i < f.length; i++) { mu[i] = f[i]; varr[i] = 0; } return 1; }
  for (let i = 0; i < f.length; i++) {
    const d = f[i] - mu[i];
    mu[i] += d / cnt;
    varr[i] = (varr[i] * (cnt - 1) + d * (f[i] - mu[i])) / cnt;
  }
  return cnt + 1;
}
function mlTrain(features, label, weight) {
  const w = weight || 1;
  if (label === "win") { mlModel.nWin = _updateClass(mlModel.muWin, mlModel.varWin, mlModel.nWin, features); }
  else { mlModel.nLoss = _updateClass(mlModel.muLoss, mlModel.varLoss, mlModel.nLoss, features); }
  mlModel.n++;
  mlModel.trained = mlModel.n >= mlModel.minSamples;
  mlSave();
  return label;
}
function mlTrainEntry(entry) {
  if (!entry || (entry.result !== "win" && entry.result !== "loss")) return;
  const f = mlFeaturize(entry);
  mlTrain(f, entry.result, 1);
}
function mlBatchTrain(history) {
  let trained = 0;
  if (!history) return trained;
  for (const e of history) {
    if (e.result === "win" || e.result === "loss") { mlTrainEntry(e); trained++; }
  }
  mlSave();
  return trained;
}
function _gauss(x, mu, varr) {
  const v = Math.max(varr, 1e-4);
  const d = x - mu;
  return Math.exp(-(d * d) / (2 * v)) / Math.sqrt(2 * Math.PI * v);
}
function mlPredict(features) {
  if (!mlModel.trained) return null;
  const nWin = mlModel.nWin, nLoss = mlModel.nLoss;
  const total = nWin + nLoss;
  if (total < mlModel.minSamples) return null;
  const pClass = (nWin + 1) / (total + 2);
  let lWin = Math.log(nWin + 1) - Math.log(total + 2);
  let lLoss = Math.log(nLoss + 1) - Math.log(total + 2);
  for (let i = 0; i < ML_FEATURES.length; i++) {
    if (nWin > 0) lWin += Math.log(Math.max(_gauss(features[i], mlModel.muWin[i], mlModel.varWin[i]), 1e-12));
    if (nLoss > 0) lLoss += Math.log(Math.max(_gauss(features[i], mlModel.muLoss[i], mlModel.varLoss[i]), 1e-12));
  }
  const maxLog = Math.max(lWin, lLoss);
  const eW = Math.exp(lWin - maxLog), eL = Math.exp(lLoss - maxLog);
  const pWin = eW / (eW + eL);
  return { win: pWin, loss: 1 - pWin, label: pWin >= 0.5 ? "win" : "loss", n: total, pClass };
}
function mlPredictEntry(entry) {
  if (!mlModel.trained) return null;
  return mlPredict(mlFeaturize(entry));
}

function mlFilterPass(analysis) {
  if (!mlFilterEnabled || !analysis) return true;
  if (!mlModel.trained || !analysis.ml) return true;
  return analysis.ml.label === "win";
}

function mlFilterWarn(analysis) {
  return mlFilterEnabled && analysis && analysis.ml && analysis.ml.label === "loss";
}

let mlStats = { filtered: 0, filteredCorrect: 0 };

function mlSizingFactor(analysis, fallbackWR) {
  if (!mlModel.trained || !analysis || !analysis.ml || analysis.ml.win == null) return 1;
  const p = Math.max(0.05, Math.min(0.95, analysis.ml.win));
  const rr = (loadStrategyConfig().riskRewardRatio) || 2;
  const kelly = p - (1 - p) / rr;
  return Math.max(0.5, Math.min(1.5, 1 + kelly * 0.75));
}

let paperAutotrade = false;

function renderMlBadge(analysis) {
  const trained = mlModel.trained;
  const samplePct = Math.min(100, Math.round((mlModel.n / mlModel.minSamples) * 100));
  const bar = `<div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-top:4px"><div style="width:${trained ? 100 : samplePct}%;height:100%;background:${trained ? 'var(--wait)' : 'var(--wait-dim)'};border-radius:3px"></div></div>`;
  let value;
  if (!trained) {
    value = `<div style="text-align:center">training ${mlModel.n}/${mlModel.minSamples}${bar}<div style="font-size:.55rem;color:var(--muted);margin-top:2px">collect ${mlModel.minSamples - mlModel.n} more resolved trades</div></div>`;
  } else if (!analysis || !analysis.ml) {
    value = `<div style="text-align:center"><strong>${mlModel.n} samples</strong><button data-action="ml-reset" style="margin-left:6px;background:none;border:none;color:var(--sell);cursor:pointer;font-size:.6rem" title="Reset ML model">reset</button></div>`;
  } else {
    const ml = analysis.ml;
    const hit = mlStats.filtered + mlStats.filteredCorrect > 0 ? Math.round((mlStats.filteredCorrect / Math.max(1, mlStats.filtered)) * 100) : null;
    value = `<div style="text-align:center"><strong style="color:${ml.label === 'win' ? 'var(--buy)' : mlFilterEnabled ? 'var(--warn-2)' : 'var(--text)'}">${(ml.win * 100).toFixed(0)}% ${ml.label === "win" ? "✅" : "⚠️"}</strong><div style="font-size:.55rem;color:var(--muted);margin-top:2px">${mlFilterEnabled ? `<span style="color:${ml.label === 'loss' ? 'var(--warn-2)' : 'var(--buy)'}">${ml.label === 'loss' ? 'filtered 🚫' : 'pass ✓'}</span> · ` : ""}${ml.n} samples ${hit != null ? `· ${hit}% filt hit` : ""}<button data-action="ml-reset" style="margin-left:6px;background:none;border:none;color:var(--sell);cursor:pointer;font-size:.6rem" title="Reset ML model">reset</button></div></div>`;
  }
  return { label: "ML win prob", value };
}

const paperState = { balance: 10000, startingBalance: 10000, trades: [], openPositions: [], equityCurve: [] };
const replayState = { active: false, pair: "", rows: [], currentBar: 100, trades: [], speed: 500, intervalId: null, direction: null, confidence: 0 };
const mcState = { results: null, running: false, progress: "" };
const wfState = { results: null, running: false, progress: "" };
const optimizerState = { results: null, running: false, progress: "" };
const scheduleState = { enabled: false, intervalId: null, lastSent: null };
const corrData = { matrix: null, pairs: [], running: false };

function loadOverlayPrefs() {
  try { const s = localStorage.getItem("overlayPrefs"); if (s) { const d = JSON.parse(s); ichimokuOverlay = !!d.ichimoku; fibOverlay = !!d.fib; macdHistVote = !!d.macdHist; kellyEnabled = !!d.kelly; vwapOverlay = !!d.vwap; mlFilterEnabled = !!d.ml; paperAutotrade = !!d.paperAuto; } } catch {}
}
function saveOverlayPrefs() { try { localStorage.setItem("overlayPrefs", JSON.stringify({ ichimoku: ichimokuOverlay, fib: fibOverlay, macdHist: macdHistVote, kelly: kellyEnabled, vwap: vwapOverlay, ml: mlFilterEnabled, paperAuto: paperAutotrade })); } catch {} }
function loadPaperState() { try { const s = localStorage.getItem("paperState"); if (s) { const d = JSON.parse(s); Object.assign(paperState, d); paperState.trades = (d.trades || []).map(t => ({...t, time: new Date(t.time)})); paperState.openPositions = (d.openPositions || []).map(t => ({...t, time: new Date(t.time)})); } } catch {} }
function savePaperState() { try { localStorage.setItem("paperState", JSON.stringify({ ...paperState, trades: paperState.trades.map(t => ({...t, time: t.time.toISOString()})), openPositions: paperState.openPositions.map(t => ({...t, time: t.time.toISOString()})) })); } catch {} }
function loadScheduleState() { try { const s = localStorage.getItem("scheduleState"); if (s) { const d = JSON.parse(s); scheduleState.enabled = !!d.enabled; scheduleState.lastSent = d.lastSent ? new Date(d.lastSent) : null; } } catch {} }
function loadTheme() { try { darkTheme = localStorage.getItem("theme") !== "light"; } catch {} applyTheme(); }
function saveTheme() { try { localStorage.setItem("theme", darkTheme ? "dark" : "light"); } catch {} }
function applyTheme() { if (darkTheme) { document.documentElement.removeAttribute("data-theme"); } else { document.documentElement.setAttribute("data-theme", "light"); } }
function saveScheduleState() { try { localStorage.setItem("scheduleState", JSON.stringify({ enabled: scheduleState.enabled, lastSent: scheduleState.lastSent ? scheduleState.lastSent.toISOString() : null })); } catch {} }

function loadAlertHistory() {
  try { const s = localStorage.getItem("alertHistory"); if (s) alertHistory = sanitizeAlertHistory(JSON.parse(s)); } catch {}
}
function saveAlertHistory() {
  try { localStorage.setItem("alertHistory", JSON.stringify(alertHistory)); } catch {}
}
function loadPriceLevelAlerts() { try { const s = localStorage.getItem("priceLevelAlerts"); if (s) priceLevelAlerts = sanitizePriceLevelAlerts(JSON.parse(s)); } catch {} }
function savePriceLevelAlerts() { try { localStorage.setItem("priceLevelAlerts", JSON.stringify(priceLevelAlerts)); } catch {} }
function loadSlippageConfig() { try { const s = localStorage.getItem("slippageConfig"); if (s) { const d = JSON.parse(s); slippageConfig.spreadPips = Math.max(0, numOrNull(d.spreadPips) ?? 0); slippageConfig.slippagePips = Math.max(0, numOrNull(d.slippagePips) ?? 0); } } catch {} }
function saveSlippageConfig() { try { localStorage.setItem("slippageConfig", JSON.stringify(slippageConfig)); } catch {} }

function pushAlertHistory(pair, type, message) {
  alertHistory.unshift({ timestamp: new Date().toISOString(), pair, type, message });
  if (alertHistory.length > 100) alertHistory.length = 100;
  saveAlertHistory();
}

function showToast(message, type) {
  try {
    let el = document.getElementById("opencode-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "opencode-toast";
      el.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 16px;border-radius:8px;font-size:.8rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:80vw;text-align:center;pointer-events:none";
      el.setAttribute("aria-atomic", "true");
      document.body.appendChild(el);
    }
    const urgent = type === "warn" || type === "error";
    el.setAttribute("role", urgent ? "alert" : "status");
    el.setAttribute("aria-live", urgent ? "assertive" : "polite");
    el.style.background = type === "warn" ? "#7a4a00" : "#1f2a36";
    el.style.color = "#fff";
    el.textContent = message;
    el.style.opacity = "1";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.style.opacity = "0"; }, 3500);
  } catch {}
}
function loadStrategyName() {
  try { const s = localStorage.getItem("strategyName"); if (s) strategyName = cleanText(s, 64); } catch {}
}
function saveStrategyName() {
  try { localStorage.setItem("strategyName", strategyName); } catch {}
}

let positions = [];

function loadPositions() {
  try {
    const saved = localStorage.getItem("positions");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) positions = parsed.map(sanitizePosition).filter(Boolean);
    }
  } catch {}
}

function savePositions() {
  try { localStorage.setItem("positions", JSON.stringify(positions)); } catch {}
}

function openTrade(pair, direction, entry, stop, target) {
  const guard = canOpenTrade(pair);
  if (!guard.ok) {
    pushAlertHistory(pair, "risk", "Trade blocked: " + guard.reason);
    if (window.showToast) showToast("Trade blocked: " + guard.reason, "warn");
    return { ok: false, reason: guard.reason };
  }
  positions.push({ id: Date.now(), pair, direction, entry, stop, target, openedAt: new Date(), closedAt: null, exitPrice: null, pnl: null, pnlPct: null, originalStop: stop, trailingStop: false, highWater: null, lowWater: null });
  savePositions();
  render();
  return { ok: true };
}

function closeTrade(id, exitPrice) {
  const pos = positions.find(p => p.id === id);
  if (!pos) return;
  pos.closedAt = new Date();
  pos.exitPrice = exitPrice;
  const diff = exitPrice - pos.entry;
  pos.pnl = pos.direction === "BUY" ? diff : -diff;
  pos.pnlPct = pos.entry ? (pos.pnl / pos.entry) * 100 : 0;
  const cfg = loadRiskConfig();
  const pnlCurrency = pos.pnlPct / 100 * cfg.balance;
  pos.pnlCurrency = pnlCurrency;
  recordDailyPnl(pnlCurrency);
  setLossStreak(pnlCurrency >= 0 ? 0 : getLossStreak() + 1);
  savePositions();
  render();
}

function updateTrailingStop(pos, price) {
  if (pos.originalStop == null) {
    pos.originalStop = pos.stop;
    pos.trailingStop = false;
    pos.highWater = pos.entry;
    pos.lowWater = pos.entry;
  }
  const isBuy = pos.direction === "BUY";
  const risk = Math.abs(pos.entry - pos.originalStop);
  if (risk <= 0) return;
  if (isBuy) {
    pos.highWater = Math.max(pos.highWater || pos.entry, price);
    const favorDist = price - pos.entry;
    if (favorDist >= risk * 3) {
      const atrVal = pos.atr || risk;
      const newStop = pos.highWater - 2 * atrVal;
      if (newStop > pos.stop) { pos.stop = newStop; pos.trailingStop = true; }
    } else if (favorDist >= risk * 1.5) {
      const newStop = pos.entry + risk * 0.1;
      if (newStop > pos.stop) { pos.stop = newStop; pos.trailingStop = true; }
    }
  } else {
    pos.lowWater = Math.min(pos.lowWater || pos.entry, price);
    const favorDist = pos.entry - price;
    if (favorDist >= risk * 3) {
      const atrVal = pos.atr || risk;
      const newStop = pos.lowWater + 2 * atrVal;
      if (newStop < pos.stop) { pos.stop = newStop; pos.trailingStop = true; }
    } else if (favorDist >= risk * 1.5) {
      const newStop = pos.entry - risk * 0.1;
      if (newStop < pos.stop) { pos.stop = newStop; pos.trailingStop = true; }
    }
  }
}

function deletePosition(id) {
  positions = positions.filter(p => p.id !== id);
  savePositions();
  render();
}

function getPosPrice(pos) {
  const r = multiScan.results[pos.pair];
  if (r && r.price != null) return r.price;
  return pos.entry;
}

const livePrice = {
  price: null,
  prevClose: null,
  timestamp: null,
  intervalId: null,
};

let webhookUrl = "";

function loadWebhook() { try { const s = localStorage.getItem("webhookUrl"); if (s) webhookUrl = cleanText(s, 2048); } catch {} }
function saveWebhook() { try { localStorage.setItem("webhookUrl", webhookUrl); } catch {} }

// Optional browser-readable intraday FX feed. Twelve Data is the only free
// source we found that serves intraday FX (down to 1 minute, EUR/JPY included)
// with a real Access-Control-Allow-Origin header, so it reads directly from
// fetch() with no proxy. The free plan allows 800 requests/day, ample for
// interactive use. Without a key, FX pairs Binance cannot cover (JPY, CHF, CAD,
// NZD crosses) keep degrading to daily ECB rates.
const fxApiPrefs = { enabled: false, key: "" };
let fxApiLastUsed = null;
function loadFxApiPrefs() {
  try {
    const s = localStorage.getItem("fxApiPrefs");
    if (s) { const p = JSON.parse(s); fxApiPrefs.enabled = !!p.enabled; fxApiPrefs.key = cleanText(p.key, 128).trim(); }
  } catch {}
}
function saveFxApiPrefs() { try { localStorage.setItem("fxApiPrefs", JSON.stringify(fxApiPrefs)); } catch {} }

function loadRiskConfig() {
  try {
    const s = localStorage.getItem("riskConfig");
    if (s) return normalizeRiskConfig(JSON.parse(s));
  } catch {}
  return normalizeRiskConfig(null);
}

function getDailyPnl() {
  try { const dl = JSON.parse(localStorage.getItem("dailyLoss") || "{}"); return dl[new Date().toISOString().slice(0,10)] || 0; } catch { return 0; }
}
function getLossStreak() {
  try { return JSON.parse(localStorage.getItem("lossStreak") || "0"); } catch { return 0; }
}
function setLossStreak(n) {
  try { localStorage.setItem("lossStreak", JSON.stringify(n)); } catch {}
}
function corrOverLimitFor(pair) {
  try {
    if (!corrData || !corrData.pairs) return false;
    const cfg = loadRiskConfig();
    const cap = cfg.corrCap ?? 2;
    const opens = positions.filter(p => !p.closedAt);
    const clash = opens.filter(o => {
      if (o.pair === pair) return false;
      return corrData.pairs.some(c => (c[0] === o.pair && c[1] === pair) || (c[1] === o.pair && c[0] === pair));
    });
    return clash.length >= cap;
  } catch { return false; }
}
function canOpenTrade(pair) {
  const cfg = loadRiskConfig();
  const openCount = positions.filter(p => !p.closedAt).length;
  if (openCount >= (cfg.maxPos ?? 5)) return { ok: false, reason: `Max positions reached (${openCount}/${cfg.maxPos})` };
  if ((cfg.dailyLimit ?? 5) > 0 && getDailyPnl() <= -(cfg.dailyLimit)) return { ok: false, reason: `Daily loss limit hit (-$${Math.abs(getDailyPnl()).toFixed(2)})` };
  if ((cfg.maxLossStreak ?? 4) > 0 && getLossStreak() >= (cfg.maxLossStreak ?? 4)) return { ok: false, reason: `${getLossStreak()} consecutive losses - cooling off` };
  if (corrOverLimitFor(pair)) return { ok: false, reason: "Correlated position cap reached" };
  return { ok: true, reason: "" };
}

function saveRiskConfig(cfg) {
  try { localStorage.setItem("riskConfig", JSON.stringify(normalizeRiskConfig(cfg))); } catch {}
}

function loadStrategyConfig() {
  try {
    const s = localStorage.getItem("strategyConfig");
    if (s) return normalizeStrategyConfig(JSON.parse(s));
  } catch {}
  return normalizeStrategyConfig(null);
}

function saveStrategyConfig(cfg) {
  try { localStorage.setItem("strategyConfig", JSON.stringify(normalizeStrategyConfig(cfg))); } catch {}
}

function recordDailyPnl(amount) {
  try {
    const todayKey = new Date().toISOString().slice(0,10);
    const dl = JSON.parse(localStorage.getItem("dailyLoss") || "{}");
    dl[todayKey] = (dl[todayKey] || 0) + amount;
    localStorage.setItem("dailyLoss", JSON.stringify(dl));
  } catch {}
}

async function sendWebhook(entry) {
  if (!webhookUrl || !isValidWebhookUrl(webhookUrl)) return;
  const msg = `${entry.direction === "BUY" ? "🟢" : "🔴"} *${entry.direction} ${entry.pair}*\nConfidence: ${entry.confidence}% | Risk: ${entry.risk}\nEntry: ${entry.entry != null ? formatPrice(entry.entry, entry.pair) : "-"} | Stop: ${entry.stop != null ? formatPrice(entry.stop, entry.pair) : "-"} | Target: ${entry.target != null ? formatPrice(entry.target, entry.pair) : "-"}`;
  try {
    if (webhookUrl.includes("discord")) {
      await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: msg.replace(/\*/g, "**") }) });
    } else {
      await fetch(webhookUrl + (webhookUrl.includes("?") ? "&" : "?") + "parse_mode=Markdown&text=" + encodeURIComponent(msg));
    }
  } catch {}
}

const allScanPairs = [
  "EUR/USD","USD/EUR","GBP/USD","USD/GBP","USD/JPY","JPY/USD","AUD/USD","USD/AUD","USD/CAD","CAD/USD","NZD/USD","USD/NZD","USD/CHF","CHF/USD",
  "EUR/GBP","GBP/EUR","EUR/JPY","JPY/EUR","GBP/JPY","JPY/GBP","EUR/AUD","AUD/EUR","EUR/CHF","CHF/EUR",
  "USD/SGD","SGD/USD","USD/NOK","NOK/USD","USD/SEK","SEK/USD","USD/DKK","DKK/USD","USD/PLN","PLN/USD","USD/CZK","CZK/USD","USD/HUF","HUF/USD","USD/RON","RON/USD","USD/ISK","ISK/USD","USD/BGN","BGN/USD","USD/TRY","TRY/USD","USD/ZAR","ZAR/USD","USD/MXN","MXN/USD","USD/BRL","BRL/USD","USD/CNY","CNY/USD","USD/HKD","HKD/USD","USD/THB","THB/USD","USD/INR","INR/USD","USD/KRW","KRW/USD","USD/ILS","ILS/USD",
  "XAU/USD",
  "BTC/USD","ETH/USD","SOL/USD","XRP/USD","ADA/USD","DOGE/USD","DOT/USD","LINK/USD","AVAX/USD",
  "SHIB/USD","LTC/USD","MATIC/USD","UNI/USD","ATOM/USD","LUNC/USD","NEAR/USD","APT/USD","ARB/USD","OP/USD","INJ/USD","SUI/USD","FET/USD","WIF/USD","PEPE/USD","BONK/USD","TIA/USD","SEI/USD","JUP/USD","RENDER/USD","ONDO/USD","TAO/USD","JASMY/USD","ENA/USD","AAVE/USD","MKR/USD","CRV/USD","LDO/USD","STX/USD",
  "BCH/USD","XLM/USD","TRX/USD","ETC/USD","FIL/USD","HBAR/USD","ICP/USD","VET/USD","ALGO/USD","GRT/USD","SAND/USD","MANA/USD","IMX/USD","THETA/USD","RUNE/USD","FLOKI/USD","WLD/USD","TON/USD","EOS/USD","XTZ/USD","CHZ/USD","GALA/USD","APE/USD","DYDX/USD","PYTH/USD","JTO/USD","ORDI/USD","PENDLE/USD","EIGEN/USD",
];

let scanPairs = [...allScanPairs];

const multiScan = {
  results: {},
  scanning: false,
  progress: "",
  configOpen: false,
  watchlistOnly: false,
  sortMode: "conf",
  filter: "all",
  timeframe: "1d",
  scanToken: 0,
};

function loadOverviewPrefs() {
  try {
    const s = localStorage.getItem("overviewPrefs");
    if (s) { const p = JSON.parse(s); if (p.sortMode === "conf" || p.sortMode === "dir" || p.sortMode === "name") multiScan.sortMode = p.sortMode; if (p.filter === "all" || p.filter === "BUY" || p.filter === "SELL" || p.filter === "WAIT") multiScan.filter = p.filter; if (["1m","5m","15m","30m","1h","4h","1d"].includes(p.timeframe)) multiScan.timeframe = p.timeframe; }
  } catch {}
}

function saveOverviewPrefs() {
  try { localStorage.setItem("overviewPrefs", JSON.stringify({ sortMode: multiScan.sortMode, filter: multiScan.filter, timeframe: multiScan.timeframe })); } catch {}
}

function overviewFilteredPairs() {
  const base = multiScan.watchlistOnly ? scanPairs.filter(p => watchlist.includes(p)) : scanPairs;
  const f = multiScan.filter;
  if (f === "all") return base;
  return base.filter(p => { const r = multiScan.results[p]; return r && !r.loading && r.direction === f; });
}

function overviewSort(a, b) {
  const ra = multiScan.results[a];
  const rb = multiScan.results[b];
  if (multiScan.sortMode === "name") {
    const al = a.localeCompare(b);
    return al !== 0 ? al : ((rb && !rb.loading ? rb.confidence : 0) - (ra && !ra.loading ? ra.confidence : 0));
  }
  const wa = watchlist.includes(a) ? 0 : 1;
  const wb = watchlist.includes(b) ? 0 : 1;
  if (wa !== wb) return wa - wb;
  if (multiScan.sortMode === "conf") {
    const ca = ra && !ra.loading ? ra.confidence : 0;
    const cb = rb && !rb.loading ? rb.confidence : 0;
    const d = cb - ca;
    if (d !== 0) return d;
    const da = ra && !ra.loading ? (ra.direction === "BUY" ? 0 : ra.direction === "SELL" ? 1 : 2) : 3;
    const db = rb && !rb.loading ? (rb.direction === "BUY" ? 0 : rb.direction === "SELL" ? 1 : 2) : 3;
    return da - db;
  }
  const da = ra && !ra.loading ? (ra.direction === "BUY" ? 0 : ra.direction === "SELL" ? 1 : 2) : 3;
  const db = rb && !rb.loading ? (rb.direction === "BUY" ? 0 : rb.direction === "SELL" ? 1 : 2) : 3;
  if (da !== db) return da - db;
  const ca = ra && !ra.loading ? ra.confidence : 0;
  const cb = rb && !rb.loading ? rb.confidence : 0;
  return cb - ca;
}

function overviewBestPair() {
  let best = null;
  let bestConf = -1;
  for (const p of scanPairs) {
    const r = multiScan.results[p];
    if (r && !r.loading && r.direction !== "WAIT" && r.confidence > bestConf) { best = p; bestConf = r.confidence; }
  }
  return best;
}

function loadScanConfig() {
  try {
    const saved = localStorage.getItem("scanConfig");
    if (!saved) return;
    const parsed = JSON.parse(saved);
    const savedPairs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.pairs) ? parsed.pairs : null);
    if (!savedPairs) return;
    let list = savedPairs.filter((p) => allScanPairs.includes(p));
    const known = Array.isArray(parsed) ? null : (Array.isArray(parsed.known) ? parsed.known : null);
    // Pairs introduced after the user last saved were never offered to them, so
    // fold them in automatically instead of leaving the expanded universe hidden.
    if (known) {
      const fresh = allScanPairs.filter((p) => !known.includes(p) && !list.includes(p));
      list = list.concat(fresh);
    }
    if (list.length > 0) scanPairs = list;
  } catch {}
}

function saveScanConfig() {
  try { localStorage.setItem("scanConfig", JSON.stringify({ pairs: scanPairs, known: [...allScanPairs] })); } catch {}
}

function loadAlertConditions() {
  try {
    const s = localStorage.getItem("alertConditions");
    if (s) sanitizeAlertConditions(JSON.parse(s));
  } catch {}
}

function saveAlertConditions() {
  try { localStorage.setItem("alertConditions", JSON.stringify(alertConditions)); } catch {}
}

function evaluateAlertConditions(testMode = false) {
  const now = Date.now();
  const cooldown = 30 * 60 * 1000;
  const analysis = analyze(state.rows, loadStrategyConfig());
  if (!analysis) return [];
  const mtf = state.mtf;
  const rows = state.rows;
  const fired = [];
  Object.values(alertConditions).forEach(cond => {
    if (!cond.enabled) return;
    if (!testMode && now - (cond.lastFired || 0) < cooldown) return;
    let fire = false;
    if (cond.type === "mtf_alignment") {
      const dirs = ["1d", "4h", "1h"].map(tf => mtf[tf]?.direction).filter(d => d);
      dirs.push(analysis.direction);
      if (dirs.length >= 3) { const allBuy = dirs.every(d => d === "BUY"); const allSell = dirs.every(d => d === "SELL"); fire = allBuy || allSell; }
    }
    if (cond.type === "pattern_trend") {
      const hasBullishPattern = analysis.reasons.some(r => r.ok && (r.text.includes("engulfing") || r.text.includes("hammer")));
      const hasBearishPattern = analysis.reasons.some(r => r.ok && (r.text.includes("engulfing") || r.text.includes("shooting star")));
      const trendConfirmsBuy = analysis.direction === "BUY" && analysis.buyScore > analysis.sellScore;
      const trendConfirmsSell = analysis.direction === "SELL" && analysis.sellScore > analysis.buyScore;
      fire = (hasBullishPattern && trendConfirmsBuy) || (hasBearishPattern && trendConfirmsSell);
    }
    if (cond.type === "high_confidence") {
      fire = analysis.confidence >= (cond.threshold || 85);
    }
    if (cond.type === "volume_surge") {
      const hasVolume = rows.some(r => Number.isFinite(r.volume) && r.volume > 0);
      if (hasVolume) {
        const volSma = sma(rows.map(r => r.volume), 20);
        const lastVol = rows.at(-1).volume;
        const lastSma = volSma.at(-1);
        fire = lastVol > lastSma * (cond.threshold || 1.5);
      }
    }
    if (fire) {
      cond.lastFired = now;
      fired.push(cond.type);
      notifySignal({ direction: analysis.direction, pair: `${state.base}/${state.quote}`, confidence: analysis.confidence, risk: analysis.risk, entry: analysis.entry });
      pushAlertHistory(`${state.base}/${state.quote}`, cond.type, `${cond.type.replace(/_/g, " ")} triggered on ${state.base}/${state.quote} — ${analysis.direction} (${analysis.confidence}%)`);
    }
  });
  if (fired.length > 0) saveAlertConditions();
  return fired;
}

function toggleScanPair(pair) {
  const idx = scanPairs.indexOf(pair);
  if (idx >= 0) scanPairs.splice(idx, 1);
  else scanPairs.push(pair);
  saveScanConfig();
  render();
}

let watchlist = [];
let alerts = [];

function loadWatchlist() {
  try { const s = localStorage.getItem("watchlist"); if (s) watchlist = sanitizePairList(JSON.parse(s)); } catch {}
}
function saveWatchlist() { try { localStorage.setItem("watchlist", JSON.stringify(watchlist)); } catch {} }
function toggleWatchlist(pair) {
  const idx = watchlist.indexOf(pair);
  if (idx >= 0) watchlist.splice(idx, 1); else watchlist.push(pair);
  saveWatchlist(); render();
}

function loadAlerts() {
  try { const s = localStorage.getItem("priceAlerts"); if (s) alerts = sanitizeAlerts(JSON.parse(s)); } catch {}
}
function saveAlerts() { try { localStorage.setItem("priceAlerts", JSON.stringify(alerts)); } catch {} }
function setAlert(pair, price, dir) {
  alerts.push({ id: Date.now(), pair, price: Number(price), dir: dir || "above", createdAt: Date.now() });
  saveAlerts(); render();
}
function removeAlert(id) { alerts = alerts.filter(a => a.id !== id); saveAlerts(); render(); }

async function checkAlerts() {
  if (alerts.length === 0) return;
  const pairs = [...new Set(alerts.map(a => a.pair))];
  const cache = {};
  for (const pair of pairs) {
    const [base, quote] = pair.split("/");
    try { const d = await fetchLivePrice(base, quote); if (d) cache[pair] = d.price; } catch {}
  }
  let changed = false;
  for (const alert of [...alerts]) {
    const current = cache[alert.pair];
    if (current == null) continue;
    const hit = alert.dir === "above" ? current >= alert.price : current <= alert.price;
    if (hit) {
      removeAlert(alert.id);
      changed = true;
      const dirLabel = alert.dir === "above" ? "above" : "below";
      playBeep();
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(`Alert: ${alert.pair} hit $${formatPrice(alert.price, alert.pair)}`, {
          body: `Price is now ${dirLabel} target: $${formatPrice(current, alert.pair)}`,
          silent: true,
        });
      }
    }
  }
  if (changed) render();
}

loadWatchlist();
loadAlerts();
loadScanConfig();
loadOverviewPrefs();

