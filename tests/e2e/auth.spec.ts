import { expect, test } from "@playwright/test";

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
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const row = page.getByRole("row", { name: "Open AAPL analysis" });
  await row.getByRole("button", { name: "Run now" }).click();
  await expect(row.locator(".summary-cell > span")).toContainText("Clear", { timeout: 60_000 });
  await expect(row.getByText("Bullish", { exact: true })).toBeVisible();

  await expect(row.getByText("Auto on")).toBeVisible();
  await row.getByRole("checkbox", { name: "Select AAPL" }).check();
  await page.getByRole("button", { name: "Disable auto" }).click();
  await expect(row.getByText("Auto off")).toBeVisible();
  await row.getByRole("checkbox", { name: "Select AAPL" }).check();
  await page.getByRole("button", { name: "Enable auto" }).click();
  await expect(row.getByText("Auto on")).toBeVisible();

  await row.press("Enter");
  await expect(page).toHaveURL(/\/symbols\/AAPL$/);
  await expect(page.getByTestId("compact-signal")).toBeVisible();
  await expect(page.getByRole("img", { name: /frozen five-minute chart with VWAP, Keltner Channels, Volume/ })).toBeVisible();
  await expect(page.getByText("Full AI reasoning · cached")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Visible VWAP continuation" })).toBeVisible();
  await expect(page.getByText("Timeframe indicators")).not.toBeVisible();

  await expect(page.getByRole("heading", { name: "High-conviction theses" })).toBeVisible();
  await expect(page.getByText("Review only", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Review thesis" }).click();
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

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 834, height: 1112 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
    await expect(page.getByRole("img", { name: /frozen five-minute chart/ })).toBeVisible();
  }

  const scanStatus = await page.request.get("/api/scans/AAPL");
  expect(scanStatus.ok()).toBe(true);
  expect(JSON.stringify(await scanStatus.json())).not.toMatch(/OPENROUTER|CHART_IMG_API_KEY|rawResponse/);
  const providerStats = await page.request.get("http://127.0.0.1:3199/stats");
  expect(await providerStats.json()).toEqual({ chart: 1, compact: 1, full: 1 });

  await page.goto("/dashboard");
  await page.getByRole("row", { name: /AAPL/ }).last().press("Enter");
  await expect(page.getByText("Full AI reasoning · cached")).toBeVisible();
  expect(await (await page.request.get("http://127.0.0.1:3199/stats")).json()).toEqual({ chart: 1, compact: 1, full: 1 });

  await page.goto("/settings");
  await expect(page.getByText("Gemini 2.5 Pro only", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Watchlist symbol 1", { exact: true })).toHaveValue("AAPL");
  await expect(page.getByLabel("Watchlist symbol 20", { exact: true })).toHaveValue("USO");
  await expect(page.getByText("20 / 20")).toBeVisible();
});
