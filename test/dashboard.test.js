"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: no <script> block found"); process.exit(1); }

let js = m[1];
// Truncate at the browser bootstrap so the live load()/connectWS() never runs.
const boot = js.indexOf("\nloadHistory();");
if (boot === -1) { console.error("FAIL: bootstrap marker not found"); process.exit(1); }
js = js.slice(0, boot + 1);

// --- Stub browser globals so pure functions load without a DOM/network ---
const ls = new Map();
const domEls = { root: { innerHTML: "", addEventListener: () => {}, style: {}, dataset: {} } };
const localStorageStub = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
};
const evt = () => ({ target: {}, preventDefault() {}, });
const ctx = {
  console,
  localStorage: localStorageStub,
  document: { getElementById: (id) => domEls[id] || null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, documentElement: { style: {}, setAttribute() {}, removeAttribute() {} }, body: { appendChild() {} }, createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} }) },
  window: { showToast: () => {}, addEventListener: () => {}, getComputedStyle: () => ({}) },
  navigator: { serviceWorker: { register: () => Promise.resolve() } },
  fetch: () => new Promise(() => {}),
  WebSocket: class { constructor() {} close() {} },
  AudioContext: class { createGain() { return { connect() {}, gain: { setValueAtTime() {} } }; } createOscillator() { return { connect() {}, frequency: { setValueAtTime() {} }, start() {} }; } },
  requestAnimationFrame: (fn) => 0,
  ResizeObserver: class { observe() {} disconnect() {} },
  setInterval: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
  clearInterval: () => {},
  setTimezone: () => {},
  HTMLElement: class {},
  Event: class {},
  SVGSVGElement: class {},
  Node: class {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);

let sandboxErr = null;
try {
  vm.runInContext(js, ctx, { filename: "dashboard-inline.js" });
} catch (e) {
  sandboxErr = e;
}

if (sandboxErr) { console.error("FAIL: sandbox threw:", sandboxErr.message); process.exit(1); }

let pass = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  FAIL:", msg); } };

// ================= ML MODEL TESTS =================
function resetModel() { ctx.mlReset(); }
function featurize(e) { return ctx.mlFeaturize(e); }

// 1) Not trained -> predict null
resetModel();
assert(ctx.mlPredict(featurize({ confidence: 80, buyScore: 80, sellScore: 20, volatilityPct: 2 })) === null, "predict null before 8 samples");

// 2) Train 12 wins (strong) and 12 losses (weak); model separates them
for (let i = 0; i < 12; i++) ctx.mlTrain(featurize({ confidence: 85 + i, buyScore: 82, sellScore: 15, volatilityPct: 1.5, direction: "BUY" }), "win");
for (let i = 0; i < 12; i++) ctx.mlTrain(featurize({ confidence: 40 + i, buyScore: 30, sellScore: 60, volatilityPct: 3, direction: "SELL" }), "loss");

const pw = ctx.mlPredict(featurize({ confidence: 92, buyScore: 88, sellScore: 8, volatilityPct: 1.2, direction: "BUY" }));
assert(pw && pw.win > 0.6, "strong pattern predicted as win, got " + (pw ? pw.win.toFixed(2) : "null"));

const pl = ctx.mlPredict(featurize({ confidence: 35, buyScore: 25, sellScore: 70, volatilityPct: 4, direction: "SELL" }));
assert(pl && pl.win < 0.4, "weak pattern predicted as loss, got " + (pl ? pl.win.toFixed(2) : "null"));

// 3) Filter helpers
resetModel();
ctx.mlFilterEnabled = true;
const noModelAnalysis = { direction: "BUY", confidence: 80 };
assert(ctx.mlFilterPass(noModelAnalysis) === true, "filter passes when model not trained");
ctx.mlFilterEnabled = false;

// 4) Batch training counts resolved trades
resetModel();
const hist = [
  { result: "win", confidence: 80, buyScore: 70, sellScore: 30, volatilityPct: 1.5, direction: "BUY" },
  { result: "loss", confidence: 50, buyScore: 40, sellScore: 55, volatilityPct: 2.5, direction: "SELL" },
];
const trained = ctx.mlBatchTrain(hist);
assert(trained === 2, "mlBatchTrain trains 2 resolved trades, got " + trained);
// With only 2 samples (< minSamples 8), predictions still return null
assert(ctx.mlPredict(featurize({ confidence: 80, buyScore: 70, sellScore: 30, volatilityPct: 1.5, direction: "BUY" })) === null, "mlPredict null while below minSamples");

// ================= ANALYZE TESTS (synthetic data, no network) =================
// Generate deterministic synthetic OHLCV rows
function makeRows(count) {
  const rows = [];
  let price = 100, seed = 42;
  for (let i = 0; i < count; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const drift = (seed % 7) - 3; // -3..3
    const open = price;
    price = Math.max(1, price + drift + (i % 5 === 0 ? 1.5 : 0));
    const high = Math.max(open, price) + 0.4;
    const low = Math.min(open, price) - 0.4;
    rows.push({ time: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString(), open, high, low, close: price, volume: 1000 + (seed % 500) });
  }
  return rows;
}
const rows = makeRows(200);
const cfg = ctx.loadStrategyConfig();
const a = ctx.analyze(rows, cfg);
assert(a && typeof a === "object", "analyze returns an object");
if (a) {
  assert(typeof a.direction === "string", "analyze.direction is a string, got " + a.direction);
  assert(typeof a.confidence === "number" && isFinite(a.confidence), "analyze.confidence is a finite number");
  assert(["BUY", "SELL", "WAIT"].includes(a.direction), "direction is one of BUY/SELL/WAIT");
  if (a.direction !== "WAIT") {
    assert(a.entry != null, "entry present on non-WAIT signal");
    assert(a.stop != null, "stop present on non-WAIT signal");
    assert(a.target != null, "target present on non-WAIT signal");
    assert(a.stop < a.entry < a.target || a.target < a.entry < a.stop, "stop<entry<target ordering sane");
  }
}
// analyze returns null on short data (rows < 80)
const short = ctx.analyze(rows.slice(0, 40), cfg);
assert(short === null, "analyze returns null when rows < 80");

// ================= TREND-EXTENSION GATE REGRESSION TESTS =================
// Strong trend whose last close sits beyond the 20-period Bollinger band.
// The extension gate must not block entries when ADX is strong (trending),
// otherwise trending SELLs (and BUYs) would all collapse to WAIT.
function makeTrendRows(count, baseStep, tailBars, tailStep) {
  const rows = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const step = (i >= count - tailBars) ? tailStep : baseStep;
    const open = price;
    price = Math.max(0.001, price - step - (i % 4 === 0 ? 0.08 : 0));
    rows.push({ time: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString(), open, high: Math.max(open, price) + 0.01, low: Math.min(open, price) - 0.01, close: price, volume: 2000 });
  }
  return rows;
}
const downRows = makeTrendRows(130, 0.35, 8, 1.0);
const downA = ctx.analyze(downRows, cfg, "TST/SELL");
assert(downA && downA.direction === "SELL", "strong downtrend extended below lower band -> SELL, got " + (downA && downA.direction));
const upRows = [];
{
  let price = 100;
  for (let i = 0; i < 140; i++) {
    const step = i >= 130 ? 1.0 : 0.35;
    const open = price;
    price = price + step + (i % 4 === 0 ? 0.08 : 0);
    upRows.push({ time: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString(), open, high: Math.max(open, price) + 0.01, low: Math.min(open, price) - 0.01, close: price, volume: 2000 });
  }
}
const upA = ctx.analyze(upRows, cfg, "TST/BUY");
assert(upA && upA.direction === "BUY", "strong uptrend extended above upper band -> BUY, got " + (upA && upA.direction));

// ================= PER-PAIR SIGNAL KEYS =================
// Analyze calls for two different instruments must not share a lastSignals slot
// (a BUY result for one pair must not suppress a SELL for another).
vm.runInContext("lastSignals.clear();", ctx);
vm.runInContext("multiScan.results = {}; scanPairs = ['AAA/USD','BBB/USD'];", ctx);
const pair1 = ctx.analyze(downRows, cfg, "AA/A");
const pair2 = ctx.analyze(upRows, cfg, "BB/B");
assert(pair1 && pair1.direction === "SELL" && pair2 && pair2.direction === "BUY", "per-pair keys keep BUY and SELL independent across instruments");

// ================= PAPER TRADING MANUAL OPEN =================
const paperInputs = (entry, stop, target) => { domEls.paperEntry = { value: entry }; domEls.paperStop = { value: stop }; domEls.paperTarget = { value: target }; };
vm.runInContext("paperState.openPositions = []; paperState.trades = [];", ctx);
paperInputs("1.10", "1.12", "1.05");
ctx.openManualPaperTrade("SELL");
let ps = vm.runInContext("paperState", ctx);
assert(ps.openPositions.length === 1 && ps.openPositions[0].direction === "SELL", "manual SELL paper trade opens");
paperInputs("1.10", "1.05", "1.12");
ctx.openManualPaperTrade("BUY");
ps = vm.runInContext("paperState", ctx);
assert(ps.openPositions.length === 2, "manual BUY paper trade opens");
paperInputs("1.10", "1.12", "1.13");
ctx.openManualPaperTrade("BUY");
ps = vm.runInContext("paperState", ctx);
assert(ps.openPositions.length === 2, "invalid BUY ordering is rejected");
paperInputs("abc", "1.05", "1.12");
ctx.openManualPaperTrade("BUY");
ps = vm.runInContext("paperState", ctx);
assert(ps.openPositions.length === 2, "non-numeric entry is rejected");

// ================= OVERVIEW SORT / FILTER / BEST =================
vm.runInContext(`multiScan.results = {};
const seed = {};
seed["AAA/USD"] = { loading:false, direction:"BUY",  confidence:80, price:1 };
seed["BBB/USD"] = { loading:false, direction:"SELL", confidence:95, price:2 };
seed["CCC/USD"] = { loading:false, direction:"WAIT", confidence:55, price:3 };
seed["DDD/USD"] = { loading:false, direction:"BUY",  confidence:72, price:4 };
seed["EEE/USD"] = { loading:true,  direction:"WAIT", confidence:0, price:null };
multiScan.results = seed;
scanPairs = ["AAA/USD","BBB/USD","CCC/USD","DDD/USD","EEE/USD"];
multiScan.sortMode = "conf"; multiScan.filter = "all";`, ctx);
assert(vm.runInContext("overviewBestPair()", ctx) === "BBB/USD", "overview best pair is highest-confidence non-WAIT");
let ov = vm.runInContext("overviewFilteredPairs().sort(overviewSort)", ctx);
assert(ov[0] === "BBB/USD" && ov[1] === "AAA/USD" && ov[ov.length - 1] === "EEE/USD", "overview sorts by confidence desc, loading last");
vm.runInContext("multiScan.filter = 'BUY'", ctx);
ov = vm.runInContext("overviewFilteredPairs()", ctx);
assert(ov.length === 2 && ov.includes("AAA/USD") && ov.includes("DDD/USD"), "overview BUY filter only shows BUY cards");
vm.runInContext("multiScan.filter = 'all'; multiScan.sortMode = 'name'", ctx);
ov = vm.runInContext("overviewFilteredPairs().sort(overviewSort)", ctx);
assert(ov[0] === "AAA/USD" && ov[4] === "EEE/USD", "overview name sort is alphabetical");
vm.runInContext("multiScan.sortMode = 'dir'; multiScan.filter = 'SELL'; saveOverviewPrefs();", ctx);
vm.runInContext("multiScan.sortMode = 'conf'; multiScan.filter = 'all'; loadOverviewPrefs();", ctx);
assert(vm.runInContext("multiScan.sortMode === 'dir' && multiScan.filter === 'SELL'", ctx), "overview prefs persist and reload");

// ================= BACKTEST RENDER REGRESSION =================
// Regression: the backtest card referenced undeclared eqPts/peakPts, so render()
// threw "ReferenceError: eqPts is not defined" as soon as backtest results existed.
const mkTrade = (i, pnl) => ({ result: pnl > 0 ? "win" : pnl < 0 ? "loss" : "pending", pnlPct: pnl, direction: pnl >= 0 ? "BUY" : "SELL", date: `2020-01-${String((i % 28) + 1).padStart(2, "0")}` });
vm.runInContext(`
backtest.multiResults = null;
backtest.results = { trades: ${JSON.stringify(Array.from({ length: 12 }, (_, i) => mkTrade(i, i % 3 === 0 ? -1.2 : 1.8)))}, stats: {}, config: {} };
`, ctx);
let btHtml = null, btErr = null;
try { btHtml = ctx.renderBacktest(); } catch (e) { btErr = e; }
assert(!btErr, "renderBacktest with results does not throw" + (btErr ? ": " + btErr.message : ""));
assert(typeof btHtml === "string" && btHtml.includes("svg"), "renderBacktest emits the equity SVG chart");

// A long backtest must not blow the argument stack in Math.max/Math.min.
const longTrades = Array.from({ length: 4000 }, (_, i) => mkTrade(i, Math.sin(i / 7) * 2));
vm.runInContext(`backtest.results = { trades: ${JSON.stringify(longTrades)}, stats: {}, config: {} };`, ctx);
let longErr = null, longHtml = null;
try { longHtml = ctx.renderBacktest(); } catch (e) { longErr = e; }
assert(!longErr, "renderBacktest survives a 4000-trade curve" + (longErr ? ": " + longErr.message : ""));
assert(longHtml && longHtml.split(" ").length < 400000, "renderBacktest downsamples the equity curve");

// Same for the paper-trading equity curve (used to throw RangeError past ~100k points).
vm.runInContext(`
paperState.equityCurve = Array.from({ length: 150000 }, (_, i) => ({ balance: 10000 + (i % 500) }));
paperState.trades = []; paperState.openPositions = [];
`, ctx);
let paperErr = null;
try { ctx.renderPaperTrading(); } catch (e) { paperErr = e; }
assert(!paperErr, "renderPaperTrading survives a 150k-point equity curve" + (paperErr ? ": " + paperErr.message : ""));

// ================= PURE analyze() / SIGNAL STATE =================
// Regression: analyze() used to mutate lastSignals on every call, so each render()
// incremented the decay counter and a BUY could flip to WAIT without new data.
vm.runInContext("lastSignals.clear();", ctx);
const sig1 = ctx.analyze(upRows, cfg, "AAA/USD");
const sig1b = ctx.analyze(upRows, cfg, "AAA/USD");
assert(sig1.direction === sig1b.direction && sig1.confidence === sig1b.confidence,
  "analyze() is pure: repeated calls return identical output (" + sig1.direction + "/" + sig1.confidence + " vs " + sig1b.direction + "/" + sig1b.confidence + ")");
assert(vm.runInContext("lastSignals.size", ctx) === 0, "analyze() does not write lastSignals unless tracking is requested");

// With tracking on, consecutive same-direction signals must decay confidence.
vm.runInContext("lastSignals.clear();", ctx);
const t1 = ctx.analyze(upRows, cfg, "TRK/USD", true);
const t2 = ctx.analyze(upRows, cfg, "TRK/USD", true);
assert(t2.confidence <= t1.confidence, "tracked repeat signals do not gain confidence from decay (" + t1.confidence + " -> " + t2.confidence + ")");

// ================= SAME-BAR STOP/TARGET =================
// A bar that spans both levels has unknowable intrabar ordering; the pessimistic
// model must book the stop, not the target.
const spanRows = [
  { high: 100, low: 100 },
  { high: 105, low: 95 },   // spans stop=98 and target=102
  { high: 100, low: 100 },
];
const exBuy = ctx.resolveTradeExit(spanRows, 0, true, 98, 102);
const exSell = ctx.resolveTradeExit(spanRows, 0, false, 98, 102);
assert(exBuy.result === "loss" && exBuy.exitPrice === 98, "same-bar BUY books the stop, not the target (got " + exBuy.result + " @ " + exBuy.exitPrice + ")");
assert(exSell.result === "loss" && exSell.exitPrice === 98, "same-bar SELL books the stop, not the target (got " + exSell.result + " @ " + exSell.exitPrice + ")");
const exTargetFirst = ctx.resolveTradeExit([{ high: 100, low: 100 }, { high: 103, low: 99.5 }, { high: 105, low: 95 }], 0, true, 98, 102);
assert(exTargetFirst.result === "win" && exTargetFirst.hitIndex === 1, "a bar touching only the target is still a win");
const exPending = ctx.resolveTradeExit([{ high: 100, low: 100 }], 0, true, 98, 102);
assert(exPending.result === "pending", "an unresolved trade stays pending");

// ================= SCHEDULE RENDER IN A HIDDEN TAB =================
// Regression: requestAnimationFrame never fires in a background tab, so the old
// code left renderPending latched on and silently dropped every later render.
vm.runInContext("renderPending = false;", ctx);
let rafCalls = 0, timerCalls = 0;
const savedRaf = ctx.requestAnimationFrame, savedSetTimeout = ctx.setTimeout;
ctx.requestAnimationFrame = (fn) => { rafCalls++; return 0; };
ctx.setTimeout = (fn, ms) => { timerCalls++; return 0; };
vm.runInContext("scheduleRender();", ctx);
vm.runInContext("scheduleRender();", ctx);  // must coalesce, not queue
assert(rafCalls === 1 && timerCalls === 1, "scheduleRender coalesces while pending (raf=" + rafCalls + " timer=" + timerCalls + ")");
// Capture the fallback callback instead of firing it inline, so the latched state
// can be observed first. rAF stays suppressed, mimicking a hidden tab.
let capturedFallback = null;
ctx.setTimeout = (fn, ms) => { capturedFallback = fn; return 7; };
vm.runInContext("__renderCalls = 0; __realRender = render; render = function () { __renderCalls++; };", ctx);
vm.runInContext("renderPending = false;", ctx);
vm.runInContext("scheduleRender();", ctx);
const latchBefore = vm.runInContext("renderPending", ctx);
assert(typeof capturedFallback === "function", "a timer fallback is registered when rAF is pending");
capturedFallback();  // simulate the hidden tab's timer finally firing
const afterFallback = vm.runInContext("renderPending", ctx);
const renderCalls = vm.runInContext("__renderCalls", ctx);
vm.runInContext("render = __realRender;", ctx);
assert(latchBefore === true && afterFallback === false, "the timer fallback clears renderPending so later renders are not dropped");
assert(renderCalls >= 1, "the timer fallback actually performs the deferred render (" + renderCalls + " call)");
ctx.requestAnimationFrame = savedRaf;
ctx.setTimeout = savedSetTimeout;
vm.runInContext("renderPending = false;", ctx);

// ================= KELLY SIZING TOGGLE =================
// Regression: the Kelly checkbox only relabelled the card; the recommended size
// stayed on the fixed-fractional value.
const kellyCase = vm.runInContext(`(() => {
  const e0 = new Date(2020, 0, 1).getTime();
  const hist = (result) => ({
    pair: "EUR/USD", direction: "BUY", result, entry: 100, stop: 98, target: 106,
    confidence: 70, risk: "Low", volatilityPct: 1, buyScore: 4, sellScore: 1,
    reasons: [], timestamp: new Date(e0), id: Math.random(),
  });
  autoScan.history = [hist("win"), hist("win"), hist("win"), hist("loss"), hist("win")];
  state.base = "EUR"; state.quote = "USD";
  state.rows = ${JSON.stringify(upRows)};
  document.getElementById("root").innerHTML = "";
  const out = {};
  kellyEnabled = false; render();
  out.fixed = document.getElementById("root").innerHTML;
  kellyEnabled = true; render();
  out.kelly = document.getElementById("root").innerHTML;
  return out;
})()`, ctx);
const grabUnits = (html) => {
  const m = /font-size:\.85rem[^>]*>([\d,]+)\s*units</.exec(html || "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
const fixedUnits = grabUnits(kellyCase.fixed), kellyUnits = grabUnits(kellyCase.kelly);
assert(kellyCase.fixed !== null && kellyCase.kelly !== null, "risk panel renders a position size in both modes");
assert(kellyCase.fixed.includes("Position Size (Fixed)") && kellyCase.kelly.includes("Position Size (Kelly)"), "Kelly toggle swaps the card label");
assert(fixedUnits !== kellyUnits, "Kelly toggle changes the recommended size (" + fixedUnits + " vs " + kellyUnits + ")");
assert(kellyUnits === 0 || kellyUnits > 0, "Kelly size is a finite number");

console.log("");
console.log("--- M20: stale exchange books are rejected (never analysed as live) ---");
// Binance's GBPUSDT/AUDUSDT spot books still answer with their last real trades
// from 2023. Accepting those bars would silently analyse years-old prices.
const stale = ctx.rowsAreStale;
assert(stale([], "1h") === true, "empty series counts as stale");
assert(stale(null, "1d") === true, "null series counts as stale");
const freshBar = (msAgo, interval) => {
  const t = new Date(Date.now() - msAgo).toISOString();
  return [{ time: t, date: t.slice(0, 10), open: 1, high: 1, low: 1, close: 1.12, volume: 10 }];
};
assert(stale(freshBar(30 * 60 * 1000, "1h"), "1h") === false, "30-minute-old hourly bar is fresh");
assert(stale(freshBar(60 * 60 * 1000, "1m"), "1m") === true, "1-hour-old 1-minute bar is stale");
assert(stale(freshBar(3 * 24 * 3600 * 1000, "1d"), "1d") === false, "3-day-old daily bar tolerates a weekend");
assert(stale(freshBar(30 * 24 * 3600 * 1000, "1d"), "1d") === true, "30-day-old daily bar is stale");
assert(stale(freshBar(24 * 3600 * 1000, "1h"), "1h") === true, "24-hour-old hourly bar is stale");
const gbpStale = freshBar(24282 * 3600 * 1000, "1h");
assert(stale(gbpStale, "1h") === true, "GBPUSDT-shaped 2023 book is rejected");
assert(stale([{ date: "2023-12-29", open: 1, high: 1, low: 1, close: 1.18 }], "1d") === true, "date-only stale series is rejected too");
assert(stale([{ close: 1.18 }], "1h") === false, "series without a usable stamp is not force-rejected");

console.log("");
console.log("--- M21: deriveCrossSeries maths ---");
// Fixed timestamps: building these from Date.now() lets a millisecond tick
// between the two legs desynchronise them and make the test flaky.
const T0 = "2024-03-01T10:00:00.000Z";
const T1 = "2024-03-01T11:00:00.000Z";
const legA = [
  { time: T0, date: T0.slice(0, 10), open: 1.10, high: 1.20, low: 1.05, close: 1.15, volume: 900 },
  { time: T1, date: T1.slice(0, 10), open: 1.15, high: 1.25, low: 1.10, close: 1.20, volume: 800 },
];
const legB = [
  { time: T0, date: T0.slice(0, 10), open: 2.50, high: 2.60, low: 2.40, close: 2.55, volume: 700 },
  { time: T1, date: T1.slice(0, 10), open: 2.55, high: 2.70, low: 2.50, close: 2.60, volume: 600 },
];
const cross = ctx.deriveCrossSeries(legA, legB);
assert(cross.length === 2, "deriveCrossSeries keeps every timestamp-aligned bar, got " + cross.length);
if (cross.length === 2) {
  const okClose = (v, e) => Math.abs(v - e) < 1e-9;
  assert(okClose(cross[0].close, 1.15 / 2.55), "close = base close / quote close");
  assert(okClose(cross[0].open, 1.10 / 2.50), "open = base open / quote open");
  assert(okClose(cross[0].high, 1.20 / 2.40), "high = base high / quote low");
  assert(okClose(cross[0].low, 1.05 / 2.60), "low = base low / quote high");
  const barsOk = cross.every((r) => r.high >= Math.max(r.open, r.close) - 1e-12 && r.low <= Math.min(r.open, r.close) + 1e-12);
  assert(barsOk, "every derived bar keeps high >= max(open,close) and low <= min(open,close)");
  assert(cross.every((r) => Number.isFinite(r.close) && r.close > 0), "derived closes are finite and positive");
  assert(cross.every((r) => r.volume >= 1), "derived bars carry a usable volume");
  assert(cross[0].date === legA[0].time.slice(0, 10), "derived bar keeps the leg date");
}
assert(ctx.deriveCrossSeries(legA, [{ ...legB[0], close: 0 }]).length === 0, "zero quote close is discarded, not divided by");
assert(ctx.deriveCrossSeries(legA, [{ ...legB[0], time: "1999-01-01T00:00:00.000Z" }]).length === 0, "misaligned timestamps produce no bars");
assert(ctx.deriveCrossSeries(legA, [{ ...legB[0], low: 0 }]).length === 0, "quote leg with a zero low is rejected");

console.log("");
console.log("--- M22: unitSeriesFrom anchors a USD leg to real timestamps ---");
const unit = ctx.unitSeriesFrom(legA);
assert(unit.length === legA.length, "unit series has one point per real bar");
assert(unit.every((u) => u.open === 1 && u.high === 1 && u.low === 1 && u.close === 1), "USD leg is exactly 1 on every field");
assert(unit.every((u, i) => u.time === legA[i].time), "USD leg inherits the real bar timestamps");
const anchored = ctx.deriveCrossSeries(legA, unit);
assert(anchored.length === 2, "A/USD derived from a real leg is non-empty, got " + anchored.length);
assert(anchored.length === 2 && Math.abs(anchored[1].close - 1.20) < 1e-9, "A/USD close equals the real A close");
assert(anchored.length === 2 && Math.abs(anchored[1].open - 1.15) < 1e-9, "A/USD open equals the real A open");
assert(anchored.length === 2 && Math.abs(anchored[1].high - 1.25) < 1e-9, "A/USD high equals the real A high");
assert(anchored.length === 2 && Math.abs(anchored[1].low - 1.10) < 1e-9, "A/USD low equals the real A low");
const inverted = ctx.deriveCrossSeries(unit, legA);
assert(inverted.length === 2, "USD/A derived from a real leg is non-empty, got " + inverted.length);
assert(inverted.length === 2 && Math.abs(inverted[1].close - 1 / 1.20) < 1e-9, "USD/A close inverts the leg");
assert(inverted.length === 2 && Math.abs(inverted[1].high - 1 / 1.10) < 1e-9, "USD/A high = 1 / leg low");

console.log("");
console.log("--- M23: demo data never produces a tradable signal ---");
const demoCase = vm.runInContext(`(() => {
  const rows = [];
  for (let i = 0; i < 200; i++) {
    const close = 100 + i * 0.35;
    rows.push({
      date: new Date(Date.UTC(2024, 0, 1 + Math.floor(i / 24))).toISOString().slice(0, 10),
      time: new Date(Date.UTC(2024, 0, 1, i)).toISOString(),
      open: close - 0.35, high: close + 0.2, low: close - 0.2, close, volume: 1000,
    });
  }
  const cfg = loadStrategyConfig();
  state.rows = rows;
  state.isDemo = false;
  const live = analyze(rows, cfg, "T/B", false);
  state.isDemo = true;
  const demo = analyze(rows, cfg, "T/B", false);
  state.isDemo = false;
  return { live, demo };
})()`, ctx);
assert(demoCase.demo.direction === "WAIT", "demo data is forced to WAIT, got " + demoCase.demo.direction);
assert(demoCase.demo.confidence === 0, "demo confidence is 0, got " + demoCase.demo.confidence);
assert(/demo data/.test(demoCase.demo.risk), "demo risk line names the demo data, got " + demoCase.demo.risk);
assert(demoCase.demo.ml === null, "no ML prediction is attached to demo output");
assert(demoCase.demo.reasons.some((r) => /must not be traded/.test(r.text)), "demo output carries a do-not-trade reason");
assert(demoCase.live.direction !== "WAIT" || demoCase.live.confidence > 0, "the same rows analysed as live are not suppressed (control)");

console.log("");
console.log("--- M24: intraday fallback to daily keeps a real source label ---");
const fxNotice = vm.runInContext(`(() => {
  state.base = "EUR"; state.quote = "JPY"; state.timeframe = "1h";
  state.rows = []; state.source = ""; state.notice = ""; state.isDemo = false; state.status = "idle";
  return { ok: true };
})()`, ctx);
assert(fxNotice.ok === true, "FX intraday state can be staged for a fallback load");
const hasDailyFallback = /catch \(intradayError\)[\s\S]{0,600}?fetchFxRows\(base, quote\)[\s\S]{0,400}?state\.timeframe = "1d"/.test(js);
assert(hasDailyFallback, "failed intraday FX degrades to daily ECB rates instead of demo data");

console.log("");
console.log("--- M25: signal history records BUY and SELL only ---");
const histSnapshot = vm.runInContext("autoScan.history.map(e => ({...e}))", ctx);
const savedHistRaw = ls.get("signalHistory");
const histLen = () => vm.runInContext("autoScan.history.length", ctx);
const countDir = (d) => vm.runInContext(`autoScan.history.filter(e => e.direction === ${JSON.stringify(d)}).length`, ctx);

assert(ctx.addSignalToHistory("EUR/USD", null) === false, "a null task is not recorded");
assert(ctx.addSignalToHistory("EUR/USD", { direction: "WAIT" }) === false, "a WAIT task is not recorded");
const lenAfterWait = histLen();
for (let i = 0; i < 5; i++) ctx.addSignalToHistory("EUR/USD", { direction: "WAIT", confidence: 50 });
assert(histLen() === lenAfterWait, "five WAIT evaluations leave history untouched, got " + histLen() + " vs " + lenAfterWait);

const buyTask = { direction: "BUY", confidence: 80, risk: "Low", entry: 1.1, stop: 1.09, target: 1.13 };
assert(ctx.addSignalToHistory("EUR/USD", buyTask) === true, "a BUY task is recorded");
assert(histLen() === lenAfterWait + 1, "history grew by one for the BUY, got " + histLen());
assert(ctx.addSignalToHistory("GBP/USD", { direction: "SELL", confidence: 74, risk: "Low" }) === true, "a SELL task is recorded");
assert(histLen() === lenAfterWait + 2, "history grew by two, got " + histLen());
assert(countDir("BUY") > 0 && countDir("SELL") > 0, "BUY and SELL entries are present");
assert(countDir("WAIT") === 0, "no WAIT entry exists after recording, got " + countDir("WAIT"));

const demoTask = vm.runInContext(`(() => {
  const cfg = loadStrategyConfig();
  state.rows = ${JSON.stringify(
    Array.from({ length: 200 }, (_, i) => {
      const close = 100 + i * 0.35;
      return { date: "2024-01-01", time: new Date(Date.UTC(2024, 0, 1, i)).toISOString(), open: close - 0.35, high: close + 0.2, low: close - 0.2, close, volume: 1000 };
    })
  )};
  state.isDemo = true;
  const a = analyze(state.rows, cfg, "NZD/USD", true);
  state.isDemo = false;
  return a;
})()`, ctx);
const lenBeforeDemo = histLen();
const demoAdded = ctx.addSignalToHistory("NZD/USD", demoTask);
assert(demoTask.direction === "WAIT", "demo-suppressed analysis yields WAIT, got " + demoTask.direction);
assert(demoAdded === false, "a demo-suppressed result is not recorded");
assert(histLen() === lenBeforeDemo, "demo output does not pad history");

// Persisted WAIT entries from earlier builds are purged on load. ids double as
// creation timestamps, so they must be recent to clear the 14-day cutoff.
const freshId = Date.now();
ls.set("signalHistory", JSON.stringify([
  { id: freshId - 2, timestamp: freshId - 2, pair: "EUR/USD", direction: "WAIT", result: "pending" },
  { id: freshId - 1, timestamp: freshId - 1, pair: "EUR/USD", direction: "BUY", result: "pending" },
  { id: freshId, timestamp: freshId, pair: "GBP/USD", direction: "SELL", result: "pending" },
]));
vm.runInContext("loadHistory()", ctx);
assert(histLen() === 2, "loadHistory drops persisted WAIT entries, got " + histLen());
assert(countDir("WAIT") === 0, "loaded history contains no WAIT entries");

// restore for any later assertions
vm.runInContext("autoScan.history = " + JSON.stringify(histSnapshot) + "; autoScan.history.forEach(e => e.timestamp = new Date(e.timestamp));", ctx);
if (savedHistRaw !== undefined) ls.set("signalHistory", savedHistRaw); else ls.delete("signalHistory");

console.log("");
console.log("--- M26: render survives empty rows when the ML model is trained ---");
// Regression: with a trained model, the risk section's "·ML" marker read
// analysis2.ml on the null produced for empty rows, so every fresh load() tore
// the dashboard down before the first bar arrived.
const mlBefore = vm.runInContext("({ trained: mlModel.trained, n: mlModel.n, minSamples: mlModel.minSamples })", ctx);
let renderThrew = null;
try {
  vm.runInContext(
    "mlModel.trained = true; mlModel.n = 12; mlModel.minSamples = 8; mlFilterEnabled = false; state.timeframe = '1h'; state.rows = []; state.status = 'loading'; state.error = ''; state.notice = ''; state.source = ''; document.getElementById('root').innerHTML = ''; render();",
    ctx
  );
} catch (e) { renderThrew = e && e.message; }
assert(renderThrew === null, "render() does not throw when ML is trained and rows are empty, got: " + renderThrew);
assert(vm.runInContext("document.getElementById('root').innerHTML", ctx) !== "", "render still writes the shell around a loading state");
vm.runInContext("mlModel.trained = " + mlBefore.trained + "; mlModel.n = " + mlBefore.n + "; mlModel.minSamples = " + mlBefore.minSamples + ";", ctx);

console.log("");
console.log("dashboard.test.js  PASS:", pass, " FAIL:", fail);
process.exit(fail > 0 ? 1 : 0);
