import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

const ORIGIN = "http://127.0.0.1:4173";

const INTERVAL_MS = {
  "1m": 60_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

// Deterministic Binance-shaped candles: enough history for the backtest and a
// gently oscillating price so the analyser produces real signals.
function makeKlines(limit, interval) {
  const step = INTERVAL_MS[interval] || INTERVAL_MS["1d"];
  const now = Date.now();
  const rows = [];
  let price = 1.08;
  for (let i = limit - 1; i >= 0; i--) {
    const open = price;
    const close = Math.max(0.5, open + Math.sin(i / 17) * 0.0015 + Math.cos(i / 7) * 0.0008);
    const high = Math.max(open, close) + 0.0006;
    const low = Math.min(open, close) - 0.0006;
    const time = now - i * step;
    rows.push([time, open.toFixed(5), high.toFixed(5), low.toFixed(5), close.toFixed(5), "1000"]);
    price = close;
  }
  return rows;
}

// Keep the smoke test deterministic and offline: local files are served,
// Binance candles are synthesized, and every other third-party request is
// aborted so the run never depends on a provider's uptime or rate limit.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN) return route.continue();

    const cors = { "access-control-allow-origin": "*" };
    if (url.hostname === "api.binance.com" && url.pathname === "/api/v3/klines") {
      const limit = Number(url.searchParams.get("limit") || 500);
      return route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify(makeKlines(limit, url.searchParams.get("interval"))),
      });
    }
    if (url.hostname === "api.binance.com" && url.pathname === "/api/v3/ticker/24hr") {
      return route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({ lastPrice: "1.08000", priceChangePercent: "0.12" }),
      });
    }
    return route.abort();
  });
});

test("loads, renders, and survives the core interactions", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page).toHaveTitle(/Trading Ideas/);
  await expect(page.locator("#root section").first()).toBeVisible();

  // Timeframe switching must re-render without losing the selected state.
  await page.locator(".tf-btn", { hasText: "1h" }).click();
  await expect(page.locator(".tf-btn.active")).toHaveText("1h");

  // Theme toggle updates the document theme and its accessible label.
  const themeToggle = page.locator("#themeToggle");
  const labelBefore = await themeToggle.getAttribute("aria-label");
  await themeToggle.click();
  await expect(themeToggle).not.toHaveAttribute("aria-label", labelBefore ?? "");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^(light|dark)$/);

  // Overlay buttons keep aria-pressed in sync with their state.
  const ichimoku = page.locator('button[data-overlay="ichimoku"]');
  await expect(ichimoku).toHaveAttribute("aria-pressed", "false");
  await ichimoku.click();
  await expect(page.locator('button[data-overlay="ichimoku"]')).toHaveAttribute("aria-pressed", "true");

  // Backtest runs through the analysis and render paths end to end.
  await page.locator("#runBacktest").click();
  await expect(page.locator("#backtestBody")).toContainText("Win Rate", { timeout: 60_000 });

  // Export produces a complete JSON backup.
  await page.locator("#settingsToggle").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportData").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("trading_dashboard_backup.json");
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(Array.isArray(backup.history)).toBe(true);
  expect(Array.isArray(backup.positions)).toBe(true);

  // Import accepts a valid backup and refreshes the visible lifetime count.
  await page.locator("#importFile").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ totalGenerated: 4321, history: [], positions: [] })),
  });
  await expect(page.locator('.history-count[title$="in log"]')).toHaveText("4321");

  expect(pageErrors).toEqual([]);
});
