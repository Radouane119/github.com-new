"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "src/app/manifest.json"), "utf8"));
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  console.error("FAIL: src/app/manifest.json does not list any sources");
  process.exit(1);
}

// Runtime tests run against the sources directly; static markup/CSP checks
// still inspect the generated index.html. The build concatenates these files
// in the same manifest order, so this keeps the suite independent of packaging
// while still guarding the shipped document.
let js = manifest.files
  .map((name) => fs.readFileSync(path.join(ROOT, "src/app", name), "utf8"))
  .join("")
  .replace(/\r\n?/g, "\n");

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
  AbortController: class { constructor() { this.signal = undefined; } abort() {} },
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
  vm.runInContext(js, ctx, { filename: "dashboard-sources.js" });
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
console.log("--- M27: Twelve Data intraday FX feed ---");
(async () => {
// The only browser-readable intraday FX source (EUR/JPY etc. down to 1m), used
// when Binance USDT legs cannot build a cross. Free tier: 800 requests/day.
vm.runInContext("fxApiPrefs.enabled = false; fxApiPrefs.key = '';", ctx);
assert(await ctx.fetchTwelveDataRows("EUR", "JPY", "1h") === null, "a disabled feed returns null without fetching");
vm.runInContext("fxApiPrefs.enabled = true; fxApiPrefs.key = '';", ctx);
assert(await ctx.fetchTwelveDataRows("EUR", "JPY", "1h") === null, "a feed with no key returns null");

vm.runInContext("fxApiPrefs.enabled = true; fxApiPrefs.key = 'TESTKEY';", ctx);
const tdRequests = [];
ctx.fetch = (url) => {
  tdRequests.push(String(url));
  const o = 100.62, h = 100.67, l = 100.57, c = 100.63;
  const t = (k) => new Date(Date.UTC(2026, 9, 8, 15, 0, 0) - k * 60000).toISOString().replace(".000Z", "").replace("T", " ");
  const values = Array.from({ length: 85 }, (_, i) => ({ datetime: t(i), open: String(o), high: String(h), low: String(l), close: String(c), volume: String(100 + i) }));
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "ok", values }) });
};
const mapped = await ctx.fetchTwelveDataRows("EUR", "JPY", "1h");
assert(tdRequests.length === 1 && tdRequests[0].includes("EUR/JPY") && tdRequests[0].includes("interval=1h") && tdRequests[0].includes("TESTKEY"), "the Twelve Data URL carries symbol, interval and key");
assert(mapped && mapped.length === 85, "85 percentile bars are mapped, got " + (mapped && mapped.length));
assert(mapped[84].time.startsWith("2026-10-08 15:00") || mapped[0].time.startsWith("2026-10-08 15:00"), "bars are sorted ascending (oldest first)");
assert(Number(mapped[0].close) >= 99 && Number(mapped[0].close) <= 103, "close is parsed to a number");
assert(mapped.every((r) => r.open > 0 && r.high > 0 && r.low > 0 && r.high >= Math.max(r.open, r.close) && r.low <= Math.min(r.open, r.close)), "every mapped bar has valid OHLC geometry");
assert(vm.runInContext("fxApiLastUsed", ctx) === "Twelve Data", "fxApiLastUsed is set so the source label reports Twelve Data");

// A clean entry with the key cleared still refuses the call.
vm.runInContext("fxApiPrefs.key = '';", ctx);
assert(await ctx.fetchTwelveDataRows("EUR", "JPY", "1h") === null, "a cleared key is not sent");
vm.runInContext("fxApiPrefs.key = 'TESTKEY';", ctx);

// fetchForexRows: Binance-derived cross is empty for JPY, so the vendor must
// supply the intraday series; without a key the pair degrades to a thrown error
// whose message points the user at Settings rather than at fake data.
const realFxIntraday = ctx.fetchFxIntradayCross;
ctx.fetchFxIntradayCross = async () => [];
let vendorRows = null;
let vendorErr = null;
vm.runInContext("fxApiLastUsed = null;", ctx);
try { vendorRows = await ctx.fetchForexRows("EUR", "JPY", "1h"); } catch (e) { vendorErr = e && e.message; }
assert(vendorRows && vendorRows.length === 85, "fetchForexRows falls through to the vendor cross, got " + (vendorErr || (vendorRows && vendorRows.length)));
assert(vm.runInContext("fxSourceLabel('EUR','JPY',null)", ctx) === "Twelve Data", "the source label reports Twelve Data for a vendor-fed cross");
vm.runInContext("fxApiPrefs.enabled = false;", ctx);
try { await ctx.fetchForexRows("EUR", "JPY", "1h"); vendorRows = "FAILED"; } catch (e) { vendorErr = e && e.message; }
assert(vendorErr && vendorErr.includes("Twelve Data"), "without a key the EUR/JPY error points to the Twelve Data setting, got: " + vendorErr);
vm.runInContext("fxApiPrefs.enabled = true;", ctx);
ctx.fetchFxIntradayCross = realFxIntraday;
ctx.fetch = () => new Promise(() => {});

console.log("");
console.log("--- M28: live FX prices move instead of freezing on daily ECB ---");
// fetchTwelveDataPrice: the 1-credit /price feed used for Binance-uncovered FX.
vm.runInContext("fxApiPrefs.enabled = false; fxApiPrefs.key = '';", ctx);
assert(await ctx.fetchTwelveDataPrice("EUR", "JPY") === null, "a disabled price feed returns null");
vm.runInContext("fxApiPrefs.enabled = true; fxApiPrefs.key = 'TPKEY';", ctx);
ctx.fetch = (url) => {
  const u = String(url);
  if (u.includes("api.twelvedata.com/price")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "ok", price: "169.12" }) });
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};
const tp1 = await ctx.fetchTwelveDataPrice("EUR", "JPY");
assert(tp1 && tp1.price === 169.12, "Twelve Data /price maps to a number, got " + (tp1 && tp1.price));
const tp2 = await ctx.fetchTwelveDataPrice("EUR", "JPY");
assert(tp2 === null, "price re-quotes at most once a minute (throttled), got " + tp2);

// Regression: a missing quote leg (JPY/CHF/NZD/CAD) must not divide by 1 and
// silently present EUR/USD as EUR/JPY. With Twelve Data off, a leg-less pair
// must fall through to the Frankfurter daily rate instead of a ~1.09 ratio.
vm.runInContext("fxApiPrefs.enabled = false;", ctx);
const realLegFn = ctx.fetchFxUsdLegSeries;
ctx.fetchFxUsdLegSeries = async (cur, interval) =>
  cur === "EUR" ? [{ time: "2026-10-08T14:00:00Z", close: 1.09 }, { time: "2026-10-08T14:01:00Z", close: 1.09 }] : null;
ctx.fetch = (url) => {
  const u = String(url);
  if (u.includes("frankfurter.dev/v1/latest")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ base: "EUR", rates: { JPY: 169.5, CHF: 0.94 } }) });
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};
const euroJpy = await ctx.fetchLivePrice("EUR", "JPY");
assert(euroJpy && euroJpy.price === 169.5, "leg-less EUR/JPY falls back to the 169.x daily rate, not the EUR/USD ratio, got " + (euroJpy && euroJpy.price));
const eurChf = await ctx.fetchLivePrice("EUR", "CHF");
assert(eurChf && eurChf.price === 0.94, "same fallback applies to other missing legs (EUR/CHF), got " + (eurChf && eurChf.price));

// refreshFxPositionPrices writes a live marker but keeps the daily vault intact.
vm.runInContext(
  `positions.push({ id: 99001, pair: "EUR/JPY", direction: "SELL", entry: 170, stop: 171, target: 169, openedAt: new Date(), closedAt: null, pnl: null, pnlPct: null });`,
  ctx
);
vm.runInContext("fxApiPrefs.enabled = true; fxApiPrefs.key = 'TPKEY';", ctx);
const beforeSlots = vm.runInContext("Object.keys(multiScan.results).length", ctx);
await ctx.refreshFxPositionPrices();
const slot = vm.runInContext("multiScan.results['EUR/JPY']", ctx);
assert(slot && Number.isFinite(slot.price) && slot.price > 0, "open EUR/JPY position gets a live price slot, got " + (slot && slot.price));
assert(slot.priceUpdatedAt > 0, "the position slot records when it was last re-quoted");
vm.runInContext("positions = positions.filter(p => p.id !== 99001);", ctx);
ctx.fetchFxUsdLegSeries = realLegFn;
ctx.fetch = () => new Promise(() => {});

console.log("");
console.log("--- M29: scan-all honours a per-timeframe option (1M..1D) ---");
assert(vm.runInContext("multiScan.timeframe", ctx) === "1d", "scan-all defaults to daily");
ls.set("overviewPrefs", JSON.stringify({ sortMode: "name", filter: "SELL", timeframe: "15m" }));
vm.runInContext("loadOverviewPrefs()", ctx);
assert(vm.runInContext("multiScan.timeframe", ctx) === "15m", "a persisted scan timeframe is restored");
vm.runInContext("multiScan.timeframe = '1h'; saveOverviewPrefs();", ctx);
assert(JSON.parse(ls.get("overviewPrefs")).timeframe === "1h", "the scan timeframe is persisted");
ls.set("overviewPrefs", JSON.stringify({ timeframe: "9z" }));
vm.runInContext("loadOverviewPrefs()", ctx);
assert(vm.runInContext("multiScan.timeframe", ctx) === "1h", "an invalid timeframe value is rejected");

const realBinRows = ctx.fetchBinanceRows;
const realFxRows = ctx.fetchFxRows;
const realForexRows = ctx.fetchForexRows;
const binTfs = [];
ctx.fetchBinanceRows = async (b, q, tf) => { binTfs.push(tf || "1d"); return [{ time: "t", close: 100 }]; };
let fxDay = 0;
const forexCalls = [];
ctx.fetchFxRows = async () => { fxDay++; return [{ time: "t", close: 169 }]; };
ctx.fetchForexRows = async (b, q, tf) => { forexCalls.push([b, q, tf]); return [{ time: "t", close: 169 }]; };
await ctx.fetchOverviewRows("BTC/USD", "15m");
await ctx.fetchOverviewRows("BTC/USD", "1d");
assert(binTfs[0] === "15m" && binTfs[1] === "1d", "crypto scans use the selected timeframe, got " + binTfs.join(","));
await ctx.fetchOverviewRows("EUR/JPY", "1d");
await ctx.fetchOverviewRows("EUR/JPY", "15m");
assert(fxDay === 1, "daily FX scans use ECB daily rows, got " + fxDay + " daily fetches");
assert(forexCalls.length === 1 && forexCalls[0][0] === "EUR" && forexCalls[0][2] === "15m", "intraday FX scans route through fetchForexRows, got " + JSON.stringify(forexCalls));

ctx.fetchBinanceRows = async (b, q, tf) => Array.from({ length: 200 }, (_, i) => { const close = 100 + i * 0.2; return { time: "t" + i, open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 1000 }; });
const realAnalyze = ctx.analyze;
ctx.analyze = () => ({ direction: "BUY", confidence: 80 });
const cfg = vm.runInContext("loadStrategyConfig()", ctx);
const mtfAdj = await ctx.computeMtfAdjustment("BTC", "USD", cfg, "BUY", ["1d", "4h"]);
assert(mtfAdj.score === 30 && mtfAdj.matched === 2, "aligned contexts boost the MTF score, got " + JSON.stringify(mtfAdj));
const mtfAdjN = await ctx.computeMtfAdjustment("BTC", "USD", cfg, "SELL", ["1d", "4h"]);
assert(mtfAdjN.score === -30 && mtfAdjN.matched === 0, "misaligned contexts subtract from the MTF score, got " + JSON.stringify(mtfAdjN));
ctx.analyze = realAnalyze;
ctx.fetchBinanceRows = realBinRows;
ctx.fetchFxRows = realFxRows;
ctx.fetchForexRows = realForexRows;

console.log("");
console.log("--- M30: expanded FX + crypto universe is internally consistent ---");
const universe = vm.runInContext("currencies", ctx);
const nameMap = vm.runInContext("names", ctx);
const nonFiatSet = vm.runInContext("nonFiat", ctx);
const scanList = vm.runInContext("allScanPairs", ctx);
const fiatMajors = vm.runInContext("fxMajors", ctx);
assert(universe.length >= 60, "currency dropdown universe expanded, got " + universe.length);
assert(scanList.length >= 100, "scan-all universe expanded, got " + scanList.length);
const missingNames = universe.filter((sym) => !nameMap[sym]);
assert(missingNames.length === 0, "every selectable currency has a display name, missing: " + missingNames.join(","));
const cryptoInUniverse = universe.filter((sym) => nonFiatSet.has(sym));
assert(cryptoInUniverse.length >= 25, "crypto selection expanded, got " + cryptoInUniverse.length);
const badPairs = scanList.filter((p) => { const [b, q] = p.split("/"); return !nameMap[b] || !nameMap[q]; });
assert(badPairs.length === 0, "every scan pair references named currencies, bad: " + badPairs.slice(0, 5).join(","));
const dup = scanList.filter((p, i) => scanList.indexOf(p) !== i);
assert(dup.length === 0, "scan universe has no duplicate pairs, dup: " + [...new Set(dup)].join(","));
const nonFiatMajors = [...fiatMajors].filter((sym) => nonFiatSet.has(sym));
assert(nonFiatMajors.length === 0, "fxMajors contains only fiat symbols, bad: " + nonFiatMajors.join(","));
assert(fiatMajors.has("NOK") && fiatMajors.has("SEK") && fiatMajors.has("ZAR") && fiatMajors.has("SGD"), "new FX majors are intraday-eligible");
assert(nonFiatSet.has("TON") && nonFiatSet.has("XLM") && nonFiatSet.has("TRX") && nonFiatSet.has("BCH"), "new cryptos are classified as non-fiat");
assert(ctx.fallbackStartPrice("USD", "HUF") > 100 && ctx.fallbackStartPrice("BCH") > 100, "fallback seed prices exist for new symbols");
const scanSyms = new Set();
scanList.forEach((p) => p.split("/").forEach((s) => scanSyms.add(s)));
const notSelectable = [...scanSyms].filter((s) => !universe.includes(s));
assert(notSelectable.length === 0, "every scannable symbol is selectable in the chart, missing: " + notSelectable.join(","));
assert(Math.abs(ctx.fallbackStartPrice("NOK", "USD") - 0.093) < 0.02, "inverted FX seed prices are rate-based, got " + ctx.fallbackStartPrice("NOK", "USD"));
assert(ctx.fallbackStartPrice("JPY", "USD") < 0.02, "the JPY/USD seed is not stuck at 1.0, got " + ctx.fallbackStartPrice("JPY", "USD"));

console.log("");
console.log("--- M31: Twelve Data requests are paced, budget-capped and 429-retried ---");
vm.runInContext("tdGate.stamps = []; tdGate.day = ''; tdGate.used = 0; tdGate.pausedUntil = 0; fxApiStatus = '';", ctx);
const t0 = Date.UTC(2026, 0, 15, 12, 0, 0);
let admitted = 0;
for (let i = 0; i < 6; i++) { if (vm.runInContext(`tdReserve(${t0})`, ctx) === 0) admitted++; }
assert(admitted === 6, "the first six requests in a minute are admitted, got " + admitted);
assert(vm.runInContext(`tdReserve(${t0})`, ctx) > 0, "the seventh request in the same minute is held back");
assert(vm.runInContext(`tdReserve(${t0 + 61000})`, ctx) === 0, "a slot reopens after the minute rolls over");
assert(vm.runInContext("tdGate.used", ctx) === 7, "the request counter tracks admissions, got " + vm.runInContext("tdGate.used", ctx));
vm.runInContext("tdGate.used = TD_PER_DAY;", ctx);
assert(vm.runInContext(`tdReserve(${t0 + 120000})`, ctx) === -1, "the daily credit budget is enforced");
vm.runInContext("tdGate.stamps = []; tdGate.day = ''; tdGate.used = 0; tdGate.pausedUntil = 0; fxApiStatus = ''; tdRetryDelayMs = 0;", ctx);
assert(vm.runInContext("tdNoteRateLimit(1000) === undefined && tdGate.pausedUntil", ctx) === 21000, "a 429 schedules a backoff window");
assert(vm.runInContext("tdReserve(15000) > 0", ctx), "requests during the 429 backoff are held");
assert(vm.runInContext("tdReserve(22000) === 0", ctx), "requests resume after the backoff window");
let n429 = 0;
const realFetch429 = ctx.fetch;
// The harness stubs setTimeout to a no-op so the app's timers never keep the
// process alive. The 429 retry path legitimately awaits a backoff timer, so
// hand it a working one for the duration of this check only.
const realTimeoutForRetry = ctx.setTimeout;
ctx.setTimeout = (fn) => { queueMicrotask(fn); return 0; };
vm.runInContext("fxApiPrefs.enabled = true; fxApiPrefs.key = 'TDRL'; tdGate.stamps = []; tdGate.day = ''; tdGate.used = 0; tdGate.pausedUntil = 0; tdRetryDelayMs = 0;", ctx);
ctx.fetch = () => { n429++; return Promise.resolve({ ok: false, status: 429, json: async () => ({}) }); };
let rlErr = null;
try { await ctx.fetchTwelveDataRows("EUR", "JPY", "1h"); } catch (e) { rlErr = e && e.message; }
ctx.setTimeout = realTimeoutForRetry;
assert(n429 === 2, "a 429 is retried exactly once, got " + n429 + " attempts");
assert(rlErr && rlErr.includes("429"), "a persistent 429 surfaces an error, got: " + rlErr);
ctx.fetch = realFetch429;
vm.runInContext("fxApiPrefs.enabled = false; fxApiPrefs.key = ''; tdRetryDelayMs = 1500; tdGate.stamps = []; tdGate.day = ''; tdGate.used = 0; tdGate.pausedUntil = 0; fxApiStatus = '';", ctx);

console.log("");
console.log("--- M32: scan-pair selection is versioned and has bulk controls ---");
vm.runInContext("scanPairs = [...allScanPairs]; saveScanConfig();", ctx);
const savedCfg = JSON.parse(ls.get("scanConfig"));
assert(Array.isArray(savedCfg.pairs) && Array.isArray(savedCfg.known), "the scan config stores pairs plus the known universe");
assert(savedCfg.known.length === vm.runInContext("allScanPairs.length", ctx), "the saved universe matches the current one");
// A config saved against a smaller universe must pull the new pairs back in.
ls.set("scanConfig", JSON.stringify({ pairs: ["BTC/USD", "EUR/USD"], known: ["BTC/USD", "EUR/USD"] }));
vm.runInContext("scanPairs = []; loadScanConfig();", ctx);
const migrated = vm.runInContext("scanPairs", ctx);
assert(migrated.includes("TON/USD") && migrated.includes("USD/NOK"), "pairs added since the last save are restored automatically");
assert(migrated.includes("BTC/USD") && migrated.includes("EUR/USD"), "the user's existing selection is preserved");
// A legacy (unversioned) array must still load without crashing.
ls.set("scanConfig", JSON.stringify(["BTC/USD", "USD/JPY"]));
vm.runInContext("scanPairs = []; loadScanConfig();", ctx);
assert(JSON.parse(JSON.stringify(vm.runInContext("scanPairs", ctx))).join(",") === "BTC/USD,USD/JPY", "a legacy array config still loads");
vm.runInContext("scanPairs = [...allScanPairs]; saveScanConfig();", ctx);

console.log("");
console.log("--- M33: overview scans price leg-less intraday FX from daily, not the vendor ---");
// A scan fans out to every FX pair, so it must not spend Twelve Data credits on
// pairs that have no Binance USDT leg - that both stalls the scan (6/min) and
// drains the free daily budget. The chart path keeps paying the vendor.
// The real FX fetch path needs AbortController, which the harness does not stub
// (earlier tests only ever hit stubbed fetch functions), so provide it here.
const realAbortScan = ctx.AbortController;
ctx.AbortController = AbortController;
vm.runInContext("fxApiPrefs.enabled = true; fxApiPrefs.key = 'TPKEY'; fxUsdLegCache.clear(); tdGate.stamps = []; tdGate.day = ''; tdGate.used = 0; tdGate.pausedUntil = 0;", ctx);
const realFetchScan = ctx.fetch;
let tdHitsScan = 0, ffHitsScan = 0;
ctx.fetch = (url) => {
  const u = String(url);
  if (u.includes("twelvedata")) { tdHitsScan++; return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "ok", values: [] }) }); }
  if (u.includes("frankfurter")) {
    ffHitsScan++;
    const q = (u.match(/to=([A-Z]+)/) || [])[1] || "JPY";
    const rates = {};
    for (let i = 0; i < 200; i++) rates[new Date(Date.now() - (200 - i) * 864e5).toISOString().slice(0, 10)] = { [q]: 1.1 + i * 0.001 };
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ rates }) });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};
const scanRows = await ctx.fetchOverviewRows("EUR/JPY", "1h");
assert(scanRows && scanRows.length >= 80, "an intraday scan FX pair still returns rows, got " + (scanRows && scanRows.length));
assert(tdHitsScan === 0, "an overview scan never spends Twelve Data credits, got " + tdHitsScan);
assert(ffHitsScan >= 1, "an overview scan falls back to daily Frankfurter, got " + ffHitsScan);
// The single-chart path (allowVendor defaults true) still prefers the vendor.
let tdHitsChart = 0;
vm.runInContext("fxUsdLegCache.clear();", ctx);
ctx.fetch = (url) => {
  const u = String(url);
  if (u.includes("twelvedata")) {
    tdHitsChart++;
    const values = Array.from({ length: 100 }, (_, i) => ({ datetime: new Date(Date.now() - (100 - i) * 36e5).toISOString().slice(0, 19).replace("T", " "), open: "1", high: "2", low: "0.5", close: "1.5", volume: "0" }));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "ok", values }) });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};
const chartRows = await ctx.fetchForexRows("EUR", "JPY", "1h");
assert(tdHitsChart === 1, "the chart path still calls the vendor, got " + tdHitsChart);
assert(chartRows && chartRows.length >= 80, "the chart path returns vendor rows, got " + (chartRows && chartRows.length));
ctx.fetch = realFetchScan;
ctx.AbortController = realAbortScan;
vm.runInContext("fxApiPrefs.enabled = false; fxApiPrefs.key = ''; fxUsdLegCache.clear(); tdGate.stamps = []; tdGate.day = ''; tdGate.used = 0; tdGate.pausedUntil = 0; fxApiStatus = '';", ctx);

console.log("");
console.log("--- M34: untrusted data is escaped and rejected at the boundary ---");
// The browser supplies URL; the sandbox needs it for webhook validation.
if (!ctx.URL) ctx.URL = URL;
const alertMsgs = [];
const realAlert = ctx.alert;
const realConfirm = ctx.confirm;
ctx.alert = (msg) => alertMsgs.push(String(msg));
ctx.confirm = () => true;

assert(ctx.escapeHtml('<img src=x onerror="a">&\'') === "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;", "escapeHtml neutralises HTML metacharacters");
assert(vm.runInContext("escapeAttr === escapeHtml", ctx), "escapeAttr uses the same escaping as escapeHtml");
assert(ctx.escapeHtml(null) === "" && ctx.escapeHtml(42) === "42", "escapeHtml handles null and numbers");

assert(ctx.isValidWebhookUrl("https://discord.com/api/webhooks/1/x"), "https Discord webhooks are accepted");
assert(ctx.isValidWebhookUrl("https://canary.discord.com/api/webhooks/1/x"), "Discord subdomains are accepted");
assert(ctx.isValidWebhookUrl("https://api.telegram.org/bot1/sendMessage"), "the Telegram API is accepted");
assert(!ctx.isValidWebhookUrl("http://discord.com/api/webhooks/1/x"), "plain http webhooks are rejected");
assert(!ctx.isValidWebhookUrl("https://discord.com.evil.example/x"), "look-alike hosts are rejected");
assert(!ctx.isValidWebhookUrl("javascript:alert(1)"), "javascript: URLs are rejected");
assert(!ctx.isValidWebhookUrl(""), "empty webhooks are rejected");
assert(!ctx.isValidWebhookUrl("https://example.com/hook"), "unrelated hosts are rejected");

assert(ctx.cleanPair("eur/usd") === "EUR/USD", "cleanPair normalises a valid pair");
assert(ctx.cleanPair("<img>/USD") === null, "cleanPair rejects markup");
assert(ctx.cleanPair("EUR/USD/EVIL") === null, "cleanPair rejects extra segments");
assert(JSON.stringify(ctx.sanitizePairList(["BTC/USD", "btc/usd", "<x>", 5])) === '["BTC/USD"]', "sanitizePairList dedupes and drops junk");

const nowIso = new Date().toISOString();
const goodEntry = ctx.sanitizeHistoryEntry({ pair: "EUR/USD", direction: "BUY", timestamp: nowIso, confidence: 140, risk: "<b>Low</b>", reasons: [{ ok: true, text: "<script>x</script>" }] });
assert(goodEntry && goodEntry.confidence === 100, "history confidence is clamped, got " + (goodEntry && goodEntry.confidence));
assert(goodEntry.risk === "<b>Low</b>", "history risk stays raw for the renderer to escape");
assert(goodEntry.reasons[0].text === "<script>x</script>", "reason text is bounded but kept raw");
assert(ctx.sanitizeHistoryEntry({ pair: "EUR/USD", direction: "WAIT", timestamp: nowIso }) === null, "WAIT entries are rejected");
assert(ctx.sanitizeHistoryEntry({ pair: "<img>/USD", direction: "BUY", timestamp: nowIso }) === null, "hostile pairs are rejected");
assert(ctx.sanitizeHistoryEntry({ pair: "EUR/USD", direction: "BUY", timestamp: "nope" }) === null, "invalid timestamps are rejected");
assert(ctx.sanitizePosition({ pair: "EUR/USD", direction: "BUY", entry: null, openedAt: nowIso }) === null, "positions without an entry price are rejected");
const pos = ctx.sanitizePosition({ id: '1"><img>', pair: "EUR/USD", direction: "BUY", entry: 1.1, openedAt: nowIso });
assert(pos && pos.id !== '1"><img>', "unsafe string position ids are replaced");
assert(ctx.sanitizeAlerts([{ pair: "EUR/USD", price: -1 }, { pair: "EUR/USD", price: 1.1 }]).length === 1, "non-positive alert prices are dropped");
const alertRow = ctx.sanitizeAlertHistory([{ pair: "EUR/USD", timestamp: nowIso, type: "<b>risk</b>", message: "<img>" }]);
assert(alertRow.length === 1 && alertRow[0].type === "<b>risk</b>", "alert types are bounded and left raw for the renderer");

// Import must reject hostile or malformed backups without touching live state.
vm.runInContext("autoScan.history = [{ pair: 'EUR/USD', direction: 'BUY', timestamp: new Date(), confidence: 70, risk: 'Low', reasons: [], result: 'pending', id: Date.now() }]", ctx);
const historyBefore = vm.runInContext("autoScan.history.length", ctx);
const realRender = ctx.render;
ctx.render = () => {};
alertMsgs.length = 0;
ctx.importAllData(JSON.stringify({ history: "nope", positions: [] }));
assert(alertMsgs.length === 1 && vm.runInContext("autoScan.history.length", ctx) === historyBefore, "a malformed import is rejected without changing state");
ctx.importAllData(JSON.stringify({
  history: [
    { pair: "EUR/USD", direction: "BUY", timestamp: nowIso, confidence: 80 },
    { pair: "<img>/USD", direction: "BUY", timestamp: nowIso },
  ],
  positions: [{ pair: "BTC/USD", direction: "SELL", entry: 100, openedAt: nowIso }],
  webhookUrl: "javascript:alert(1)",
  watchlist: ["BTC/USD", "<x>"],
}));
assert(vm.runInContext("autoScan.history.length", ctx) === 1, "an import keeps only valid history rows");
assert(vm.runInContext("positions.length", ctx) === 1, "an import keeps only valid positions");
assert(vm.runInContext("webhookUrl", ctx) === "", "an imported javascript: webhook is ignored");
assert(JSON.stringify(vm.runInContext("watchlist", ctx)) === '["BTC/USD"]', "an imported watchlist is sanitised");
assert(alertMsgs.length === 1, "a partially valid import does not raise the invalid-file alert");
ctx.importAllData("x".repeat(2 * 1024 * 1024 + 1));
assert(alertMsgs.length === 2, "oversized imports are rejected before parsing");
ctx.render = realRender;
ctx.alert = realAlert;
ctx.confirm = realConfirm;

console.log("");
console.log("--- M35: shared market cache, circuit breaker and persisted budget ---");
// The cache is process-wide, so every test below starts from a clean slate.
const realCacheFetch = ctx.fetch;
try {
  vm.runInContext("clearMarketCache()", ctx);

  // A fresh entry is reused without touching the network.
  let hitCalls = 0;
  ctx.fetch = () => {
    hitCalls++;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: 42 }) });
  };
  const hit1 = await ctx.cachedJson("https://example.test/a", { ttl: 60000, key: "test:a", provider: "test" });
  const hit2 = await ctx.cachedJson("https://example.test/a", { ttl: 60000, key: "test:a", provider: "test" });
  assert(hitCalls === 1, "a fresh cache entry does not re-fetch, got " + hitCalls + " calls");
  assert(hit1.cache === "miss" && hit2.cache === "hit", "cache miss then hit is reported, got " + hit1.cache + "/" + hit2.cache);
  assert(hit2.data.value === 42, "the cached payload is returned intact");

  // Two callers for the same key share one in-flight request.
  let inflightCalls = 0;
  let releaseInflight = null;
  ctx.fetch = () => {
    inflightCalls++;
    return new Promise((resolve) => {
      releaseInflight = () => resolve({ ok: true, status: 200, json: async () => ({ value: 7 }) });
    });
  };
  const shared1 = ctx.cachedJson("https://example.test/b", { ttl: 60000, key: "test:b", provider: "test" });
  const shared2 = ctx.cachedJson("https://example.test/b", { ttl: 60000, key: "test:b", provider: "test" });
  releaseInflight();
  const [sharedA, sharedB] = await Promise.all([shared1, shared2]);
  assert(inflightCalls === 1, "identical in-flight keys are deduped, got " + inflightCalls + " requests");
  assert(sharedA.data.value === 7 && sharedB.data.value === 7, "both deduped callers receive the payload");

  // TTL expiry forces a refetch.
  let ttlCalls = 0;
  ctx.fetch = () => {
    ttlCalls++;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: ttlCalls }) });
  };
  await ctx.cachedJson("https://example.test/c", { ttl: 1, key: "test:c", provider: "test" });
  await new Promise((resolve) => setTimeout(resolve, 8));
  const expired = await ctx.cachedJson("https://example.test/c", { ttl: 1, key: "test:c", provider: "test" });
  assert(ttlCalls === 2 && expired.cache === "miss", "an expired entry is fetched again, got " + ttlCalls + " calls/" + expired.cache);

  // Persistence: clearing only the in-memory maps simulates a page reload.
  let reloadCalls = 0;
  ctx.fetch = () => {
    reloadCalls++;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: "persisted" }) });
  };
  await ctx.cachedJson("https://example.test/d", { ttl: 60000, key: "test:d", provider: "test" });
  vm.runInContext("marketCache.clear(); marketCacheIndex = null;", ctx);
  const reloaded = await ctx.cachedJson("https://example.test/d", { ttl: 60000, key: "test:d", provider: "test" });
  assert(reloadCalls === 1 && reloaded.cache === "hit", "a persisted entry survives a reload, got " + reloadCalls + " calls/" + reloaded.cache);
  assert(reloaded.data.value === "persisted", "the rehydrated payload matches");
  assert(vm.runInContext("marketCacheStats().entries", ctx) >= 1, "the cache index reports stored entries");

  // Stale-if-error: a failed refresh keeps the last good payload available.
  await new Promise((resolve) => setTimeout(resolve, 8));
  ctx.fetch = () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
  const stale = await ctx.cachedJson("https://example.test/d", { ttl: 1, key: "test:d", provider: "test" });
  assert(stale.cache === "stale-error" && stale.data.value === "persisted", "a failed refresh serves the stale payload, got " + stale.cache);

  // Circuit breaker: three provider failures open the circuit and skip fetch.
  vm.runInContext("clearMarketCache()", ctx);
  let breakerCalls = 0;
  ctx.fetch = () => {
    breakerCalls++;
    return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
  };
  for (let i = 0; i < 3; i++) {
    try { await ctx.cachedJson("https://example.test/e", { ttl: 0, key: "test:e:" + i, provider: "brk" }); } catch {}
  }
  const callsBeforeOpen = breakerCalls;
  let openError = null;
  try { await ctx.cachedJson("https://example.test/e", { ttl: 0, key: "test:e:open", provider: "brk" }); } catch (e) { openError = e && e.message; }
  assert(breakerCalls === callsBeforeOpen && openError && openError.includes("cooling"), "an open breaker fails fast, got " + breakerCalls + " calls and " + openError);

  // Clearing the cache also resets breaker state.
  vm.runInContext("clearMarketCache()", ctx);
  assert(vm.runInContext("marketCacheStats().entries", ctx) === 0 && ls.get("mdc:v1:__index") == null, "clearing removes the persisted index");

  // The daily Twelve Data budget survives a reload, but only for the same UTC day.
  vm.runInContext("localStorage.removeItem('tdGate:v1'); tdGate.stamps = []; tdGate.day = ''; tdGate.used = 0; tdGate.pausedUntil = 0; fxApiStatus = '';", ctx);
  const today = new Date().toISOString().slice(0, 10);
  vm.runInContext(`tdGate.day = '${today}'; tdGate.used = 123; fxApiStatus = 'daily credit budget reached'; saveTdGate(); tdGate.used = 0; tdGate.day = ''; fxApiStatus = ''; loadTdGate();`, ctx);
  assert(vm.runInContext("tdGate.used", ctx) === 123, "the request budget is restored on reload, got " + vm.runInContext("tdGate.used", ctx));
  assert(vm.runInContext("fxApiStatus", ctx).includes("budget"), "the restored budget status is shown in Settings");
  vm.runInContext("localStorage.setItem('tdGate:v1', JSON.stringify({ day: '2000-01-01', used: 500, pausedUntil: 0, status: 'old' })); tdGate.used = 0; tdGate.day = ''; loadTdGate();", ctx);
  assert(vm.runInContext("tdGate.used", ctx) === 0, "a budget from another UTC day is discarded");
  assert(ls.get("tdGate:v1") == null, "the stale budget record is removed");

  // fetchBinanceRows is cached too, so a scan cannot re-download the same candles.
  const realAbort = ctx.AbortController;
  ctx.AbortController = AbortController;
  vm.runInContext("clearMarketCache(); lastCryptoSource = 'Binance';", ctx);
  let binanceCalls = 0;
  const nowMs = Date.now();
  ctx.fetch = () => {
    binanceCalls++;
    const candles = Array.from({ length: 5 }, (_, i) => {
      const stamp = nowMs - (5 - i) * 3600000;
      return [stamp, "100", "101", "99", "100.5", "10"];
    });
    return Promise.resolve({ ok: true, status: 200, json: async () => candles });
  };
  const binanceA = await ctx.fetchBinanceRows("BTC", "USD", "1h");
  const binanceB = await ctx.fetchBinanceRows("BTC", "USD", "1h");
  assert(binanceCalls === 1, "repeated candle loads use the cache, got " + binanceCalls + " requests");
  assert(binanceA.length === 5 && binanceB.length === 5 && binanceB[4].close === 100.5, "cached candles parse identically");
  ctx.AbortController = realAbort;

  // Starting a new scan invalidates the previous token so an old timeframe's
  // results cannot overwrite the new run.
  const realOverviewRows = ctx.fetchOverviewRows;
  const realBinanceRowsForScan = ctx.fetchBinanceRows;
  ctx.fetchOverviewRows = async () => rows;
  ctx.fetchBinanceRows = async () => rows;
  vm.runInContext("scanPairs = ['BTC/USD', 'ETH/USD', 'EUR/USD']; multiScan.results = {}; multiScan.scanning = false; multiScan.scanToken = 0; multiScan.timeframe = '1d';", ctx);
  const firstScan = ctx.scanAllPairs();
  const secondScan = ctx.scanAllPairs();
  await Promise.all([firstScan, secondScan]);
  assert(vm.runInContext("multiScan.scanning", ctx) === false, "a superseded scan releases the scanning lock");
  assert(vm.runInContext("multiScan.scanToken", ctx) >= 2, "restarting a scan advances the cancellation token");
  ctx.fetchOverviewRows = realOverviewRows;
  ctx.fetchBinanceRows = realBinanceRowsForScan;
  vm.runInContext("scanPairs = [...allScanPairs]; multiScan.results = {}; multiScan.progress = '';", ctx);

  assert(ctx.formatCacheAge(42000) === "42s ago", "cache age under a minute is shown in seconds");
  assert(ctx.formatCacheAge(5 * 60 * 1000) === "5m ago", "cache age under an hour is shown in minutes");
  assert(ctx.formatCacheAge(2 * 60 * 60 * 1000) === "2h ago", "cache age is shown in hours");
} finally {
  vm.runInContext("clearMarketCache()", ctx);
  ctx.fetch = realCacheFetch;
}

console.log("--- M36: renders preserve focus, scroll and open panels ---");

// Notes are cached in memory, written debounced, and flushed on blur/pagehide.
vm.runInContext("tradeNotesCache = null; tradeNotesSaveTimer = null;", ctx);
ls.set("tradeNotes", JSON.stringify({ 7: "hello" }));
assert(ctx.getTradeNotes()["7"] === "hello", "trade notes load from storage on first use");
ctx.getTradeNotes()["8"] = "world";
ctx.saveTradeNotesDebounced();
ctx.flushTradeNotes();
assert(JSON.parse(ls.get("tradeNotes"))["8"] === "world", "a debounced note save persists on flush");
ls.set("tradeNotes", JSON.stringify({ 9: "external" }));
assert(ctx.getTradeNotes()["9"] === undefined, "the in-memory note cache wins over a stale storage read");

// Capture focus, caret, panel scroll and open sections before the DOM is replaced.
const scrollEl = { id: "historyScroll", scrollTop: 120, scrollLeft: 3, classList: { add() {} } };
const bodyEl = { id: "historyBody", classList: { added: [], add(c) { this.added.push(c); } } };
const inputEl = {
  id: "rmRisk", tagName: "INPUT", value: "2.5", selectionStart: 1, selectionEnd: 2,
  focused: false, sel: null,
  setSelectionRange(a, b) { this.sel = [a, b]; },
  focus() { this.focused = true; },
};
const settingsEl = { id: "settingsPanel", style: { display: "flex" } };
domEls.settingsPanel = settingsEl;
domEls.historyScroll = scrollEl;
domEls.historyBody = bodyEl;
domEls.rmRisk = inputEl;
const realQuerySelectorAll = domEls.root.querySelectorAll;
const realQuerySelector = domEls.root.querySelector;
domEls.root.querySelectorAll = (sel) => (sel === "[id]" ? [scrollEl, bodyEl] : sel === ".open" ? [bodyEl] : []);
domEls.root.querySelector = (sel) => (sel === '[data-note-pos="7"]' ? inputEl : null);
ctx.document.activeElement = inputEl;
ctx.window.scrollY = 240;
let scrolledTo = null;
ctx.window.scrollTo = (x, y) => { scrolledTo = [x, y]; };

const uiState = ctx.captureUiState();
assert(uiState.scrollY === 240, "window scroll is captured");
assert(uiState.scrolls.length === 1 && uiState.scrolls[0].id === "historyScroll" && uiState.scrolls[0].top === 120, "panel scroll is captured");
assert(uiState.openIds.includes("historyBody"), "open sections are captured");
assert(uiState.settingsOpen === true, "an open settings panel is captured");
assert(uiState.active && uiState.active.key === "#rmRisk" && uiState.active.value === "2.5", "the focused input and its value are captured");

// Simulate the fresh DOM written by render(), then restore.
scrollEl.scrollTop = 0;
bodyEl.classList.added = [];
settingsEl.style.display = "none";
inputEl.value = "";
inputEl.focused = false;
ctx.document.activeElement = null;
ctx.restoreUiState(uiState);
assert(scrollEl.scrollTop === 120, "panel scroll is restored");
assert(bodyEl.classList.added.includes("open"), "open sections are restored");
assert(settingsEl.style.display === "flex", "the settings panel stays open across a render");
assert(inputEl.value === "2.5" && inputEl.focused, "focus and the typed value are restored");
assert(inputEl.sel && inputEl.sel[0] === 1 && inputEl.sel[1] === 2, "the caret selection is restored");
assert(scrolledTo && scrolledTo[1] === 240, "window scroll is restored");

// The minute tick updates only the session bar, and input renders are deferred.
assert(html.includes("refreshSessionBar()"), "the session bar refreshes without a full render");
assert(!html.includes("document.querySelector('.session-bar')) render()"), "the minute tick no longer calls render()");
const shellBefore = vm.runInContext("document.getElementById('root').innerHTML", ctx);
ctx.scheduleRender(10);
assert(vm.runInContext("document.getElementById('root').innerHTML", ctx) === shellBefore, "scheduled renders are deferred, not immediate");

// Cleanup the temporary DOM stubs.
domEls.root.querySelectorAll = realQuerySelectorAll;
domEls.root.querySelector = realQuerySelector;
delete ctx.document.activeElement;
delete ctx.window.scrollY;
delete ctx.window.scrollTo;

console.log("--- M37: analysis/chart memoization and region patching ---");

// analyze(): pure calls are memoized by rows identity, config and ML signature.
vm.runInContext("state.isDemo = false; macdHistVote = false; lastSignals.clear();", ctx);
const cfgA = ctx.loadStrategyConfig();
const memoRows = makeRows(200);
const pureA1 = ctx.analyze(memoRows, cfgA);
const pureA2 = ctx.analyze(memoRows, cfgA);
assert(pureA1 && pureA1 === pureA2, "a repeated pure analyze() returns the cached object");
assert(ctx.analyze(memoRows, { ...cfgA, threshold: (cfgA.threshold ?? 5) + 1 }) !== pureA1, "changing the config invalidates the analysis memo");
assert(ctx.analyze(makeRows(200), cfgA) !== pureA1, "a different rows array invalidates the analysis memo");
assert(ctx.analyze(memoRows.slice(0, 79), cfgA) === null, "short histories still return null before memoizing");

// trackSignal() must never reuse the memo because it mutates lastSignals.
const tracked = ctx.analyze(memoRows, cfgA, "MEMO/TEST", true);
assert(tracked !== pureA1, "a tracked analysis bypasses the memo");
assert(ctx.analyze(memoRows, cfgA, "MEMO/TEST", true) !== tracked, "tracked analyses are recomputed each time");
vm.runInContext("lastSignals.clear()", ctx);

// drawChart(): the memo key covers pair, timeframe, row shape, overlays and size.
const memoChartRows = makeRows(140);
const overlaysOff = { ichimoku: false, fib: false, vwap: false };
const keyA = ctx.chartMemoKey(memoChartRows, "EUR/USD", "1h", overlaysOff, 800, 460, 2);
assert(keyA === ctx.chartMemoKey(memoChartRows, "EUR/USD", "1h", overlaysOff, 800, 460, 2), "the chart memo key is stable for identical inputs");
assert(ctx.chartMemoKey(memoChartRows, "EUR/USD", "1h", { ...overlaysOff, ichimoku: true }, 800, 460, 2) !== keyA, "the Ichimoku overlay invalidates the chart memo");
assert(ctx.chartMemoKey(memoChartRows, "EUR/USD", "1h", { ...overlaysOff, fib: true }, 800, 460, 2) !== keyA, "the Fibonacci overlay invalidates the chart memo");
assert(ctx.chartMemoKey(memoChartRows, "EUR/USD", "1h", { ...overlaysOff, vwap: true }, 800, 460, 2) !== keyA, "the VWAP overlay invalidates the chart memo");
assert(ctx.chartMemoKey(memoChartRows, "EUR/USD", "4h", overlaysOff, 800, 460, 2) !== keyA, "changing the timeframe invalidates the chart memo");
assert(ctx.chartMemoKey(memoChartRows, "EUR/USD", "1h", overlaysOff, 640, 460, 2) !== keyA, "resizing the canvas invalidates the chart memo");
assert(ctx.chartMemoKey(memoChartRows.slice(0, 139), "EUR/USD", "1h", overlaysOff, 800, 460, 2) !== keyA, "a new row count invalidates the chart memo");

// An unchanged canvas must not be repainted.
let widthSets = 0;
const fakeCanvas = {
  getContext: () => new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } }),
  getBoundingClientRect: () => ({ width: 800, height: 460 }),
};
Object.defineProperty(fakeCanvas, "width", { get: () => 0, set: () => { widthSets++; } });
Object.defineProperty(fakeCanvas, "height", { get: () => 0, set: () => {} });
vm.runInContext("ichimokuOverlay = false; fibOverlay = false; vwapOverlay = false;", ctx);
ctx.drawChart(fakeCanvas, memoChartRows, "EUR/USD", "1h");
ctx.drawChart(fakeCanvas, memoChartRows, "EUR/USD", "1h");
assert(widthSets === 1, "an unchanged chart is drawn once and then skipped, got " + widthSets + " resizes");
vm.runInContext("ichimokuOverlay = true;", ctx);
ctx.drawChart(fakeCanvas, memoChartRows, "EUR/USD", "1h");
assert(widthSets === 2, "changing an overlay forces a repaint, got " + widthSets + " resizes");
vm.runInContext("ichimokuOverlay = false;", ctx);

// regionKey(): stable per tag/id/class, disambiguated by sibling position.
const seen = {};
const regionA = ctx.regionKey({ tagName: "SECTION", id: "", className: "dashboard-section" }, seen);
const regionB = ctx.regionKey({ tagName: "SECTION", id: "", className: "dashboard-section" }, seen);
assert(regionA === "section.dashboard-section@0", "the first sibling of a region kind is keyed @0, got " + regionA);
assert(regionB === "section.dashboard-section@1", "a second sibling of the same kind is keyed @1, got " + regionB);
assert(ctx.regionKey({ tagName: "DIV", id: "x", className: "b a" }) === "div#x.a.b", "region keys normalise tag, id and sorted classes");

// Without <template>.content the patcher must fall back to a plain innerHTML write.
domEls.root.innerHTML = "";
ctx.renderIntoRoot("<main><section class='fallback'>fallback body</section></main>");
assert(domEls.root.innerHTML.includes("fallback body"), "renderIntoRoot falls back to innerHTML without <template> support");

// With <template> support, unchanged regions keep their existing nodes.
function fakeRegion(markup, className) {
  return { tagName: "SECTION", id: "", className: className || "", outerHTML: markup, getAttribute: () => null };
}
const prevMain = {
  attributes: [],
  children: [],
  attrs: {},
  getAttribute(name) { return this.attrs[name] ?? null; },
  setAttribute(name, value) { this.attrs[name] = value; },
  replaceChildren(...nodes) { this.children = nodes.slice(); },
};
const nextMain = { attributes: [{ name: "aria-busy", value: "false" }], children: [] };
const fakeTemplate = { innerHTML: "", content: { querySelector: (sel) => (sel === "main" ? nextMain : null) } };
const realCreateElement = ctx.document.createElement;
ctx.document.createElement = (tag) => (tag === "template" ? fakeTemplate : realCreateElement(tag));
domEls.root.querySelector = (sel) => (sel === "main" ? prevMain : null);

const firstRegion = fakeRegion("<section class=\"summary-grid\">A</section>", "summary-grid");
nextMain.children = [firstRegion];
ctx.renderIntoRoot("<main></main>");
assert(prevMain.children.length === 1 && prevMain.children[0] === firstRegion, "the first patch inserts the generated region");
assert(prevMain.attrs["aria-busy"] === "false", "<main> attributes are copied across a patch");

const sameMarkupRegion = fakeRegion("<section class=\"summary-grid\">A</section>", "summary-grid");
nextMain.children = [sameMarkupRegion];
ctx.renderIntoRoot("<main></main>");
assert(prevMain.children[0] === firstRegion, "an unchanged region keeps the existing DOM node");
assert(prevMain.children[0] !== sameMarkupRegion, "the freshly parsed duplicate is discarded");

const changedRegion = fakeRegion("<section class=\"summary-grid\">B</section>", "summary-grid");
nextMain.children = [changedRegion];
ctx.renderIntoRoot("<main></main>");
assert(prevMain.children[0] === changedRegion, "a changed region replaces its node");

ctx.document.createElement = realCreateElement;
domEls.root.querySelector = realQuerySelector;
assert(html.includes("renderIntoRoot(`"), "render() writes through the region patcher");
assert(html.includes("chartMemo.set(canvas, memoKey)"), "drawChart() records the memo after a successful paint");

console.log("--- M38: CORS-safe economic calendar mapping ---");

// The old ForexFactory mirror sent no Access-Control-Allow-Origin header, so the
// browser could never read it. The dashboard now reads a CORS-enabled feed.
const econUrl = ctx.econCalendarUrl(Date.UTC(2026, 10, 9, 12, 0, 0));
assert(econUrl.startsWith("https://biquote.io/api/calendar?"), "the calendar URL points at the CORS-enabled host");
assert(econUrl.includes("from=2026-11-08") && econUrl.includes("to=2026-11-11"), "the calendar URL requests a short forward window, got " + econUrl);
assert(ctx.marketProviderFromUrl("https://biquote.io/api/calendar") === "econ", "biquote is classified as the econ provider");
const cspMeta = (html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || "";
assert(cspMeta.includes("https://biquote.io"), "the CSP allows the new calendar host");
assert(!cspMeta.includes("faireconomy"), "the CSP no longer allows the blocked host");

const mappedEcon = ctx.mapEconEvents([
  { time: "2026-11-10T13:30:00Z", countryCode: "US", currency: "USD", name: "CPI m/m", importance: "high" },
  { time: "2026-11-09T10:00:00Z", countryCode: "GB", currency: "GBP", name: "BoE Speech", importance: "medium" },
  { time: "2026-11-09T08:00:00Z", countryCode: "SG", currency: "SGD", name: "Holiday", importance: "none" },
  { time: "2026-11-09T09:00:00Z", countryCode: "JP", currency: "JPY", name: "Low tier", importance: "low" },
  null,
  { time: "not-a-date", countryCode: "EU", currency: "EUR", name: "Mystery", importance: "high" },
]);
assert(mappedEcon.length === 3, "low/none events are dropped, got " + mappedEcon.length);
assert(mappedEcon[0].name === "BoE Speech" && mappedEcon[1].name === "CPI m/m", "events are sorted by absolute time");
assert(mappedEcon[0].impact === "med" && mappedEcon[1].impact === "high", "importance maps to the dashboard's high/med scale");
assert(mappedEcon[0].time === "10:00" && mappedEcon[1].time === "13:30", "UTC clock times are formatted as HH:MM");
assert(mappedEcon[2].time === "TBD" && Number.isNaN(mappedEcon[2].at), "an unparseable time falls back to TBD");
assert(ctx.mapEconEvents("nope").length === 0 && ctx.mapEconEvents(null).length === 0, "non-array payloads map to no events");

// The static fallback must not disappear late in the UTC day.
vm.runInContext("econEvents = [];", ctx);
const fallbackHtml = ctx.renderEconCalendar();
assert(fallbackHtml.includes("Economic Calendar") && fallbackHtml.includes("Fallback data."), "the fallback calendar stays visible at any hour");

// Live rows are filtered by absolute time, not just clock time.
vm.runInContext("econEvents = [ {time:'x',at:Date.now()-7200000,country:'US',name:'Past Event',impact:'high',currency:'USD'}, {time:'y',at:Date.now()+3600000,country:'US',name:'Future Event',impact:'med',currency:'USD'}, {time:'z',at:Date.now()+2*86400000,country:'EU',name:'Later Event',impact:'high',currency:'EUR'} ];", ctx);
const liveHtml = ctx.renderEconCalendar();
assert(!liveHtml.includes("Past Event"), "a live event more than an hour in the past is dropped");
assert(liveHtml.includes("Future Event") && liveHtml.includes("Later Event"), "live events later in the week are kept even when their clock time is earlier");
assert(liveHtml.includes("live") && liveHtml.includes("Data from Biquote."), "live rows are labelled with the CORS-enabled source");
vm.runInContext("econEvents = [];", ctx);

console.log("--- M39: signal history badge counts lifetime signals ---");

const totalGenerated = () => vm.runInContext("autoScan.totalGenerated", ctx);
const retainedRows = () => vm.runInContext("autoScan.history.length", ctx);
vm.runInContext("autoScan.history = []; autoScan.totalGenerated = 0; autoScan.maxEntries = 2;", ctx);
assert(totalGenerated() === 0, "the lifetime counter starts at zero");
assert(ctx.addSignalToHistory("EUR/USD", { direction: "BUY", confidence: 70 }) === true, "a fresh BUY is recorded");
assert(totalGenerated() === 1, "the first signal increments the lifetime counter");
assert(ctx.addSignalToHistory("EUR/USD", { direction: "BUY", confidence: 71 }) === false, "a refresh of the same pending setup is not a new signal");
assert(totalGenerated() === 1, "a refreshed setup leaves the lifetime counter alone");
assert(ctx.addSignalToHistory("GBP/USD", { direction: "SELL", confidence: 60 }) === true, "a second pair adds a new signal");
assert(totalGenerated() === 2, "the lifetime counter tracks the second signal");
assert(ctx.addSignalToHistory("USD/JPY", { direction: "BUY", confidence: 65 }) === true, "a third pair adds another signal");
assert(totalGenerated() === 3, "the lifetime counter keeps rising past the retained cap");
assert(retainedRows() === 2, "the retained log is still capped at maxEntries, got " + retainedRows());
assert(ls.get("signalHistoryTotal") === "3", "the lifetime counter is persisted, got " + ls.get("signalHistoryTotal"));

vm.runInContext("autoScan.totalGenerated = 0; autoScan.history = []; loadHistory();", ctx);
assert(totalGenerated() === 3, "loadHistory restores the persisted lifetime counter, got " + totalGenerated());
assert(retainedRows() === 2, "loadHistory restores the retained rows");

// Older installs have no counter key: seed it from what was retained.
ls.delete("signalHistoryTotal");
vm.runInContext("autoScan.totalGenerated = 0; autoScan.history = []; loadHistory();", ctx);
assert(totalGenerated() === 2, "a missing counter is seeded from the retained log, got " + totalGenerated());

let clearThrew = null;
try { vm.runInContext("autoScan.maxEntries = 50; clearSignalHistory();", ctx); } catch (e) { clearThrew = e && e.message; }
assert(clearThrew === null, "clearSignalHistory does not throw, got: " + clearThrew);
assert(totalGenerated() === 0 && retainedRows() === 0, "clearing history resets both the log and the lifetime counter");
assert(html.includes("${autoScan.totalGenerated}") && html.includes('title="${autoScan.history.length} in log"'), "the badge renders the lifetime total and keeps the retained count in its tooltip");

console.log("--- M40: unsupported tickers and currencies never hit the network ---");

// Defaults must not contain pairs that map to a dead exchange book.
const defaults = vm.runInContext("allScanPairs.slice()", ctx);
assert(!defaults.includes("BTC/ETH"), "the default universe no longer contains BTC/ETH (BTCETH is not a Binance symbol)");
assert(vm.runInContext("binanceFiat.has('NZD')", ctx) === false, "NZD is no longer treated as a Binance fiat book");
assert(vm.runInContext("binanceFiat.has('EUR') && binanceFiat.has('GBP') && binanceFiat.has('AUD')", ctx), "the real Binance fiat books are still enabled");
const badDefaults = defaults.filter((p) => {
  const [b, q] = p.split("/");
  return vm.runInContext(`nonFiat.has(${JSON.stringify(b)})`, ctx) && q !== "USD";
});
assert(badDefaults.length === 0, "no default crypto cross builds an invalid Binance symbol, got " + badDefaults.join(","));
assert(vm.runInContext("frankfurterCurrencies.has('USD') && !frankfurterCurrencies.has('BGN')", ctx), "the Frankfurter allowlist excludes BGN");

// NZD/USD must skip Binance and use the Frankfurter daily rate.
vm.runInContext("fxApiPrefs.enabled = false; fxApiPrefs.key = ''; fxUsdLegCache.clear(); clearMarketCache();", ctx);
const liveCalls = [];
ctx.fetch = (url) => {
  const u = String(url);
  liveCalls.push(u);
  if (u.includes("frankfurter.dev/v1/latest")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ base: "NZD", rates: { USD: 0.6 } }) });
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};
const nzdUsd = await ctx.fetchLivePrice("NZD", "USD");
assert(nzdUsd && nzdUsd.price === 0.6, "NZD/USD resolves through Frankfurter, got " + (nzdUsd && nzdUsd.price));
assert(!liveCalls.some((u) => u.includes("NZDUSDT")), "NZD/USD never requests the missing Binance book");

// BGN is no longer published by Frankfurter, so it must use currency-api.
vm.runInContext("clearMarketCache();", ctx);
const bgnCalls = [];
ctx.fetch = (url) => {
  const u = String(url);
  bgnCalls.push(u);
  if (u.includes("jsdelivr") && u.includes("/bgn.")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ bgn: { usd: 0.55 } }) });
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};
const bgnUsd = await ctx.fetchLivePrice("BGN", "USD");
assert(bgnUsd && bgnUsd.price === 0.55, "BGN/USD resolves through currency-api, got " + (bgnUsd && bgnUsd.price));
assert(!bgnCalls.some((u) => u.includes("from=BGN")), "BGN never requests the unsupported Frankfurter endpoint");

// Fiat FX pairs must never reach the crypto-only Coinbase fallback: Coinbase has
// no EURUSDT-USD product, so that request always 404s.
vm.runInContext("clearMarketCache();", ctx);
const fiatCalls = [];
ctx.fetch = (url) => {
  const u = String(url);
  fiatCalls.push(u);
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};
try { await ctx.fetchBinanceRows("EUR", "USD", "1h", 120); } catch {}
assert(fiatCalls.some((u) => u.includes("binance.com")), "EUR/USD still tries the Binance USDT leg first");
assert(!fiatCalls.some((u) => u.includes("coinbase.com")), "EUR/USD never requests the non-existent Coinbase EURUSDT-USD product");

// The 15s overview poll must not fire the three noisy requests.
vm.runInContext("clearMarketCache();", ctx);
const overviewCalls = [];
ctx.fetch = (url) => {
  const u = String(url);
  overviewCalls.push(u);
  if (u.includes("binance")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ lastPrice: "1.23", priceChangePercent: "0.5" }) });
  if (u.includes("frankfurter")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ base: "NZD", rates: { USD: 0.6 } }) });
  if (u.includes("jsdelivr") && u.includes("/usd.")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ usd: { bgn: 1.8 } }) });
  if (u.includes("jsdelivr")) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};
vm.runInContext(
  `scanPairs = ["BTC/USD","BTC/ETH","NZD/USD","USD/BGN","EUR/USD"]; multiScan.results = {}; for (const p of scanPairs) multiScan.results[p] = { pair: p, direction: "WAIT", confidence: 0, price: null, change: null };`,
  ctx
);
await ctx.updateOverviewPrices();
assert(!overviewCalls.some((u) => u.includes("symbol=BTCETH")), "the overview poll never requests the invalid BTCETH book");
assert(!overviewCalls.some((u) => u.includes("symbol=NZDUSDT")), "the overview poll never requests the missing NZDUSDT book");
assert(!overviewCalls.some((u) => u.includes("from=BGN")), "the overview poll never requests from=BGN");
assert(overviewCalls.some((u) => u.includes("jsdelivr")), "BGN legs are routed through currency-api");
assert(vm.runInContext("multiScan.results['USD/BGN'].price", ctx) === 1.8, "USD/BGN gets a currency-api price");
assert(vm.runInContext("multiScan.results['NZD/USD'].price", ctx) === 0.6, "NZD/USD gets a Frankfurter price in the overview");
assert(vm.runInContext("multiScan.results['BTC/ETH'].price", ctx) == null, "BTC/ETH is not fetched from an invalid exchange book");

// Daily history must fail fast for currencies Frankfurter dropped.
vm.runInContext("clearMarketCache();", ctx);
const historyCalls = [];
ctx.fetch = (url) => { historyCalls.push(String(url)); return Promise.resolve({ ok: false, status: 404, json: async () => ({}) }); };
let historyErr = null;
try { await ctx.fetchFxRows("BGN", "USD"); } catch (e) { historyErr = e && e.message; }
assert(historyErr && historyErr.includes("BGN/USD"), "BGN history fails with a readable message, got: " + historyErr);
assert(historyCalls.length === 0, "BGN history makes no known-failing request, got " + historyCalls.length);

console.log("--- M41: theme palette lives in CSS variables ---");

const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
assert(/:root\{[\s\S]*--bg:/.test(styleBlock), "the dark palette is declared as :root CSS variables");
assert(/\[data-theme="light"\]\{[\s\S]*--bg:/.test(styleBlock), "the light theme overrides the same variables");
for (const token of ["--bg", "--panel", "--border", "--text", "--muted", "--buy", "--sell"]) {
  assert(styleBlock.includes(token + ":"), "the palette defines " + token);
}
const inlineStyles = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
const rawColorStyles = inlineStyles.filter((s) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(s));
assert(rawColorStyles.length === 0, "inline styles use palette variables instead of raw colors, got: " + rawColorStyles.slice(0, 3).join(" | "));
assert(!/\[data-theme="light"\]\s+body/.test(styleBlock), "the light theme no longer needs per-component color overrides");
assert(/background:var\(--bg\)/.test(styleBlock) && /color:var\(--text\)/.test(styleBlock), "body paints through the palette variables");

ls.set("theme", "light");
vm.runInContext("loadTheme();", ctx);
assert(vm.runInContext("darkTheme", ctx) === false, "loadTheme restores the light preference");
ls.set("theme", "dark");
vm.runInContext("loadTheme();", ctx);
assert(vm.runInContext("darkTheme", ctx) === true, "loadTheme restores the dark preference");

const themed = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
const realDocEl = ctx.document.documentElement;
ctx.document.documentElement = themed;
vm.runInContext("darkTheme = true; applyTheme();", ctx);
assert(!("data-theme" in themed.attrs), "applyTheme clears the light attribute in dark mode");
vm.runInContext("darkTheme = false; applyTheme();", ctx);
assert(themed.attrs["data-theme"] === "light", "applyTheme sets data-theme=light in light mode");
ctx.document.documentElement = realDocEl;

console.log("--- M42: accessibility semantics, motion and touch targets ---");

// Screen-reader utility + focus rings cover all interactive controls.
assert(/\.sr-only\{[^}]*clip:rect\(0,0,0,0\)/.test(styleBlock), "a screen-reader-only utility exists");
assert(/textarea:focus-visible/.test(styleBlock), "textareas get the focus ring");
assert(/a\[href\]:focus-visible/.test(styleBlock), "links get the focus ring");
assert(/\.toggle input:focus-visible~\.toggle-track\{[^}]*outline:2px solid var\(--accent\)/.test(styleBlock), "keyboard focus is visible on switch toggles");
assert(!/\.toggle input\{display:none\}/.test(styleBlock), "switch inputs stay in the tab order");

// Reduced motion is respected.
assert(/@media \(prefers-reduced-motion: reduce\)\{[\s\S]*transition-duration:\.01ms !important/.test(styleBlock), "transitions collapse for reduced-motion users");
assert(/\.toggle-track,\.toggle-knob,\.heatmap-cell\{transition:none !important\}/.test(styleBlock), "the animated controls also stop under reduced motion");

// Touch targets grow on small screens.
assert(/@media \(max-width:768px\)\{[\s\S]*\.icon-button\{min-width:44px;min-height:44px\}/.test(styleBlock), "icon buttons reach 44px on mobile");
assert(/@media \(max-width:768px\)\{[\s\S]*\.tf-btn\{min-width:44px;min-height:44px\}/.test(styleBlock), "timeframe buttons reach 44px on mobile");
assert(/@media \(max-width:768px\)\{[\s\S]*\.toggle\{width:44px;height:24px\}/.test(styleBlock), "switch toggles grow to 44px on mobile");

// Toasts announce politely for success and urgently for warnings.
const toastEl = { style: {}, attrs: {}, textContent: "", setAttribute(k, v) { this.attrs[k] = v; } };
const realCreate = ctx.document.createElement;
const realGetById = ctx.document.getElementById;
ctx.document.createElement = () => toastEl;
ctx.document.getElementById = () => null;
ctx.showToast("Saved", "ok");
assert(toastEl.attrs.role === "status" && toastEl.attrs["aria-live"] === "polite", "success toasts are polite status messages");
assert(toastEl.attrs["aria-atomic"] === "true", "toasts are announced as a whole");
ctx.showToast("Blocked", "warn");
assert(toastEl.attrs.role === "alert" && toastEl.attrs["aria-live"] === "assertive", "warning toasts are assertive alerts");
assert(!/\bwindow\.showToast\b/.test(js), "toast calls do not depend on a window global that the bundled IIFE hides");
ctx.document.createElement = realCreate;
ctx.document.getElementById = realGetById;

// The canvas has a text alternative and its summary tracks the data.
assert(/<canvas id="priceChart" role="img" aria-labelledby="chartSummary"><\/canvas>/.test(html), "the price canvas is exposed as an image with a labelledby target");
assert(/<p id="chartSummary" class="sr-only">/.test(html), "the chart has a screen-reader text summary");
const a11yChartRows = [
  { date: "2026-01-01", open: 1.1, high: 1.2, low: 1.0, close: 1.1 },
  { date: "2026-01-02", open: 1.2, high: 1.3, low: 1.1, close: 1.2 },
  { date: "2026-01-03", open: 1.3, high: 1.4, low: 1.2, close: 1.32 },
];
const upSummary = ctx.chartSummary(a11yChartRows, "EUR/USD", "1h");
assert(upSummary.includes("EUR/USD 1h") && upSummary.includes("3 candles"), "the chart summary names the pair, timeframe and candle count, got: " + upSummary);
assert(upSummary.includes("up 20.00%"), "the chart summary reports the period change, got: " + upSummary);
assert(upSummary.includes("High") && upSummary.includes("low"), "the chart summary reports the high/low range");
const downSummary = ctx.chartSummary([{ date: "a", open: 2, high: 2.1, low: 1.9, close: 2 }, { date: "b", open: 2, high: 2.1, low: 1.5, close: 1.8 }], "XAU/USD", "1D");
assert(downSummary.includes("down 10.00%"), "the chart summary reports a falling period, got: " + downSummary);
assert(ctx.chartSummary([], "EUR/USD", "1h").includes("no data available"), "an empty chart gets an explicit summary");

console.log("--- M43: storage failures surface instead of disappearing ---");
const storageToasts = [];
const realShowToast = ctx.showToast;
const realSetItem = ctx.localStorage.setItem;
ctx.showToast = (message, type) => storageToasts.push({ message, type });
ctx.localStorage.setItem = () => {
  const error = new Error("quota");
  error.name = "QuotaExceededError";
  throw error;
};
assert(ctx.storageSet("m43", "value") === false, "a failed storage write reports false");
assert(storageToasts.length === 1 && storageToasts[0].type === "error", "a failed storage write shows one error toast");
assert(/storage/i.test(storageToasts[0].message), "the storage toast explains the failure");
assert(ctx.storageSet("m43b", "value") === false, "later failed writes still report false");
assert(storageToasts.length === 1, "the storage warning is shown only once per session");
ctx.localStorage.setItem = realSetItem;
ctx.showToast = realShowToast;
assert(ctx.storageSet("m43", "value") === true, "a successful write reports true");

console.log("--- M44: installable PWA manifest, icons and document links ---");
const webManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
assert(webManifest.id === "./", "the manifest has a stable relative id");
assert(webManifest.start_url === "./" && webManifest.scope === "./", "the manifest start_url and scope stay relative to the deploy path");
assert(webManifest.display === "standalone", "the manifest requests a standalone window");
assert(webManifest.theme_color === "#0b1117" && webManifest.background_color === "#0b1117", "the manifest colours match the dashboard shell");
const webIcons = Array.isArray(webManifest.icons) ? webManifest.icons : [];
const iconFor = (sizes, purpose) => webIcons.find((icon) => icon.sizes === sizes && String(icon.purpose || "any").split(/\s+/).includes(purpose));
const pngDimensions = (file) => {
  const buffer = fs.readFileSync(path.join(ROOT, file));
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return buffer.readUInt32BE(16) + "x" + buffer.readUInt32BE(20);
};
for (const [sizes, purpose] of [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]]) {
  const icon = iconFor(sizes, purpose);
  assert(icon && icon.type === "image/png", "the manifest lists a " + sizes + " " + purpose + " PNG icon");
  assert(icon && pngDimensions(icon.src) === sizes, "the " + sizes + " " + purpose + " icon file is a real PNG of that size");
}
assert(pngDimensions("icons/apple-touch-icon.png") === "180x180", "the Apple touch icon is a 180x180 PNG");
assert(webIcons.some((icon) => icon.type === "image/svg+xml"), "the scalable SVG icon is still offered");
assert(html.includes('<link rel="apple-touch-icon" href="icons/apple-touch-icon.png" sizes="180x180">'), "index.html links the Apple touch icon");
assert(/<link rel="manifest" href="manifest\.json">/.test(html), "index.html links the manifest");
const generatedSw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
for (const asset of ["./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"]) {
  assert(generatedSw.includes(JSON.stringify(asset)), "the service worker precaches " + asset);
}

console.log("--- M45: a waiting worker offers a reload prompt ---");
assert(typeof ctx.setupServiceWorker === "function" && typeof ctx.bindServiceWorker === "function", "the PWA module exposes its service-worker wiring");
assert(js.includes("setupServiceWorker(navigator, window)"), "the app registers the service worker through the PWA module");
const installBlock = generatedSw.match(/addEventListener\("install"[\s\S]*?\n\}\);/);
assert(installBlock && !/skipWaiting\(\)/.test(installBlock[0]), "install no longer swaps the app out mid-session");
assert(/addEventListener\("message"[\s\S]*?SKIP_WAITING[\s\S]*?skipWaiting\(\)/.test(generatedSw), "the worker honours SKIP_WAITING when the visitor accepts an update");

const appendedEls = [];
const realPwaCreateElement = ctx.document.createElement;
const realBodyAppend = ctx.document.body.appendChild;
ctx.document.createElement = (tag) => {
  const el = {
    tag,
    style: {},
    attrs: {},
    children: [],
    listeners: {},
    textContent: "",
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
    appendChild(child) { this.children.push(child); },
  };
  return el;
};
ctx.document.body.appendChild = (el) => appendedEls.push(el);

const swEvents = {};
const serviceWorker = {
  controller: null,
  addEventListener(name, fn) { swEvents[name] = fn; },
  register: () => Promise.resolve(null),
};
let reloads = 0;
const win = { location: { reload: () => { reloads += 1; } } };
let registrationListeners = {};
const firstWorker = { state: "installing", addEventListener(name, fn) { this.statechange = fn; } };
const firstRegistration = {
  waiting: null,
  installing: firstWorker,
  addEventListener(name, fn) { registrationListeners[name] = fn; },
};
ctx.setupServiceWorker({ serviceWorker }, win);
ctx.bindServiceWorker(firstRegistration, serviceWorker, win);
registrationListeners.updatefound();
firstWorker.state = "installed";
firstWorker.statechange();
assert(appendedEls.length === 0, "the first install shows no update prompt");

serviceWorker.controller = {};
let waitingMessage = null;
const waitingWorker = { postMessage: (message) => { waitingMessage = message; } };
const updateWorker = { state: "installing", addEventListener(name, fn) { this.statechange = fn; } };
const updateRegistration = {
  waiting: null,
  installing: updateWorker,
  addEventListener(name, fn) { registrationListeners[name] = fn; },
};
ctx.bindServiceWorker(updateRegistration, serviceWorker, win);
assert(appendedEls.length === 0, "a new worker does not prompt before it finishes installing");
registrationListeners.updatefound();
updateWorker.state = "installed";
updateWorker.statechange();
assert(appendedEls.length === 1, "an installed update with a controller shows one prompt");
const promptEl = appendedEls[0];
assert(promptEl.id === "update-toast" && promptEl.attrs.role === "status" && promptEl.attrs["aria-live"] === "polite", "the update prompt is a polite status message");
const promptText = promptEl.children[0];
const promptButton = promptEl.children[1];
assert(promptText.textContent === "A new version is available.", "the prompt explains that a new version exists");
assert(promptButton.tag === "button" && promptButton.type === "button" && promptButton.textContent === "Reload", "the prompt offers an explicit Reload button");
updateRegistration.waiting = waitingWorker;
promptButton.listeners.click[0]();
assert(waitingMessage && waitingMessage.type === "SKIP_WAITING", "Reload asks the waiting worker to activate");
assert(reloads === 0, "the page waits for the new worker before reloading");
swEvents.controllerchange();
assert(reloads === 1, "controllerchange reloads the page once");
ctx.document.createElement = realPwaCreateElement;
ctx.document.body.appendChild = realBodyAppend;

console.log("");
console.log("dashboard.test.js  PASS:", pass, " FAIL:", fail);
process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("FAIL: unhandled error", e && e.message); process.exit(1); });
