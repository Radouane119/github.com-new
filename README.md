# Trading Signal Dashboard

A browser-based dashboard for reviewing forex, crypto, and gold trading ideas. It runs entirely in the browser and stores its settings and paper-trading data locally.

## Run locally

Open `index.html` in a modern browser. For the service worker and offline mode, serve the folder over HTTP (for example, with the VS Code Live Server extension or any static web server).

## Important notes

- Market data comes from public third-party endpoints. When live data cannot be reached, the app labels its generated fallback data clearly; it must not be used for trading decisions.
- Webhook URLs, settings, and paper-trading records are saved only in that browser's local storage.
- Export a backup from **Settings** before clearing browser data or moving to a new device.

## Publish to GitHub Pages

The included workflow deploys the dashboard after every push to `master`.

1. In the repository, open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Push to `master`; the workflow will publish the site automatically.

## Project structure

- `index.html` — application UI, styles, and client-side logic.
- `manifest.json` — progressive-web-app metadata.
- `sw.js` — offline asset caching.
- `icon.svg` — application icon.
