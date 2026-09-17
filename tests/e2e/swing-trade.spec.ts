import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

type Row = [name: string, symbol: string, exchange: string, industry?: string];
const csv = (rows: Row[]) => `Stock Name,Symbol,Exchange,Industry\n${rows.map((row) => row.join(",")).join("\n")}`;

async function xlsx(rows: Row[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Swing Watchlist");
  sheet.addRow(["Stock Name", "Symbol", "Exchange", "Industry"]);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function importList(page: Page, name: string, filename: string, rows: Row[], select?: "first20" | "all", sublistName?: string) {
  const excel = filename.endsWith(".xlsx");
  await page.getByRole("tab", { name: "Lists" }).click();
  await page.getByRole("button", { name: "Import list" }).click();
  await page.getByLabel("List name").fill(name);
  await page.getByLabel("CSV or XLSX").setInputFiles({ name: filename, mimeType: excel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv", buffer: excel ? await xlsx(rows) : Buffer.from(csv(rows)) });
  await page.getByRole("button", { name: "Preview and validate" }).click();
  const picker = page.getByRole("region", { name: "Choose Swing stocks" });
  await expect(picker).toBeVisible();
  if (select === "first20") await picker.getByRole("button", { name: "Select first 20" }).click();
  if (select === "all") await picker.getByRole("button", { name: "Select all" }).click();
  if (sublistName) await picker.getByPlaceholder("My daily 20").fill(sublistName);
  await picker.getByRole("button", { name: /Save.*activate/ }).click();
  await expect(page.getByText(/list saved and activated/)).toBeVisible();
}

async function waitForRun(page: Page, completed: number, total = completed) {
  await expect(page.locator(".swing-run-status")).toContainText(`${total} of ${total}`, { timeout: 120_000 });
  await expect(page.locator(".swing-run-status")).toContainText(`${completed} completed`);
}

test("saves US and India lists, reuses sublists, consolidates reports, cancels runs, and exports Excel", async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.goto("/login");
  await page.getByLabel("Shared password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Swing Trade" }).click();
  await expect(page.getByRole("heading", { name: "Swing Trade" })).toBeVisible();
  await expect(page.getByText("Automatic analysis off")).toBeVisible();
  await expect(page).toHaveURL(/market=US&section=today/);
  await page.getByRole("tab", { name: "Lists" }).click();
  await expect(page).toHaveURL(/market=US&section=lists/);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Lists" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Today" }).click();
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Lists" })).toHaveAttribute("aria-selected", "true");

  const largeRows: Row[] = Array.from({ length: 72 }, (_, index) => [`Stock ${index + 1}`, `S${index + 1}`, index % 2 ? "NASDAQ" : "NYSE", index % 3 ? "Technology" : "Industrials"]);
  await page.getByRole("button", { name: "Import list" }).click();
  await page.getByLabel("List name").fill("US 72 master");
  await page.getByLabel("CSV or XLSX").setInputFiles({ name: "large.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await xlsx(largeRows) });
  await page.getByRole("button", { name: "Preview and validate" }).click();
  const picker = page.getByRole("region", { name: "Choose Swing stocks" });
  await expect(picker.getByText("0 of 100 selected · 72 valid rows")).toBeVisible();
  await picker.getByLabel("Search uploaded stocks").fill("S72");
  await expect(picker.getByText(/Stock 72/)).toBeVisible();
  await picker.getByLabel("Search uploaded stocks").fill("");
  await picker.getByRole("button", { name: "Select first 20" }).click();
  await picker.getByPlaceholder("My daily 20").fill("US daily 20");
  await picker.getByRole("button", { name: "Save master and activate 20-stock sublist" }).click();
  await expect(page.getByText("US list saved and activated.")).toBeVisible();
  const masterCard = page.locator(".swing-list-table article").filter({ has: page.getByText("US 72 master", { exact: true }) });
  const sublistCard = page.locator(".swing-list-table article").filter({ has: page.getByText("US daily 20", { exact: true }) });
  await expect(masterCard).toContainText("Master");
  await expect(masterCard).toContainText("72");
  await expect(sublistCard).toContainText("Sublist");
  await expect(sublistCard).toContainText("20");
  await expect(sublistCard).toHaveClass(/active/);

  await sublistCard.getByRole("button", { name: "Run" }).click();
  await waitForRun(page, 20);
  await expect(page.locator(".swing-run-status")).toContainText("39,900");
  await expect(page.locator(".swing-run-status")).toContainText("6,300 reasoning");
  await expect(page.locator(".swing-run-status")).toContainText("45");
  await expect(page.locator(".swing-run-status")).toContainText("Concurrency");

  await page.getByRole("tab", { name: "Lists" }).click();
  await masterCard.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("Saved list activated and verified.")).toBeVisible();
  await masterCard.getByRole("button", { name: "Run" }).click();
  await waitForRun(page, 72);
  await expect(page.getByLabel("Constituent batch").locator("option")).toHaveCount(2);
  await page.getByRole("tab", { name: "Lists" }).click();
  await page.getByRole("button", { name: "Create sublist" }).click();
  await page.getByPlaceholder("Saved sublist name").fill("US reusable 20");
  await page.getByRole("dialog").getByRole("button", { name: "Select first 20" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save sublist" }).click();
  await expect(page.getByText("Sublist snapshot saved and activated.")).toBeVisible();
  await expect(page.locator(".swing-list-table article").filter({ has: page.getByText("US reusable 20", { exact: true }) })).toHaveClass(/active/);

  const focusedRows: Row[] = [
    ["Apple", "AAPL", "NASDAQ", "Technology"],
    ["Microsoft", "MSFT", "NASDAQ", "Software"],
    ["Nvidia", "NVDA", "NASDAQ", "Semiconductors"],
    ["Amazon", "AMZN", "NASDAQ", "Retail"],
  ];
  await importList(page, "US focused four", "focused.csv", focusedRows);
  const focusedCard = page.locator(".swing-list-table article").filter({ has: page.getByText("US focused four", { exact: true }) });
  await focusedCard.getByRole("button", { name: "Run" }).click();
  await waitForRun(page, 3, 4);
  await expect(page.getByRole("heading", { name: "Recommended candidates" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Directional No-Trade" })).toBeVisible();
  await expect(page.getByText("No direction", { exact: true })).toBeVisible();
  await expect(page.getByText("Failures", { exact: true })).toBeVisible();
  await expect(page.locator(".swing-report")).toContainText("MSFT");
  await expect(page.locator(".swing-report")).toContainText("Server downgrade");
  await expect(page.locator(".swing-report")).toContainText("NVDA");
  await expect(page.locator(".swing-report")).toContainText("AMZN");
  const recommendedTable = page.locator(".swing-report .swing-table-wrap").first();
  await recommendedTable.getByRole("button", { name: "Sort Industry ascending" }).click();
  await expect(recommendedTable.locator("tbody tr").first()).toContainText("Industrials");

  const exportResponse = await page.request.get(`/api/swing/reports/export?market=US&date=${await page.getByRole("textbox", { name: "Report date" }).inputValue()}&recommendedSort=asc&noTradeSort=asc`);
  expect(exportResponse.ok()).toBeTruthy();
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(Uint8Array.from(await exportResponse.body()).buffer);
  expect(exported.worksheets.map((sheet) => sheet.name)).toEqual(["Recommended", "Directional No-Trade"]);
  expect(exported.getWorksheet("Recommended")?.getRow(1).values).toEqual(expect.arrayContaining(["Industry", "Source Run", "Source List"]));
  expect(exported.getWorksheet("Directional No-Trade")?.getCell("A2").value).toBe("MSFT");

  await page.getByRole("button", { name: "India", exact: true }).click();
  await importList(page, "India master", "india.xlsx", [["Reliance", "RELIANCE", "NSE", "Energy"], ["BSE example", "500325", "BSE", "Industrials"]]);
  const indiaCard = page.locator(".swing-list-table article").filter({ has: page.getByText("India master", { exact: true }) });
  await indiaCard.getByRole("button", { name: "Run" }).click();
  await waitForRun(page, 2);
  await expect(page.getByText("Manual analysis only")).toBeVisible();

  await page.getByRole("button", { name: "US", exact: true }).click();
  await page.getByRole("tab", { name: "Lists" }).click();
  await expect(masterCard).toBeVisible();
  await expect(sublistCard).toBeVisible();
  await sublistCard.getByRole("button", { name: "Activate" }).click();
  await expect(sublistCard).toHaveClass(/active/);
  await focusedCard.getByRole("button", { name: "Version history" }).click();
  const focusedVersion = page.locator(".swing-version-list > article").filter({ hasText: "focused.csv" });
  await focusedVersion.getByRole("button", { name: "Activate version" }).click();
  await expect(focusedCard).toHaveClass(/active/);
  await page.getByRole("button", { name: "Close dialog" }).click();

  await masterCard.getByRole("button", { name: "Run" }).click();
  await page.getByRole("button", { name: "Abort analysis" }).click();
  await expect(page.getByText(/Run canceled/)).toBeVisible();
  await expect(page.locator(".swing-run-status")).toContainText(/canceled/i);

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "US analysis runs" })).toBeVisible();
  await expect(page.locator(".swing-history-table > button").first()).toContainText(/manual/i);

  await page.getByRole("tab", { name: "Advanced" }).click();
  const editor = page.getByLabel("Swing analysis instructions");
  await editor.fill("Use the locked daily visual evidence to prioritize polarity retests, visible volume confirmation, moving-average geometry, and conservative execution levels. Treat every far-right candle as provisional and return NO_TRADE whenever exact execution evidence is unclear.");
  await expect(page.getByLabel("Swing assembled prompt preview")).toContainText("polarity retests");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText(/Swing prompt revision .* is active/)).toBeVisible();

  await page.getByRole("tab", { name: "Today" }).click();
  const aapl = page.locator(".swing-report .swing-table-wrap").first().getByRole("link", { name: /AAPL/ });
  const aaplHref = await aapl.getAttribute("href");
  if (!aaplHref) throw new Error("AAPL detail link is missing.");
  await page.goto(aaplHref);
  await expect(page.getByText("SHA-256 verified")).toBeVisible();
  await expect(page.getByRole("img", { name: /AAPL exact frozen daily chart sent to Gemini/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "📌 AAPL: LONG" })).toBeVisible();
  await expect(page.getByText(/swing-daily-v3/)).toBeVisible();
  await page.getByRole("link", { name: "← Swing Trade" }).click();

  await page.getByRole("button", { name: "US", exact: true }).click();
  await page.getByRole("tab", { name: "Lists" }).click();
  await masterCard.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("button", { name: "Abort analysis" })).toBeVisible();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/swing-trade");
  await expect(reopened.getByRole("heading", { name: "Swing Trade" })).toBeVisible();
  await expect.poll(async () => {
    const response = await reopened.request.get("/api/swing/runs");
    const payload = await response.json() as { runs: Array<{ status: string; cancelReason: string | null }> };
    return payload.runs[0]?.status === "canceled" && payload.runs[0]?.cancelReason === "tab_closed";
  }, { timeout: 15_000 }).toBe(true);

  const diagnostics = await (await reopened.request.get("http://127.0.0.1:3199/diagnostics")).json();
  expect(diagnostics.calls.swingChart).toBeGreaterThanOrEqual(100);
  expect(diagnostics.calls.swingMacro).toBeGreaterThanOrEqual(4);
  expect(diagnostics.calls.swingStock).toBeGreaterThanOrEqual(90);
  expect(diagnostics.chartRequests).toEqual(expect.arrayContaining([
    { symbol: "AMEX:SPY", interval: "1D" }, { symbol: "NASDAQ:QQQ", interval: "1D" },
    { symbol: "AMEX:GLD", interval: "1D" }, { symbol: "NASDAQ:TLT", interval: "1D" },
    { symbol: "NSE:NIFTY", interval: "1D" }, { symbol: "NSE:BANKNIFTY", interval: "1D" },
    { symbol: "NSE:INDIAVIX", interval: "1D" }, { symbol: "FX_IDC:USDINR", interval: "1D" },
  ]));

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await reopened.setViewportSize(viewport);
    await expect.poll(() => reopened.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
  }
});
