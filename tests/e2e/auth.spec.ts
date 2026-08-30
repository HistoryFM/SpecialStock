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
  await expect(row.locator(".summary-cell > span")).toContainText("Bullish visual thesis", { timeout: 60_000 });
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
  await expect(page.getByTestId("ai-decision-brief")).toBeVisible();
  await expect(page.getByRole("img", { name: /frozen five-minute chart with VWAP, Keltner Channels, Volume/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How the model reached this conclusion" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Momentum and trend strength" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Visual evidence ledger" })).toBeVisible();
  await expect(page.getByText("Timeframe indicators")).not.toBeVisible();

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

  await page.goto("/settings");
  await expect(page.getByText("Gemini 2.5 Pro", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Managed from the watchlist" })).toBeVisible();
  await expect(page.getByLabel("Watchlist symbol 1")).toHaveValue("AAPL");
});
