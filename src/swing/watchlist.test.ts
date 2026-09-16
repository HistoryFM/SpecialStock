import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { SWING_WATCHLIST_MAX_ENTRIES } from "@/swing/types";
import { parseSwingWatchlistCsv, parseSwingWatchlistCsvSource, parseSwingWatchlistXlsx, parseSwingWatchlistXlsxSource, selectSwingWatchlistEntries, SWING_WATCHLIST_MAX_BYTES, SwingWatchlistValidationError } from "@/swing/watchlist";

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

  it("accepts a 72-row Swing watchlist and rejects more than one hundred rows", () => {
    const validRows = Array.from({ length: 72 }, (_, index) => `Stock ${index + 1},S${index + 1},NYSE`).join("\n");
    const entries = parseSwingWatchlistCsv(`Stock Name,Symbol,Exchange\n${validRows}`);
    expect(entries).toHaveLength(72);
    expect(entries.at(-1)?.position).toBe(71);

    const oversizedRows = Array.from({ length: 101 }, (_, index) => `Stock ${index + 1},S${index + 1},NYSE`).join("\n");
    expect(() => parseSwingWatchlistCsv(`Stock Name,Symbol,Exchange\n${oversizedRows}`)).toThrow("contains 101 valid data rows");
  });

  it("previews a large valid source and activates a source-ordered subset", () => {
    const rows = Array.from({ length: 72 }, (_, index) => `Stock ${index + 1},S${index + 1},${index % 2 ? "NASDAQ" : "NYSE"}`).join("\n");
    const candidates = parseSwingWatchlistCsvSource(`Stock Name,Symbol,Exchange\n${rows}`);
    expect(candidates).toHaveLength(72);
    const entries = selectSwingWatchlistEntries(candidates, ["S20", "S2", "S7"]);
    expect(entries).toEqual([
      { stockName: "Stock 2", symbol: "S2", exchange: "NASDAQ", position: 0 },
      { stockName: "Stock 7", symbol: "S7", exchange: "NYSE", position: 1 },
      { stockName: "Stock 20", symbol: "S20", exchange: "NASDAQ", position: 2 },
    ]);
  });

  it("validates selected symbols and never leaks position errors", () => {
    const rows = Array.from({ length: 101 }, (_, index) => `Stock ${index + 1},S${index + 1},NYSE`).join("\n");
    const candidates = parseSwingWatchlistCsvSource(`Stock Name,Symbol,Exchange\n${rows}`);
    expect(() => selectSwingWatchlistEntries(candidates, [])).toThrow("Choose 1–100");
    expect(() => selectSwingWatchlistEntries(candidates, Array.from({ length: 101 }, (_, index) => `S${index + 1}`))).toThrow("Choose 1–100");
    expect(() => selectSwingWatchlistEntries(candidates, ["S1", "S1"])).toThrow("duplicate symbol");
    expect(() => selectSwingWatchlistEntries(candidates, ["MISSING"])).toThrow("not present");
    try { parseSwingWatchlistCsv(`Stock Name,Symbol,Exchange\n${rows}`); }
    catch (error) { expect((error as Error).message).not.toContain("position"); }
  });

  it("locks the upload limit at 5 MB", () => {
    expect(SWING_WATCHLIST_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(SWING_WATCHLIST_MAX_ENTRIES).toBe(100);
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

  it("previews more than twenty XLSX rows without assigning final positions", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Swing");
    sheet.addRow(["Stock Name", "Symbol", "Exchange"]);
    for (let index = 0; index < 72; index += 1) sheet.addRow([`Stock ${index + 1}`, `S${index + 1}`, "NYSE"]);
    const bytes = await workbook.xlsx.writeBuffer();
    const candidates = await parseSwingWatchlistXlsxSource(Buffer.from(bytes));
    expect(candidates).toHaveLength(72);
    expect(candidates[20]).toEqual({ stockName: "Stock 21", symbol: "S21", exchange: "NYSE" });
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
