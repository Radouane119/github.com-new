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
const localStorageStub = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
};
const evt = () => ({ target: {}, preventDefault() {}, });
const ctx = {
  console,
  localStorage: localStorageStub,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, documentElement: { style: {}, setAttribute() {}, removeAttribute() {} }, body: { appendChild() {} }, createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} }) },
  window: { showToast: () => {}, addEventListener: () => {}, getComputedStyle: () => ({}) },
  navigator: { serviceWorker: { register: () => Promise.resolve() } },
  fetch: () => new Promise(() => {}),
  WebSocket: class { constructor() {} close() {} },
  AudioContext: class { createGain() { return { connect() {}, gain: { setValueAtTime() {} } }; } createOscillator() { return { connect() {}, frequency: { setValueAtTime() {} }, start() {} }; } },
  requestAnimationFrame: (fn) => 0,
  ResizeObserver: class { observe() {} disconnect() {} },
  setInterval: () => 0,
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

console.log("");
console.log("dashboard.test.js  PASS:", pass, " FAIL:", fail);
process.exit(fail > 0 ? 1 : 0);
