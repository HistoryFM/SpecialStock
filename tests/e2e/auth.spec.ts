import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/scans/status", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        due: false,
        slotKey: null,
        nextScanAt: null,
        marketOpen: false,
        automaticSymbols: [],
        enabledCount: 0,
        configuredCount: 20,
        runningScans: [],
        scanRevision: null,
      }),
    });
  });
});

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Shared password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("protects the application shell and supports the single-user session", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Shared password").fill("incorrect");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("The password was not recognized.")).toBeVisible();
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/api/models");
  await expect(page.locator("body")).toContainText("Unauthorized");
  await page.goto("/api/chart-artifacts/not-authorized/data");
  await expect(page.locator("body")).toContainText("Unauthorized");
});

test("runs the mocked Chart-Img to Gemini manual pipeline", async ({ page }) => {
  const expectedCompactCalls = process.env.SPECIALSTOCK_E2E_RETRY_ONCE === "1" ? 2 : 1;
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const timeframe = page.getByLabel("Manual timeframe for AAPL");
  await timeframe.selectOption("1m");
  const row = page.getByRole("row", { name: "Open AAPL analysis" });
  await row.getByRole("button", { name: "Run now" }).click();
  await expect(row.locator(".summary-cell > span")).toContainText("Clear", { timeout: 60_000 });
  await expect(row.getByText("Bullish", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Manual timeframe for AAPL")).toHaveValue("1m");
  await expect(page.getByLabel("Manual timeframe for MSFT")).toHaveValue("5m");
  const msftRow = page.getByRole("row", { name: "Open MSFT analysis" });
  await msftRow.getByRole("button", { name: "Run now" }).click();
  await expect(msftRow.getByText("No trade", { exact: true })).toBeVisible({ timeout: 60_000 });

  await page.getByLabel("Manual timeframe for AAPL").selectOption("10m");
  await page.getByLabel("Manual timeframe for NVDA").selectOption("1m");
  for (const symbol of ["AAPL", "NVDA", "AMZN"]) {
    await page.getByRole("checkbox", { name: `Select ${symbol}` }).check();
  }
  await page.getByRole("button", { name: "Run selected" }).click();
  await expect(page.getByText(/Manual batch settled · 2 completed · 1 failed/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("checkbox", { name: "Select AAPL" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Select NVDA" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Select AMZN" })).toBeChecked();
  await page.reload();
  await expect(page.getByLabel("Manual timeframe for AAPL")).toHaveValue("10m");
  await expect(page.getByLabel("Manual timeframe for NVDA")).toHaveValue("1m");
  await expect(page.getByLabel("Manual timeframe for AMZN")).toHaveValue("5m");

  const watchlist = page.locator("section.watchlist-panel").filter({ has: page.getByRole("heading", { name: "Watchlist" }) });
  await watchlist.getByRole("button", { name: "Bullish" }).click();
  await expect(watchlist.getByRole("row", { name: "Open AAPL analysis" })).toBeVisible();
  await expect(watchlist.getByRole("row", { name: "Open NVDA analysis" })).not.toBeVisible();
  await watchlist.getByRole("button", { name: "Bearish" }).click();
  await expect(watchlist.getByRole("row", { name: "Open NVDA analysis" })).toBeVisible();
  await watchlist.getByRole("button", { name: "All" }).click();
  await watchlist.getByRole("button", { name: "Conviction" }).click();
  await expect(watchlist.getByRole("row").nth(1)).toContainText("High conviction");

  const history = page.locator("section.signal-history");
  await history.getByRole("button", { name: "Bearish" }).click();
  await expect(history.getByRole("row")).toHaveCount(2);
  await expect(history.getByRole("row").nth(1)).toContainText("NVDA");
  await history.getByRole("button", { name: "All" }).click();
  await history.getByRole("button", { name: "Conviction High→Low" }).click();
  await expect(history.getByRole("row").nth(1)).toContainText("high");

  await page.getByRole("checkbox", { name: "Select AMZN" }).uncheck();

  const refreshedAaplRow = page.getByRole("row", { name: "Open AAPL analysis" });
  await expect(refreshedAaplRow.getByText("Auto on")).toBeVisible();
  await refreshedAaplRow.getByRole("checkbox", { name: "Select AAPL" }).check();
  await page.getByRole("button", { name: "Disable auto" }).click();
  await expect(refreshedAaplRow.getByText("Auto off")).toBeVisible();
  await refreshedAaplRow.getByRole("checkbox", { name: "Select AAPL" }).check();
  await page.getByRole("button", { name: "Enable auto" }).click();
  await expect(refreshedAaplRow.getByText("Auto on")).toBeVisible();

  await refreshedAaplRow.press("Enter");
  await expect(page).toHaveURL(/\/symbols\/AAPL$/);
  await expect(page.getByTestId("compact-signal")).toBeVisible();
  await expect(page.getByRole("img", { name: /frozen 10m chart with VWAP, Keltner Channels, Volume/ })).toBeVisible();
  await expect(page.getByText("Chart-Img / TradingView · 10m")).toBeVisible();
  await expect(page.getByText("Full AI reasoning · cached")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Visible VWAP continuation" })).toBeVisible();
  await expect(page.getByText("Timeframe indicators")).not.toBeVisible();

  await expect(page.getByRole("heading", { name: "High-conviction theses" })).toBeVisible();
  await expect(page.getByText("Review only", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Review thesis" }).first().click();
  await expect(page).toHaveURL(/\/symbols\/AAPL\?analysis=[0-9a-f-]+&date=\d{4}-\d{2}-\d{2}&tab=review$/);
  await expect(page.getByRole("heading", { name: "Review this analysis" })).toBeVisible();

  await page.getByRole("tab", { name: "Audit & inputs" }).click();
  await expect(page.getByRole("img", { name: /AAPL exact Chart-Img model input/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exact image submitted to the model" })).toBeVisible();
  await expect(page.getByText("google/gemini-2.5-pro").first()).toBeVisible();

  await page.getByRole("tab", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Review this analysis" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByRole("link", { name: "Viewing" }).click();
  await expect(page).toHaveURL(/\/symbols\/AAPL\?analysis=[0-9a-f-]+$/);
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByRole("link", { name: "Load" }).click();
  await expect(page.getByRole("img", { name: /frozen 1m chart with VWAP, Keltner Channels, Volume/ })).toBeVisible();
  await expect(page.getByText("Chart-Img / TradingView · 1m")).toBeVisible();
  await expect(page.getByText("Full AI reasoning · cached")).toBeVisible({ timeout: 60_000 });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 834, height: 1112 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
    await expect(page.getByRole("img", { name: /frozen 1m chart/ })).toBeVisible();
  }

  const scanStatus = await page.request.get("/api/scans/AAPL");
  expect(scanStatus.ok()).toBe(true);
  expect(JSON.stringify(await scanStatus.json())).not.toMatch(/OPENROUTER|CHART_IMG_API_KEY|rawResponse/);
  const providerStats = await page.request.get("http://127.0.0.1:3199/stats");
  expect(await providerStats.json()).toEqual({ chart: 5, compact: expectedCompactCalls + 3, full: 2 });
  const diagnostics = await (await page.request.get("http://127.0.0.1:3199/diagnostics")).json();
  expect(diagnostics.chartRequests).toEqual(expect.arrayContaining([
    { symbol: "NASDAQ:AAPL", interval: "1m" },
    { symbol: "NASDAQ:MSFT", interval: "5m" },
    { symbol: "NASDAQ:AAPL", interval: "10m" },
    { symbol: "NASDAQ:NVDA", interval: "1m" },
    { symbol: "NASDAQ:AMZN", interval: "5m" },
  ]));
  expect(diagnostics.concurrency.chart.maximum).toBeGreaterThanOrEqual(3);

  await page.goto("/dashboard");
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 834, height: 1112 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
    await expect(page.getByLabel("Manual timeframe for AAPL")).toBeVisible();
    await expect(page.locator("section.signal-history").getByRole("button", { name: "Bearish" })).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("row", { name: /AAPL/ }).last().press("Enter");
  await expect(page.getByText("Full AI reasoning · cached")).toBeVisible();
  expect(await (await page.request.get("http://127.0.0.1:3199/stats")).json()).toEqual({
    chart: 5,
    compact: expectedCompactCalls + 3,
    full: 2,
  });

  await page.goto("/settings");
  await expect(page.getByText("Gemini 2.5 Pro only", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Watchlist symbol 1", { exact: true })).toHaveValue("AAPL");
  await expect(page.getByLabel("Watchlist symbol 20", { exact: true })).toHaveValue("USO");
  await expect(page.getByText("20 / 20")).toBeVisible();
});
