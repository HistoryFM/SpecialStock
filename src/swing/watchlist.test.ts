import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { parseSwingWatchlistCsv, parseSwingWatchlistXlsx, SWING_WATCHLIST_MAX_BYTES, SwingWatchlistValidationError } from "@/swing/watchlist";

describe("Swing watchlist CSV", () => {
  it("normalizes headers, tickers, exchange aliases, and preserves order", () => {
    expect(parseSwingWatchlistCsv("Stock Name,SYMBOL,Exchange\nApple,aapl,NASDAQ\nGold,gld,NYSE American\nBerkshire,brk.b,NYSE")).toEqual([
      { stockName: "Apple", symbol: "AAPL", exchange: "NASDAQ", position: 0 },
      { stockName: "Gold", symbol: "GLD", exchange: "AMEX", position: 1 },
      { stockName: "Berkshire", symbol: "BRK.B", exchange: "NYSE", position: 2 },
    ]);
  });

  it.each([
    ["missing header", "Stock Name,Symbol\nApple,AAPL", "Missing required header"],
    ["duplicate", "Stock Name,Symbol,Exchange\nApple,AAPL,NASDAQ\nApple 2,aapl,NYSE", "duplicate symbol AAPL"],
    ["invalid symbol", "Stock Name,Symbol,Exchange\nBad,$AAPL,NASDAQ", "valid US stock symbol"],
    ["unsupported exchange", "Stock Name,Symbol,Exchange\nApple,AAPL,LSE", "Invalid option"],
    ["blank", "Stock Name,Symbol,Exchange\n,AAPL,NASDAQ", "Too small"],
  ])("rejects %s atomically", (_label, input, issue) => {
    expect(() => parseSwingWatchlistCsv(input)).toThrow(SwingWatchlistValidationError);
    try { parseSwingWatchlistCsv(input); } catch (error) { expect((error as SwingWatchlistValidationError).issues.join(" ")).toContain(issue); }
  });

  it("rejects more than twenty rows", () => {
    const rows = Array.from({ length: 21 }, (_, index) => `Stock ${index},S${index},NYSE`).join("\n");
    expect(() => parseSwingWatchlistCsv(`Stock Name,Symbol,Exchange\n${rows}`)).toThrow("1–20");
  });

  it("locks the upload limit at 5 MB", () => {
    expect(SWING_WATCHLIST_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("parses one populated XLSX worksheet with the same normalization", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Blank");
    const sheet = workbook.addWorksheet("Swing");
    sheet.addRow(["STOCK NAME", "Symbol", "exchange"]);
    sheet.addRow(["Apple", "aapl", "NASDAQ"]);
    sheet.addRow(["Gold", "gld", "NYSE American"]);
    const bytes = await workbook.xlsx.writeBuffer();
    await expect(parseSwingWatchlistXlsx(Buffer.from(bytes))).resolves.toEqual([
      { stockName: "Apple", symbol: "AAPL", exchange: "NASDAQ", position: 0 },
      { stockName: "Gold", symbol: "GLD", exchange: "AMEX", position: 1 },
    ]);
  });

  it("rejects ambiguous or empty XLSX workbooks", async () => {
    const ambiguous = new ExcelJS.Workbook();
    for (const name of ["One", "Two"]) ambiguous.addWorksheet(name).addRow(["Stock Name", "Symbol", "Exchange"]);
    await expect(ambiguous.xlsx.writeBuffer().then((bytes) => parseSwingWatchlistXlsx(Buffer.from(bytes)))).rejects.toThrow("exactly one populated worksheet");

    const empty = new ExcelJS.Workbook();
    empty.addWorksheet("Empty");
    await expect(empty.xlsx.writeBuffer().then((bytes) => parseSwingWatchlistXlsx(Buffer.from(bytes)))).rejects.toThrow("one populated worksheet");
  });
});
