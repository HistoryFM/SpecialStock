import { expect, test } from "@playwright/test";

const tradingDays: Date[] = [];
for (let day = new Date(Date.UTC(2021, 0, 1)); day <= new Date(Date.UTC(2022, 0, 6)); day = new Date(day.getTime() + 86400000)) {
  if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) tradingDays.push(day);
}
const format = (date: Date) => `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`;
function csv(ticker: string) {
  const tail: Record<string, number[]> = {
    TQQQ: [110, 121, 90, 80], SPY: [100, 101, 102, 103], QQQ: [100, 102, 101, 104], XLK: [100, 103, 104, 105],
  };
  return `Date,Close/Last,Volume,Open,High,Low\n${tradingDays.map((date) => {
    const index = tradingDays.length - 1 - tradingDays.indexOf(date);
    const close = index < 4 ? tail[ticker][3 - index] : 100;
    return `${format(date)},${close},1000,${close},${close},${close}`;
  }).reverse().join("\n")}`;
}

test("imports prices, tests a model-interpreted strategy, and measures a suggested variant", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("Shared password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Backtesting" }).click();
  await expect(page.getByRole("heading", { name: "Backtesting" })).toBeVisible();

  for (const ticker of ["TQQQ", "SPY", "QQQ", "XLK"]) {
    await page.getByLabel("Ticker", { exact: true }).fill(ticker);
    await page.getByLabel("Historical CSV").setInputFiles({ name: `${ticker}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv(ticker)) });
    await page.getByLabel("I confirm these historical closes are split-adjusted.").check();
    await page.getByRole("button", { name: "Import CSV" }).click();
    await expect(page.getByText("CSV imported and saved locally.")).toBeVisible();
  }

  await page.getByRole("checkbox", { name: "XLK" }).check();
  await expect(page.getByRole("combobox", { name: "AI model" }).getByRole("option", { name: "Gemini 2.5 Pro" })).toBeAttached();
  await expect(page.getByRole("combobox", { name: "AI model" }).getByRole("option", { name: "GPT-5.6 Sol · High" })).toBeAttached();
  await expect(page.getByRole("combobox", { name: "AI model" }).getByRole("option", { name: "Claude Opus 5 · High" })).toBeAttached();
  await page.getByRole("button", { name: "Interpret rules with AI" }).click();
  await expect(page.getByRole("heading", { name: "Review exact rules" })).toBeVisible();
  await expect(page.getByText("Price crosses above 50-day SMA").first()).toBeVisible();
  await page.getByRole("button", { name: "Run confirmed strategy" }).click();
  const report = page.getByRole("region", { name: "Backtest report" });
  await expect(report).toBeVisible();
  await expect(report.locator(".bt-report-rules")).toContainText("Enter: Price crosses above 50-day SMA");
  await expect(report.locator(".bt-report-rules")).not.toContainText("200-day SMA");
  await expect(page.locator(".bt-saved-run").first()).toContainText("Exit: Price crosses below 50-day SMA");
  await expect(report.getByRole("heading", { name: "Annual returns" })).toBeVisible();
  await expect(report.getByRole("heading", { name: "Maximum drawdown · full period" })).toBeVisible();
  await expect(report.locator(".bt-report-block").filter({ hasText: "Annual returns" }).getByRole("columnheader", { name: "XLK" })).toBeVisible();
  await expect(report.locator(".bt-report-block").filter({ hasText: "Maximum drawdown · full period" }).getByRole("rowheader", { name: "XLK" })).toBeVisible();
  await expect(report.getByLabel("Chart legend")).toContainText("Strategy");
  await expect(report.locator(".bt-chart text").first()).toContainText("$0.00");

  await page.getByRole("combobox", { name: "AI model" }).selectOption("anthropic/claude-opus-5");
  await report.getByRole("button", { name: "Analyze with selected AI" }).click();
  await expect(report.getByRole("heading", { name: /AI analysis/ })).toBeVisible();
  await report.getByRole("button", { name: "Test suggestion" }).click();
  await expect(report.getByRole("heading", { name: "Suggested change vs original · same dates" })).toBeVisible();
  await expect(report.getByText("Original max drawdown")).toBeVisible();
});
