import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";

test("GEX keeps an independent list and leaves sample preview tables out of the live workspace", async ({ page }) => {
  const unauthorized = await page.request.get("/api/gex/state");
  expect(unauthorized.status()).toBe(401);

  await page.goto("/login");
  await page.getByLabel("Shared password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "GEX Analysis" }).click();
  await expect(page.getByRole("heading", { name: "GEX Analysis" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Schwab option-chain structure" })).toHaveCount(0);
  await page.getByLabel("CSV, TXT, or XLSX symbol list").setInputFiles({
    name: "gex-list.csv", mimeType: "text/csv", buffer: Buffer.from("Symbol\nGOOGL\nAAPL\nAMD\nGOOGL\nbad!\n"),
  });
  const saveList = page.getByRole("button", { name: "Save list" });
  await expect(saveList).toBeEnabled();
  await saveList.click();
  const listPanel = page.getByLabel("Your GEX ticker list");
  await expect(listPanel.getByRole("status")).toContainText("3 symbols saved");
  await expect(listPanel.getByRole("status")).toContainText("1 duplicate removed");
  await expect(listPanel.getByRole("status")).toContainText("1 invalid item excluded");
  await expect(page.getByRole("heading", { name: "Sample wall tables" })).toHaveCount(0);

  const stateResponse = await page.request.get("/api/gex/state");
  const state = (await stateResponse.json() as { state: { symbols: string[]; revision: number } }).state;
  expect(state.symbols).toEqual(["GOOGL", "AAPL", "AMD"]);
  const stale = await page.request.get(`/api/gex/export?format=chart&revision=${state.revision - 1}`);
  expect(stale.status()).toBe(409);

  const workbookResponse = await page.request.get(`/api/gex/export?format=xlsx&revision=${state.revision}`);
  expect(workbookResponse.status()).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await workbookResponse.body()).buffer);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Unified Master Table", "Call Wall Focus", "Put Wall Focus"]);
  expect(workbook.getWorksheet("Unified Master Table")!.getCell("A5").value).toBe("GOOGL");
  expect(workbook.getWorksheet("Unified Master Table")!.getCell("A9").value).toBe("AMD");
  expect(workbook.getWorksheet("Unified Master Table")!.getCell("A13").value).toBeNull();

  const chart = await page.request.get(`/api/gex/export?format=chart&revision=${state.revision}`);
  expect(chart.status()).toBe(200);
  expect(await chart.text()).toContain("input showSampleLevels = no;");
  const watchlist = await page.request.get(`/api/gex/export?format=watchlist&revision=${state.revision}`);
  expect(watchlist.status()).toBe(200);
  expect((await watchlist.text()).match(/^plot /gm)).toHaveLength(1);

  await page.reload();
  await expect(page.getByText("gex-list.csv")).toBeVisible();
});
