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

  await expect(page.getByRole("combobox", { name: "AI model" }).getByRole("option", { name: "Gemini 2.5 Pro" })).toBeAttached();
  await expect(page.getByRole("combobox", { name: "AI model" }).getByRole("option", { name: "GPT-5.6 Sol · High" })).toBeAttached();
  await expect(page.getByRole("combobox", { name: "AI model" }).getByRole("option", { name: "Claude Opus 5 · High" })).toBeAttached();
  await page.getByRole("button", { name: "Interpret rules with AI" }).click();
  await expect(page.getByRole("heading", { name: "Review exact strategy plan · version 2" })).toBeVisible();
  await expect(page.getByText("TQQQ close crosses above 50-day SMA").first()).toBeVisible();
  await expect(page.getByText("No 200-day SMA filter.")).toBeVisible();
  await expect(page.getByLabel("Cash interest (% annual)")).toHaveValue("2.5");
  await page.getByRole("button", { name: "Run confirmed strategy" }).click();
  const report = page.getByRole("region", { name: "Backtest report" });
  await expect(report).toBeVisible();
  await expect(report.locator(".bt-report-rules")).toContainText("cash → long: TQQQ close crosses above 50-day SMA");
  await expect(report.locator(".bt-report-rules")).not.toContainText("200-day SMA");
  await expect(page.locator(".bt-saved-run").first()).toContainText("v2");
  await expect(report.getByRole("heading", { name: "Annual returns" })).toBeVisible();
  await expect(report.getByRole("heading", { name: "Maximum drawdown · full period" })).toBeVisible();
  await expect(report.locator(".bt-report-block").filter({ hasText: "Annual returns" }).getByRole("columnheader", { name: "TQQQ" })).toBeVisible();
  await expect(report.locator(".bt-report-block").filter({ hasText: "Maximum drawdown · full period" }).getByRole("rowheader", { name: "TQQQ" })).toBeVisible();
  await expect(report.getByLabel("Chart legend")).toContainText("Strategy");
  await expect(report.locator(".bt-chart text").first()).toContainText("$0.00");
  await expect(report.locator(".bt-chart text").filter({ hasText: "2022" }).first()).toBeVisible();
  await expect(report.getByRole("columnheader", { name: "Traded close" })).toBeVisible();
  await expect(report.getByRole("columnheader", { name: "SPY close" })).toBeVisible();
  await expect(report.getByRole("columnheader", { name: "QQQ close" })).toBeVisible();

  await expect(report.locator(".bt-report-settings")).not.toHaveAttribute("open", "");
  await report.locator(".bt-report-settings > summary").click();
  const sectionToggle = await report.getByRole("checkbox", { name: "Annual returns" }).boundingBox();
  expect(sectionToggle?.width).toBeLessThanOrEqual(20);
  expect(sectionToggle?.height).toBeLessThanOrEqual(20);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await report.locator(".bt-report-settings").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 800 });
  await report.getByLabel("Customize report with AI").fill("Show Strategy and QQQ for the last year, and add TQQQ close.");
  await report.getByRole("button", { name: "Apply AI report choices" }).click();
  await expect(report.getByRole("combobox", { name: "Date range" })).toHaveValue("last_year");
  await expect(report.locator(".bt-chart text").filter({ hasText: "2022-01" }).first()).toBeVisible();
  await expect(report.getByRole("columnheader", { name: "TQQQ close" })).toBeVisible();
  await expect(report.getByRole("heading", { name: "Annual returns" })).toHaveCount(0);

  await page.getByRole("combobox", { name: "AI model" }).selectOption("anthropic/claude-opus-5");
  await report.getByRole("button", { name: "Analyze with selected AI" }).click();
  await expect(report.getByRole("heading", { name: /AI analysis/ })).toBeVisible();
  await report.getByRole("button", { name: "Test suggestion" }).click();
  await expect(report.getByRole("heading", { name: "Suggested change vs original · same dates" })).toBeVisible();
  await expect(report.getByText("Original max drawdown")).toBeVisible();

  const legacy = { longTicker: "TQQQ", comparisons: [], mode: "cash", startingCapital: 1000, cashRate: 0, slippage: 0, fee: 0,
    prompt: "Legacy 200-day crossover", model: "google/gemini-2.5-pro",
    strategy: { entry: [{ kind: "price_sma", period: 200, relation: "crosses_above" }], exit: [{ kind: "price_sma", period: 200, relation: "crosses_below" }],
      rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, macdFast: 12, macdSlow: 26, macdSignal: 9 } };
  const created = await page.request.post("/api/backtesting/runs", { data: { input: legacy } });
  expect(created.ok()).toBeTruthy();
  await page.reload();
  await page.locator(".bt-saved-run").filter({ hasText: "v1" }).click();
  await expect(page.getByRole("region", { name: "Backtest report" }).locator(".bt-report-rules")).toContainText("200-day SMA");
});
