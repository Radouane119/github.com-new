# Trading Signal Dashboard

A browser-based dashboard for reviewing forex, crypto, and gold trading ideas. It runs entirely in the browser and stores its settings and paper-trading data locally.

## Run locally

Open `index.html` in a modern browser. For the service worker and offline mode, serve the folder over HTTP (for example, with the VS Code Live Server extension or any static web server).

## Development checks

No install or build step is required; the checks run on plain Node.js 20+.

```sh
node scripts/verify-html.mjs   # inline script parses, CSP hash is current, no inline handlers
node test/dashboard.test.js    # 290+ regression tests
node scripts/sync-csp.mjs      # recompute the CSP hash after editing the inline script
```

Run `verify-html` and `sync-csp` after any change to the inline script: the Content-Security-Policy in `index.html` allows that script by SHA-256 hash, and a stale hash blocks the whole app. Both are wired into `npm run check`, and CI gates deployment on them.

## Important notes

- Market data comes from public third-party endpoints. When live data cannot be reached, the app labels its generated fallback data clearly; it must not be used for trading decisions.
- Webhook URLs, settings, and paper-trading records are saved only in that browser's local storage. Nothing is uploaded to a server owned by this project.
- Imported backups and stored data are treated as untrusted: pairs, prices, dates, and counts are validated, and all rendered text is escaped before it reaches the page.
- Webhooks are restricted to `https` Discord and Telegram endpoints. Other URLs are rejected rather than contacted.
- Provider responses are cached in local storage (`mdc:v1:*`) with short TTLs, so repeated scans and reloads reuse recent candles and tickers. **Settings → Clear market cache** forces a fresh download; this cache contains only public market data.
- Full re-renders preserve the focused field, caret position, page scroll, panel scroll, open sections, and the Settings panel. Trade notes are saved on a short debounce and flushed when the field loses focus or the tab closes.
- Rendering patches the top-level regions whose markup actually changed, and an idle render neither replaces the chart canvas nor repaints it. Indicator analysis is memoized per row array + strategy config, so repeated renders reuse the same result.
- Dark and light themes share one stylesheet: the palette is declared as CSS variables under `:root`, and the light theme only overrides those variables. The choice is saved in local storage and can be toggled with the moon/sun button or the `T` key.
- Accessibility: every control has a visible keyboard focus ring, switch toggles stay in the tab order, and the theme/sound buttons announce their state. Toasts are screen-reader live regions, the price chart has a text summary, and animations collapse when the system requests reduced motion. Both themes meet WCAG AA contrast, and touch targets grow to at least 44 px on small screens.
- The economic calendar reads a CORS-enabled public feed and falls back to clearly labelled sample rows when it is unreachable. The Signal History badge counts every signal ever generated, even after the retained list is capped at the most recent 50.
- Market scans skip requests that are known to fail: crypto books are only quoted in USD(T), and currencies Frankfurter no longer publishes (such as BGN) are converted through the currency-api fallback instead of logging 4xx errors.
- Export a backup from **Settings** before clearing browser data or moving to a new device.

## Publish to GitHub Pages

The included workflow runs the checks and tests, then deploys the dashboard after every push to `master`.

1. In the repository, open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Push to `master`; the workflow will publish the site automatically.

## Project structure

- `index.html` — application UI, styles, and client-side logic.
- `manifest.json` — progressive-web-app metadata.
- `sw.js` — offline asset caching.
- `icon.svg` — application icon.
