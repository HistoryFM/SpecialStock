import "server-only";

import ExcelJS from "exceljs";

export const GEX_MAX_SYMBOLS = 100;
export const GEX_MAX_UPLOAD_BYTES = 1024 * 1024;

export type GexParsedWatchlist = { symbols: string[]; rejected: string[]; duplicates: number };

export class GexWatchlistError extends Error {}

function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { fields.push(field.trim()); field = ""; }
    else field += character;
  }
  if (quoted) throw new GexWatchlistError("CSV contains an unclosed quoted field.");
  fields.push(field.trim());
  return fields;
}

function selectSymbolColumn(rows: string[][], fileType: "csv" | "xlsx") {
  if (!rows.length) throw new GexWatchlistError("The file does not contain any symbols.");
  const header = rows[0]!.map((cell) => cell.trim().toLowerCase());
  const symbolColumn = header.findIndex((cell) => ["symbol", "ticker", "stock"].includes(cell));
  if (symbolColumn >= 0) return rows.slice(1).map((row) => row[symbolColumn] ?? "");
  if (rows.some((row) => row.length > 1)) throw new GexWatchlistError(`${fileType.toUpperCase()} files with multiple columns need a Symbol, Ticker, or Stock header.`);
  // Spreadsheet-style uploads always reserve their first row for a heading,
  // even when that heading uses a custom label. This prevents labels such as
  // "STOCK" from being saved and submitted to Schwab as a ticker.
  return rows.slice(1).map((row) => row[0] ?? "");
}

export function normalizeGexSymbols(raw: string[]): GexParsedWatchlist {
  const symbols: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const [index, value] of raw.entries()) {
    const symbol = value.trim().toUpperCase();
    if (!symbol) continue;
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) { rejected.push(`Item ${index + 1}: invalid symbol ${value.slice(0, 30)}.`); continue; }
    if (seen.has(symbol)) { duplicates += 1; continue; }
    seen.add(symbol);
    symbols.push(symbol);
  }
  if (!symbols.length) throw new GexWatchlistError("The file does not contain a valid symbol.");
  if (symbols.length > GEX_MAX_SYMBOLS) throw new GexWatchlistError(`Choose no more than ${GEX_MAX_SYMBOLS} unique symbols.`);
  return { symbols, rejected, duplicates };
}

export async function parseGexWatchlistFile(filename: string, content: Buffer): Promise<GexParsedWatchlist> {
  if (content.length > GEX_MAX_UPLOAD_BYTES) throw new GexWatchlistError("GEX list files must be 1 MB or smaller.");
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension === "txt") return normalizeGexSymbols(content.toString("utf8").replace(/^\uFEFF/, "").split(/[\s,;]+/));
  if (extension === "csv") {
    const rows = content.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).map(csvFields);
    return normalizeGexSymbols(selectSymbolColumn(rows, "csv"));
  }
  if (extension === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(Uint8Array.from(content).buffer); }
    catch { throw new GexWatchlistError("XLSX could not be read as a valid workbook."); }
    const populated = workbook.worksheets.map((sheet) => {
      const rows: string[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = Array.from({ length: Math.max(row.cellCount, row.actualCellCount) }, (_, index) => row.getCell(index + 1).text.trim());
        while (values.at(-1) === "") values.pop();
        if (values.some(Boolean)) rows.push(values);
      });
      return rows;
    }).filter((rows) => rows.length);
    if (populated.length !== 1) throw new GexWatchlistError("XLSX must contain exactly one populated worksheet.");
    return normalizeGexSymbols(selectSymbolColumn(populated[0]!, "xlsx"));
  }
  throw new GexWatchlistError("Choose a CSV, TXT, or XLSX file.");
}
