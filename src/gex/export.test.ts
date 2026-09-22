import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { GEX_DEMO_ROWS, gexDemoSelection } from "@/gex/demo";
import { buildGexDemoWorkbook } from "@/gex/export";
import { buildGexChartScript, buildGexWatchlistScript } from "@/gex/thinkscript";

describe("GEX demo outputs", () => {
  it("keeps uploaded order and flags symbols absent from the undated sample", () => {
    const selected = gexDemoSelection(["AMD", "AAPL", "GOOGL"]);
    expect(selected.rows.map((row) => row.symbol)).toEqual(["AMD", "GOOGL"]);
    expect(selected.unavailableSymbols).toEqual(["AAPL"]);
  });

  it("creates exactly three tabs with typed sample values and no fabricated setup", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(await buildGexDemoWorkbook([GEX_DEMO_ROWS[0]!, GEX_DEMO_ROWS[1]!])).buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Unified Master Table", "Call Wall Focus", "Put Wall Focus"]);
    const master = workbook.getWorksheet("Unified Master Table")!;
    expect(master.getCell("C5").value).toBe(350);
    expect(master.getCell("F5").value).toBe(350.25);
    expect(master.getCell("F6").value).toBeNull();
    expect(master.getCell("K6").value).toBe("Unavailable in sample");
    expect(master.getCell("F7").value).toBe(345.8);
    expect(master.getCell("F8").value).toBeNull();
    expect(master.getCell("A9").value).toBe("AMD");
    expect(workbook.getWorksheet("Put Wall Focus")!.getCell("K6").value).toBe("Unavailable in sample");
  });

  it("generates inactive, symbol-mapped scripts with four guarded watchlist events", () => {
    const chart = buildGexChartScript([GEX_DEMO_ROWS[0]!, GEX_DEMO_ROWS[1]!]);
    const watchlist = buildGexWatchlistScript([GEX_DEMO_ROWS[0]!, GEX_DEMO_ROWS[1]!]);
    expect(chart).toContain("input showSampleLevels = no;");
    expect(chart).toContain('GetSymbol() == "GOOGL"');
    expect(chart).not.toContain('GetSymbol() == "META"');
    expect(chart).toContain("def Is_PutWall_Zone");
    expect(chart).toContain("DynamicEntry.AssignValueColor");
    expect(chart).not.toContain("SetDefaultColor");
    expect(watchlist.match(/^plot /gm)).toHaveLength(1);
    for (const label of ["CALL SQUEEZE", "PUT WALL BOUNCE", "CEILING FADE", "PUT BREAKDOWN", "AT CALL GATE", "AT PUT FLOOR"]) expect(watchlist).toContain(label);
    expect(watchlist).toContain("if !Active then Color.DARK_GRAY");
    expect(watchlist).toContain("0.003");
  });
});
