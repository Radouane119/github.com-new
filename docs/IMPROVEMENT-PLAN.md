# Trading Signal Dashboard — Improvement Plan

Status: Phases 0–3D, 4A–4E, 5.1, 5.3 and 5.4 implemented · Baseline: `9fbb8e3` · Tests: 390 pass / 0 fail

## Snapshot

| Metric | Value |
| --- | --- |
| `index.html` | 380 KB, 7,174 lines (generated) |
| Inline JS | 352 KB bundled from 13 files under `src/app/` |
| Inline CSS | 27 KB in `src/styles.css` |
| Inline `style=` attributes | 545 |
| `fetch()` call sites | 17 providers in 1 script |
| Inline event handlers | 0 |
| `innerHTML =` writes | 7 |
| Build step | `node build.mjs` (esbuild dev dependency; bundles `src/`, generates `index.html` + `sw.js`) |
| Service worker | `sw.js` with a cache name derived from `index.html` |
| CI | build-parity check + guardrails + lint + tests, gating deploy |
| Distribution | single file, works from `file://`, GitHub Pages |

## Principles

1. **Never ship a regression.** The 161-test suite must gate every phase.
2. **One phase at a time.** Each phase is independently releasable and reversible.
3. **Preserve the deployment model.** No server, no account, still opens from `file://` and GitHub Pages.
4. **Last thing first.** Architecture changes come after behavior, cache, and rendering are stable, because they touch everything.

---

## Phase 0 — Safety net (S · ~2 h) — DONE

**Goal:** make regressions impossible to deploy.

1. `.github/workflows/ci.yml` — on every push/PR: Node 20, `node test/dashboard.test.js`.
2. `deploy-pages.yml` — add a `test` job, make `deploy` depend on it (`needs: test`).
3. `package.json` scripts: `test`, `check` (syntax-check `sw.js` + run tests). Note: `npm` is blocked by the local PowerShell execution policy; `node test/dashboard.test.js` works.
4. `scripts/verify-html.mjs` — extract the inline script with the same regex the tests use, compile it with `vm.Script` (catches syntax errors without a DOM), assert the bootstrap marker exists.
5. Document the commands in `README.md`.

**Done when:** a deliberately failing test blocks deployment.

---

## Phase 1 — Safety hardening (M · ~1 day) — DONE

**Goal:** remove the XSS/data-exfiltration surface without changing behavior.

Implementation notes: kept the single-file layout, so item 6 uses a CSP `<meta>` with a SHA-256 hash of the inline script; `scripts/sync-csp.mjs` recomputes it and `scripts/verify-html.mjs` fails when it is stale. Item 7 was a terminal-encoding artifact, not a file defect — the emoji bytes were already correct.

1. Add `escapeHtml()` / `escapeAttr()` helpers.
2. Escape every user-controlled value interpolated into HTML. Highest priority:
   - `webhookUrl` (line 2740) and `strategyName` (line 2760) in `value="..."`.
   - Trade notes (line 2867) — currently only `<` is escaped.
   - **External API strings**, which are the real attack surface: economic-calendar titles/countries (`renderEconCalendar`, ~2682), provider error text, `state.source`, webhook responses.
3. Validate the webhook before save/test/send: `new URL()`, `https:` only, host allowlist (`discord.com`, `discordapp.com`, `api.telegram.org`). Prevents a malicious imported backup from exfiltrating localStorage.
4. Harden import (`importData`, ~3056–3165): whitelist keys, reject `__proto__`/`constructor`/`prototype`, cap array/string sizes, validate numeric fields.
5. Replace the 8 inline `onclick=` handlers with delegated `data-action` listeners. Required before a strict CSP.
6. Move the inline `<script>` to `app.js` (or keep inline and emit a build-time hash) and add a CSP `<meta>`:
   - `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`,
   - `connect-src` limited to the exact provider hosts already used (Binance/Bybit/Coinbase/Frankfurter/jsDelivr/Twelve Data/faireconomy/Discord/Telegram + WS origin),
   - `img-src 'self' data: blob:`, `style-src 'self' 'unsafe-inline'` (until Phase 4 removes inline styles).
7. Fix the mojibake webhook arrows (`"??" : "??"`, line 890) by using Unicode escapes.

**Done when:** tests cover escaping, webhook validation, and hostile-import rejection; CSP loads with zero console violations.

---

## Phase 2 — Data reliability & speed (L · ~2–3 days) — DONE

**Goal:** stop rate-limit failures and repeated network work.

Implementation notes: the cache lives in `index.html` next to the other helpers (`MARKET_CACHE_PREFIX`, `cachedJson` / `httpJson`, `marketCache*`, `providerBreakers`). It keeps 120 entries / ~2.4 M characters (below the 5 MB localStorage quota, which browsers count in UTF-16), defaults to one attempt so the existing Binance → Bybit → Coinbase chain still handles transient failures, and exposes `retries` for callers that want in-layer retry. Tickers are cached for 20 s instead of 10 s to leave headroom. Webhook POSTs and the credit-gated Twelve Data request are intentionally outside the cache. The scan token invalidates stale results when the timeframe changes. Tests: M35 covers cache hits, in-flight dedupe, TTL expiry, reload persistence, stale-if-error, the breaker, `tdGate` persistence, cached candles and scan cancellation.

Current issues (baseline):
- 17 independent `fetch` calls, no shared cache, no request dedupe.
- Twelve Data budget (`tdGate`, line 1564) lives only in memory — a page reload resets the 760/day counter and can exceed the provider quota.
- `setInterval(updateOverviewPrices, 10000)` (line 5053) re-hits providers every 10 s per tab, regardless of use.
- Scan-all re-fetches candle series that were just used for the chart.

Changes:
1. `httpJson(url, { ttl, key, provider, signal, retries })` helper:
   - in-memory `Map` + `localStorage` persistence (`mdc:v1:`), versioned;
   - in-flight promise dedupe for identical URLs;
   - LRU cap (~200 entries / ~4 MB) so the 5 MB quota is never hit;
   - stale-while-revalidate; return `{ data, fetchedAt, stale }`.
2. TTL policy: tickers 10 s, intraday candles 60 s, daily candles 30 min, FX daily 6 h, econ calendar 6 h, correlation 1 h.
3. Route all 17 fetch sites through it, with jittered retry on 429/5xx and a per-provider circuit breaker (3 failures → 60 s open, serve stale).
4. Persist `tdGate` and `fxApiStatus` to localStorage keyed by UTC date; expose "resets at 00:00 UTC".
5. Cache candles by `base/quote/timeframe/limit`; abort in-flight scans when the pair/timeframe changes; cap scan concurrency.
6. Settings: cache size/entries, "Clear market cache", and a "cached 42 s ago" indicator next to the source line.

**Done when:** two identical calls inside a TTL = one network request (tested), quota survives reload (tested), scan-all makes no duplicate requests.

---

## Phase 3 — Rendering that keeps user state (L · ~3 days)

**Goal:** stop a 10-second refresh cycle from destroying focus, scroll, and typed text.

Implementation notes (3A, done): `captureUiState()` / `restoreUiState()` wrap the full `render()` — they keep the focused input/textarea, caret selection, `window.scrollY`, every panel's `scrollTop`, `.open` sections, and an open Settings panel. Trade notes now live in a small in-memory cache, are written to `localStorage` on a 400 ms debounce, and are flushed on blur/`pagehide`/hidden tab, so a render can never drop a draft. Input-driven renders (`rm*`, `strat*`, `paperBalance`) go through `scheduleRender()`. The 60 s timer now calls `refreshSessionBar()` and patches only that node instead of rebuilding the page. Tests: M36.

Implementation notes (3B, done): `renderIntoRoot()` parses the generated markup into a `<template>` and patches the top-level `<main>` children instead of replacing the whole document. Each region is keyed by tag/id/classes plus its sibling position, and is reused verbatim when its generated HTML is unchanged — so the chart canvas, open panels and screenshot state survive a render. `analyze()` is memoized in a `WeakMap` keyed by the `state.rows` array, config, `macdHistVote`, demo mode and the ML model signature; `trackSignal` calls always bypass it because they mutate `lastSignals`. `drawChart()` is memoized per canvas by pair, timeframe, row shape, last candle, overlay flags, size and DPR, so an idle render does not repaint the canvas. Tests: M37.

Post-3B maintenance (done): the economic calendar now reads the CORS-enabled Biquote feed — the old ForexFactory mirror never sent `Access-Control-Allow-Origin`, so browser fetches were always blocked. Live rows are mapped/sorted by absolute UTC time, the panel refreshes once they arrive, and the sample rows stay visible at any hour. The Signal History badge now shows a persisted lifetime total (`signalHistoryTotal`) instead of the retained-row count, so it keeps counting past the 50-row cap. Tests: M38–M39.

Post-3B maintenance (done): market scans no longer request dead endpoints. The default universe drops `BTC/ETH` (Binance builds the invalid symbol `BTCETH`), Binance fiat books are limited to EUR/GBP/AUD (NZD has no `NZDUSDT` market), and BGN is routed around Frankfurter (which stopped publishing it when Bulgaria adopted the euro) to the currency-api fallback. The 15 s overview poll now batches supported legs through Frankfurter and everything else through currency-api, and daily history fails fast for unsupported currencies instead of logging a 4xx. Tests: M40.

Implementation notes (3C, done): the palette now lives in `:root` as semantic CSS variables (`--bg`, `--panel`, `--border`, `--text`, `--muted*`, `--buy*`, `--sell*`, `--wait*`, `--accent*`, `--warn*`, `--gold*`, `--on-accent`, `--neutral-soft`, `--sheen`). A single `[data-theme="light"]` block overrides those variables, replacing the 16 per-component light rules. Every palette literal in the `<style>` block and in the 545 inline `style="..."` attributes was replaced with `var(--token)`, so dark and light now share one component stylesheet. JS values that are concatenated with an alpha suffix or passed to canvas APIs (`volColor`, `corrColor`, chart paints) stay hex by design. Tests: M41.

Implementation notes (3D, done): every interactive control now has a visible `:focus-visible` ring (including links, textareas and switch tracks), and switch inputs stay in the tab order instead of being `display:none`. Toasts are live regions — `status`/`polite` for confirmations and `alert`/`assertive` for warnings — and never intercept clicks. The price canvas is exposed as `role="img"` with an `aria-labelledby` text summary that reports pair, timeframe, candle count, period change, last close and high/low. Toggles expose `aria-pressed`, and the theme/sound buttons update their accessible labels when clicked or toggled from the keyboard (`T`/`M`). `prefers-reduced-motion` collapses animations and transitions, and icon buttons, timeframe buttons, selects and switches grow to at least 44 px on small screens. Both palettes were retuned until every text/background pair met WCAG AA: light `--muted-3`/`--buy`/`--sell`/`--warn`/`--gold` and dark `--muted-2`/`--muted-3`/`--muted-4`/`--on-accent`, plus the session volatility badge, inactive session segments and loading overview cards. Tests: M42. Lighthouse accessibility is 1.0 in both themes.

Current issues (baseline):
- `render()` still regenerates the full markup string; only the DOM patching and canvas paint are skipped for unchanged regions.
- Region keys are positional, so inserting a conditional region can replace the siblings that follow it.

**Done when:** typing a trade note survives a minute tick; toggling an overlay preserves focus and scroll; only the chart repaints when the chart changes.

---

## Phase 4 — Maintainability: modules + build (L · ~4–5 days)

**Goal:** make the 301 KB script navigable without breaking `file://` or Pages.

Target layout:

```
src/
  main.js                 bootstrap
  state/store.js          state, localStorage schema + version, import/export
  data/providers.js       exchange/FX/econ providers
  data/http.js            cache, retry, circuit breaker
  core/indicators.js      ema, rsi, atr, adx, bollinger, ichimoku, obv, vwap, macd
  core/analysis.js        analyze(), scoring, pullback, trailing
  core/ml.js
  core/backtest.js        backtest, monte carlo, walk-forward, optimizer, correlation
  ui/render.js            shell + regions
  ui/chart.js             canvas rendering
  ui/events.js            delegated listeners
  ui/panels/*.js
```

Build with esbuild (`build.mjs`) into the existing single-file shape:
- inline bundle + CSS into `index.html`, so `file://` still works;
- emit `sw.js` with a content-hash cache name and the real asset list (no more manual `signals-v3` bump);
- emit the CSP script hash if the script stays inline.

Tests migrate from regex/`vm` extraction to direct module imports, keeping the current 161 assertions as the parity baseline. CI adds `node build.mjs --check` so committed output can't drift.

**Done when:** `node build.mjs` reproduces the shipped HTML byte-for-byte, all tests pass against modules, and the site still opens from `file://`.

**4A (done):** the page shell, stylesheet, and script now live in `src/index.template.html`, `src/styles.css`, and the JavaScript sources. The zero-dependency `build.mjs` inlines them, derives the CSP SHA-256 hash from the exact rendered script text, and writes `index.html` with LF endings (`.gitattributes` pins this on every platform). `node build.mjs --check` compares the generated output against the committed file and runs in both CI jobs before the guardrails and tests. The regenerated `index.html` is byte-identical to the previous release (`sha256-ryb+vk8wCqgJj4eUBi4i2nI02piVDKC29N2Gnf4PMVk=`), so this slice changes the source layout without changing the shipped app.

**4B (done):** `src/app.js` is split into twelve contiguous files under `src/app/` — universe, safety, cache, state, market, analysis, signals, render, backtest, scans, chart, and events. `src/app/manifest.json` fixes the concatenation order, and `build.mjs` joins the files verbatim, so the inline script and CSP hash are still byte-identical (`sha256-ryb+vk8wCqgJj4eUBi4i2nI02piVDKC29N2Gnf4PMVk=`) and the tests keep using the existing inline-script harness. Every slice parses on its own with `node --check`. The esbuild bundle and a full ESM migration remain for a later slice.

**4C (done):** the test suite no longer extracts the inline script from `index.html`. It reads `src/app/manifest.json`, concatenates the sources in the same order as the build, and runs them in the existing `vm` sandbox, so the 345 assertions now cover the sources directly. A new `scripts/verify-sources.mjs` guardrail checks that the manifest lists every `src/app/*.js` exactly once, that no listed file is missing or empty, and that each file parses as a standalone script. Both CI jobs run it, and `npm run check` includes it. `index.html` and the CSP hash are unchanged. The next slice can replace the concatenation with a real bundle without having to rewrite the tests at the same time.

**4D (done):** `build.mjs` now feeds the manifest sources to esbuild (`buildSync`, `bundle: true`, `format: "iife"`, `target: "es2020"`, `charset: "utf8"`, no minification) and inlines the returned script, so the shipped page is still one self-contained file that opens from `file://`. esbuild is pinned as the only dev dependency (`esbuild@0.28.2`, `package-lock.json` committed, `node_modules/` ignored), and both workflows run `npm ci` before the build check. This is the first slice whose output intentionally changes: the bundle adds the IIFE wrapper and esbuild's formatting, so `index.html` grows to 377 KB / 7,160 lines and the CSP hash becomes `sha256-DBnTdytC2JzBb4ouL/omm8ToX+M+1zr825giuuRJfQc=`. The runtime tests still read `src/app` and now stand at 348 pass / 0 fail. The bundler surfaced two latent bugs that the concatenated global script had hidden. First, a redundant `if (result === "pending") pnlPct = 0;` in `src/app/08-backtest.js` assigned to a `const`; it is removed, and `transformSync` alone did not catch it, so the build keeps the bundler path. Second, several `if (window.showToast)` guards silently skipped their toast once the IIFE stopped publishing the function globally; they now call `showToast` directly, and a test asserts no source depends on `window.showToast`. While smoke-testing the bundle, the live scan was also seen requesting the non-existent Coinbase `EURUSDT-USD` product for EUR/USD; the Coinbase fallback now runs only for crypto/gold bases (`nonFiat`), with a test asserting fiat FX never reaches it. The service-worker cache name and asset list are still manual, so the content-hash cache remains for a later slice.

**4E (done):** `sw.js` is now generated. `src/sw.template.js` holds the worker, and the build fills in a cache name derived from the committed `index.html` (`signals-<first 12 hex chars of its sha256>`) plus the precache list, after checking that every listed asset exists on disk. `node build.mjs` writes both artifacts, and `--check` fails if either drifts. A new `scripts/verify-sw.mjs` guardrail parses the generated worker, confirms the cache name matches `index.html`, confirms the four precached assets are present and real, and confirms the navigation path is still network-first with an offline fallback. Both workflows and `npm run check` run it. The manual `signals-v3` bump is gone; any app change now produces a new cache name and the old caches are deleted on activation.

---

## Phase 5 — Quality depth & polish (M · ongoing)

1. ESLint flat config (`no-undef`, `no-unused-vars`, `no-redeclare`) on `src/`; warnings first, then errors. **Done in 5.1.**
2. Playwright smoke test: load → wait for ready → switch timeframe → toggle theme/overlay → run backtest → export/import. Catches render crashes the `vm` harness cannot.
3. Surface storage failures: the ~20 `catch {}` blocks around `localStorage` silently discard data on quota errors. Toast on `QuotaExceededError`.
4. PWA polish: 192/512 PNG + maskable icons, `apple-touch-icon`, `id`/`scope`, and a "new version available" update prompt. (Screenshots are optional and still need real captures.)
5. README: architecture, dev commands, and an explicit privacy note (webhook URL and API key are readable by anything on the same origin).
6. Optional domain track: confidence calibration (predicted vs realized win rate), per-pair performance table, slippage realism, and a persistent "demo data" watermark on every panel while fallback data is active.

**5.1 (done):** ESLint now runs through a flat config (`eslint.config.mjs`) with `@eslint/js` and browser globals. Linting the split files individually would report every cross-file reference as undefined, so `scripts/lint-sources.mjs` concatenates `src/app` in manifest order and lints the result as one classic script through a virtual path; it maps each reported line back to its real source file. The generated `sw.js` is linted too. `no-undef` and `no-redeclare` are errors, and `no-unused-vars` starts as a warning (20 existing warnings are surfaced, not hidden). The pass found and fixed three real issues: a dead duplicate `scheduleRender` in `07-render.js` (the live copy is in `09-scans.js`), a duplicate `var pair` in the events handler, and two dead initial assignments. The script runs in `npm run check` and both workflows; `package.json` now requires Node 20.19+ for ESLint 10.

**5.3 (done):** every user-data write — settings, theme, positions, notes, alerts, watchlist, signal history, ML state — now goes through `storageSet` in `src/app/03-state.js`. It catches quota and blocked-storage failures, shows one error toast per session, and returns `false` so callers can react; previously the surrounding `catch {}` blocks discarded the change silently. Market-cache writes stay best-effort because that cache is disposable. Test M43 covers the failed write, the single warning, and the success path.

**5.4 (done):** the app is installable. `manifest.json` now declares a stable relative `id`, `scope`, `start_url`, `lang`, categories and display overrides, and lists 192/512 PNG icons plus a full-bleed 512 maskable icon and the scalable SVG. `scripts/make-icons.mjs` draws the four PNGs deterministically (4× supersampled, no image dependency), and `--check` fails when `icons/` drifts. The page links a 180 px `apple-touch-icon`, and the worker precaches every icon. Updates no longer call `skipWaiting()` during install: `src/app/11-pwa.js` binds `updatefound`/`statechange`, shows a polite "A new version is available" prompt with a Reload button, posts `SKIP_WAITING`, and reloads once on `controllerchange`. `scripts/verify-pwa.mjs` checks the manifest fields, real PNG dimensions, document links and precache list; tests M44/M45 cover the static surface and the prompt flow. Screenshots remain optional because they need real captures.

---

## Order and rationale

```
Phase 0  Safety net        ──►  Phase 1  Safety
                                      │
                                      ▼
                               Phase 2  Data/cache
                                      │
                                      ▼
                               Phase 3  Rendering
                                      │
                                      ▼
                               Phase 4  Modules/build
                                      │
                                      ▼
                               Phase 5  Polish
```

Modules come last deliberately: extracting files before cache/rendering behavior settles would force the same 300 KB diff through review twice. Phases 0–2 are low-risk and user-visible; Phase 3 is the biggest UX win; Phase 4 is the biggest long-term win and the only phase that changes how the app is built.

## Non-goals

- Framework rewrite (React/Svelte) — the app is small, offline-first, and build-free by design.
- TypeScript migration — high churn for a single-maintainer PWA.
- Any backend, account system, or real order execution — out of scope and a regulatory risk.
