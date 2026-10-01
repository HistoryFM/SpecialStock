import "server-only";

import ExcelJS from "exceljs";

import type { GexDemoRow } from "@/gex/demo";
import type { GexCategory, GexLiveRow } from "@/gex/live";

type Scenario = "Call breakout" | "Ceiling fade" | "Put bounce" | "Put breakdown";
type ReportRow = {
  symbol: string; scenario: Scenario; flip: number; wall: number; cascade: number | null;
  entryLow: number | null; entryHigh: number | null; target1: number | null; target2: number | null; stop: number | null;
  status: "Provided sample" | "Unavailable in sample";
};

function scenarios(row: GexDemoRow): ReportRow[] {
  const call = (scenario: Scenario): ReportRow => {
    const available = scenario === (row.callDirection === "Long (Breakout)" ? "Call breakout" : "Ceiling fade");
    return {
      symbol: row.symbol, scenario, flip: row.flip, wall: row.callWall, cascade: row.callCascade,
      entryLow: available ? row.callEntryLow : null, entryHigh: available ? row.callEntryHigh : null,
      target1: available ? row.callTarget1 : null, target2: available ? row.callTarget2 : null,
      stop: available ? row.callStop : null, status: available ? "Provided sample" : "Unavailable in sample",
    };
  };
  return [
    call("Call breakout"), call("Ceiling fade"),
    { symbol: row.symbol, scenario: "Put bounce", flip: row.flip, wall: row.putWall, cascade: row.putHalt,
      entryLow: row.putEntryLow, entryHigh: row.putEntryHigh, target1: row.putTarget1, target2: row.putTarget2,
      stop: row.putStop, status: "Provided sample" },
    { symbol: row.symbol, scenario: "Put breakdown", flip: row.flip, wall: row.putWall, cascade: row.putHalt,
      entryLow: null, entryHigh: null, target1: null, target2: null, stop: null, status: "Unavailable in sample" },
  ];
}

function addSheet(workbook: ExcelJS.Workbook, name: string, rows: ReportRow[], cascadeLabel: string) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] });
  sheet.addRow([name]);
  sheet.addRow(["SAMPLE ONLY — undated illustrative levels; not current market data or a verified calculation."]);
  sheet.addRow(["Source: user-provided GEX analysis sample. Missing scenarios are intentionally blank."]);
  const headers = ["Symbol", "Conditional scenario", "Sample GEX flip", "Wall", cascadeLabel, "Entry low", "Entry high", "Target 1", "Target 2", "Stop", "Availability"];
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow([
    row.symbol, row.scenario, row.flip, row.wall, row.cascade, row.entryLow, row.entryHigh,
    row.target1, row.target2, row.stop, row.status,
  ]);
  sheet.columns = [
    { width: 13 }, { width: 22 }, { width: 19 }, { width: 13 }, { width: 30 },
    { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 26 },
  ];
  sheet.getRow(1).font = { bold: true, size: 15, color: { argb: "FF173724" } };
  sheet.getRow(1).height = 27;
  sheet.getRow(2).font = { bold: true, color: { argb: "FF8A2D22" } };
  sheet.getRow(3).font = { italic: true, color: { argb: "FF50645A" } };
  const header = sheet.getRow(4);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173724" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 25;
  for (let index = 5; index <= sheet.rowCount; index += 1) {
    const excelRow = sheet.getRow(index);
    excelRow.height = 21;
    for (let column = 3; column <= 10; column += 1) {
      excelRow.getCell(column).numFmt = "#,##0.00";
      excelRow.getCell(column).alignment = { horizontal: "right", vertical: "middle" };
    }
    if (index % 2 === 0) excelRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6F3" } };
    if (excelRow.getCell(11).value === "Unavailable in sample") excelRow.getCell(11).font = { color: { argb: "FF8A5B19" } };
  }
  sheet.autoFilter = { from: "A4", to: `K${Math.max(4, sheet.rowCount)}` };
}

export async function buildGexDemoWorkbook(rows: GexDemoRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SpecialStock";
  workbook.subject = "Undated GEX sample preview";
  const all = rows.flatMap(scenarios);
  addSheet(workbook, "Unified Master Table", all, "Sample cascade / halt");
  addSheet(workbook, "Call Wall Focus", all.filter((row) => row.scenario === "Call breakout" || row.scenario === "Ceiling fade"), "Hedging cascade begins");
  addSheet(workbook, "Put Wall Focus", all.filter((row) => row.scenario === "Put bounce" || row.scenario === "Put breakdown"), "Hedging cascade halts");
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const liveHeaders = ["Symbol", "Expiration", "Schwab spot", "Chart last", "GEX flip", "Call wall", "Put wall", "Activity call wall", "Activity put wall", "VWAP", "Keltner upper", "Keltner middle", "Keltner lower", "Expected move", "Trade direction", "Trade entry (5-min zone)", "Trade target", "Trade stop loss", "Calculated at"];

function liveNumber(value: number | null | undefined) { return value ?? null; }

function addLiveSheet(workbook: ExcelJS.Workbook, name: "Call Wall" | "Put Wall", rows: GexLiveRow[], category: GexCategory, runAt: Date) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] });
  sheet.addRow([`${name} — latest saved ${category} GEX analysis`]);
  sheet.addRow([`Run completed: ${runAt.toISOString()}. This file uses saved results and does not recalculate market data.`]);
  sheet.addRow(["Chart values and trade levels are blank when the original live run could not read the required chart evidence."]);
  sheet.addRow(liveHeaders);
  for (const row of rows) {
    const values = row.chart?.values;
    const levels = row.levels;
    const call = name === "Call Wall";
    const entry = call ? levels?.callEntry : levels?.putEntry;
    const target = call ? levels?.callTarget : levels?.putTarget;
    const stop = call ? levels?.callStop : levels?.putStop;
    sheet.addRow([
      row.symbol, row.expiration, row.underlyingPrice, liveNumber(values?.readable ? values.lastPrice : null), row.gexFlip, row.callWall, row.putWall,
      row.activityCallWall, row.activityPutWall, liveNumber(values?.readable ? values.vwap : null), liveNumber(values?.readable ? values.keltnerUpper : null),
      liveNumber(values?.readable ? values.keltnerMiddle : null), liveNumber(values?.readable ? values.keltnerLower : null), row.expectedMove,
      call ? "Call-side setup" : "Put-side setup", liveNumber(entry), liveNumber(target), liveNumber(stop), row.calculatedAt,
    ]);
  }
  sheet.columns = [
    { width: 13 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 18 },
    { width: 14 }, { width: 17 }, { width: 18 }, { width: 17 }, { width: 16 }, { width: 20 }, { width: 24 }, { width: 16 }, { width: 18 }, { width: 25 },
  ];
  sheet.getRow(1).font = { bold: true, size: 15, color: { argb: "FF173724" } };
  sheet.getRow(2).font = { italic: true, color: { argb: "FF50645A" } };
  sheet.getRow(3).font = { italic: true, color: { argb: "FF50645A" } };
  const header = sheet.getRow(4);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173724" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 34;
  for (let index = 5; index <= sheet.rowCount; index += 1) {
    const excelRow = sheet.getRow(index);
    for (let column = 3; column <= 18; column += 1) {
      if (column !== 15) {
        excelRow.getCell(column).numFmt = "#,##0.00";
        excelRow.getCell(column).alignment = { horizontal: "right", vertical: "middle" };
      }
    }
    if (index % 2 === 0) excelRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6F3" } };
  }
  sheet.autoFilter = { from: "A4", to: `S${Math.max(4, sheet.rowCount)}` };
}

export async function buildGexLiveWorkbook(rows: GexLiveRow[], category: GexCategory, runAt: Date): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SpecialStock";
  workbook.subject = `Latest saved ${category} GEX analysis`;
  addLiveSheet(workbook, "Call Wall", rows, category, runAt);
  addLiveSheet(workbook, "Put Wall", rows, category, runAt);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
