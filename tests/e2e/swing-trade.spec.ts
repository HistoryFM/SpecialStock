import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";

const csv = (rows: string[]) => `Stock Name,Symbol,Exchange\n${rows.join("\n")}`;

async function xlsx(rows: string[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Swing Watchlist");
  sheet.addRow(["Stock Name", "Symbol", "Exchange"]);
  for (const row of rows) sheet.addRow(row.split(","));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("versions Swing inputs, runs a macro-first mocked batch, and audits exact artifacts", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("Shared password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Swing Trade" }).click();
  await expect(page.getByRole("heading", { name: "Swing Trade" })).toBeVisible();
  await expect(page.getByText("Off by default")).toBeVisible();

  const upload = async (name: string, rows: string[]) => {
    const excel = name.endsWith(".xlsx");
    await page.getByLabel("Watchlist CSV or XLSX").setInputFiles({ name, mimeType: excel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv", buffer: excel ? await xlsx(rows) : Buffer.from(csv(rows)) });
    await page.getByRole("button", { name: "Import and activate" }).click();
    await expect(page.getByText("Swing watchlist imported and activated.")).toBeVisible();
  };
  const largeRows = Array.from({ length: 72 }, (_, index) => `Stock ${index + 1},S${index + 1},${index % 2 ? "NASDAQ" : "NYSE"}`);
  await page.getByLabel("Watchlist CSV or XLSX").setInputFiles({ name: "large.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await xlsx(largeRows) });
  await page.getByRole("button", { name: "Import and activate" }).click();
  const picker = page.getByRole("region", { name: "Choose Swing stocks" });
  await expect(picker.getByText("0 of 100 selected · 72 valid rows")).toBeVisible();
  await picker.getByLabel("Search uploaded stocks").fill("S72");
  await expect(picker.getByText("Stock 72")).toBeVisible();
  await picker.getByLabel("Search uploaded stocks").fill("");
  await picker.getByRole("button", { name: "Select all" }).click();
  await expect(picker.getByText("72 of 100 selected · 72 valid rows")).toBeVisible();
  await expect(picker.getByText("Stock 21").locator("..").getByRole("checkbox")).toBeEnabled();
  await picker.getByRole("button", { name: "Activate 72" }).click();
  await expect(page.getByText("Swing watchlist imported and activated.")).toBeVisible();
  await expect(page.getByText("72 stocks · version 1")).toBeVisible();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.locator(".swing-progress")).toContainText("72/72 analyzed", { timeout: 90_000 });
  await upload("first.xlsx", ["Apple,AAPL,NASDAQ", "Microsoft,MSFT,NASDAQ"]);
  await upload("second.csv", ["Apple,AAPL,NASDAQ", "Microsoft,MSFT,NASDAQ", "Nvidia,NVDA,NASDAQ", "Amazon,AMZN,NASDAQ"]);
  await expect(page.getByText("4 stocks · version 3")).toBeVisible();
  await page.getByText("Watchlist version history").click();
  await page.locator(".swing-history-list > div").filter({ hasText: "v2" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("2 stocks · version 2")).toBeVisible();
  await page.locator(".swing-history-list > div").filter({ hasText: "v3" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("4 stocks · version 3")).toBeVisible();

  const editor = page.getByLabel("Swing analysis instructions");
  await editor.fill("Use the locked daily visual evidence to prioritize polarity retests, visible volume confirmation, moving-average geometry, and conservative execution levels. Treat every far-right candle as provisional and return NO_TRADE whenever exact execution evidence is unclear.");
  await expect(page.getByLabel("Swing assembled prompt preview")).toContainText("polarity retests");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText("Swing prompt revision 2 is active.")).toBeVisible();
  await page.getByRole("button", { name: "Restore default" }).click();
  await expect(page.getByText("Swing prompt revision 3 is active.")).toBeVisible();
  await page.getByText("Prompt revision history").click();
  await page.locator(".swing-history-list > div").filter({ hasText: "Revision 2" }).getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByText("Swing prompt revision 2 is active.")).toBeVisible();

  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText(/macro capture|macro analysis|stock capture|stock analysis/i).first()).toBeVisible();
  await expect(page.locator(".swing-results").getByText("partial", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "BULLISH ACCELERATION" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ranked actionable candidates" })).toBeVisible();
  const table = page.locator(".swing-table-wrap");
  await expect(table.getByText("#1 AAPL")).toBeVisible();
  await expect(table.getByText("#2 MSFT")).toBeVisible();
  await expect(page.getByRole("heading", { name: "NO_TRADE" })).toBeVisible();
  await expect(page.locator(".swing-card-list").getByText(/NVDA/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Failed symbols" })).toBeVisible();
  await expect(page.locator(".swing-card-list").getByText(/AMZN/)).toBeVisible();
  await expect(page.locator(".swing-progress")).toContainText("13 provider calls · $0.05");

  await table.getByRole("link", { name: /#1 AAPL/ }).click();
  await expect(page.getByText("SHA-256 verified")).toBeVisible();
  await expect(page.getByRole("img", { name: /AAPL exact frozen daily chart sent to Gemini/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "📌 AAPL: LONG" })).toBeVisible();
  await expect(page.getByText(/Pattern: Daily horizontal range breakout and retest/)).toBeVisible();
  await expect(page.getByText(/Volume ratio: 1.80x/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "➡️ Daily-Chart Trigger Rule" })).toBeVisible();
  await expect(page.getByText(/^google\/gemini-2\.5-pro \/ google\/gemini-2\.5-pro$/)).toBeVisible();
  await expect(page.getByText(/swing-daily-v2/)).toBeVisible();

  const diagnostics = await (await page.request.get("http://127.0.0.1:3199/diagnostics")).json();
  expect(diagnostics.calls.swingChart).toBeGreaterThanOrEqual(8);
  expect(diagnostics.calls.swingMacro).toBeGreaterThanOrEqual(1);
  expect(diagnostics.calls.swingStock).toBeGreaterThanOrEqual(4);
  expect(diagnostics.chartRequests).toEqual(expect.arrayContaining([
    { symbol: "AMEX:SPY", interval: "1D" }, { symbol: "NASDAQ:QQQ", interval: "1D" },
    { symbol: "AMEX:GLD", interval: "1D" }, { symbol: "NASDAQ:TLT", interval: "1D" },
  ]));

  await page.getByRole("link", { name: "← Swing Trade" }).click();
  await page.getByText("Saved automatic and manual run history").click();
  await expect(page.locator(".swing-history-list").getByText(/manual/).first()).toBeVisible();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
  }
});
