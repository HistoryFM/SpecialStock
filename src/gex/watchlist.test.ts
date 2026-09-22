import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { GexWatchlistError, normalizeGexSymbols, parseGexWatchlistFile } from "@/gex/watchlist";

describe("GEX list intake", () => {
  it("normalizes and deduplicates while exposing invalid entries", () => {
    expect(normalizeGexSymbols([" nvda ", "NVDA", "BRK.B", "bad!", "amd"])).toEqual({
      symbols: ["NVDA", "BRK.B", "AMD"], rejected: ["Item 4: invalid symbol bad!."], duplicates: 1,
    });
  });

  it("accepts one-column CSV and TXT lists and a Symbol column", async () => {
    expect((await parseGexWatchlistFile("stocks.csv", Buffer.from("Symbol,Name\nNVDA,Nvidia\nAMD,AMD\n"))).symbols).toEqual(["NVDA", "AMD"]);
    expect((await parseGexWatchlistFile("stocks.csv", Buffer.from("NVDA\nAMD\n"))).symbols).toEqual(["NVDA", "AMD"]);
    expect((await parseGexWatchlistFile("stocks.txt", Buffer.from("NVDA, AMD\nMETA"))).symbols).toEqual(["NVDA", "AMD", "META"]);
  });

  it("accepts a single populated XLSX sheet and rejects ambiguous layouts", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Symbols").addRows([["Name", "Symbol"], ["Nvidia", "NVDA"], ["AMD", "AMD"]]);
    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    expect((await parseGexWatchlistFile("stocks.xlsx", content)).symbols).toEqual(["NVDA", "AMD"]);
    workbook.addWorksheet("Other").addRow(["META"]);
    await expect(parseGexWatchlistFile("stocks.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toThrow("exactly one populated");
  });

  it("bounds file and list sizes", async () => {
    expect(() => normalizeGexSymbols(Array.from({ length: 101 }, (_, index) => `T${index}`))).toThrow(GexWatchlistError);
    await expect(parseGexWatchlistFile("stocks.txt", Buffer.alloc(1024 * 1024 + 1))).rejects.toThrow("1 MB");
    await expect(parseGexWatchlistFile("stocks.csv", Buffer.from("Name,Exchange\nNvidia,NASDAQ"))).rejects.toThrow("Symbol header");
  });
});
