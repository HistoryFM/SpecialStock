import "server-only";

import ExcelJS from "exceljs";

import { swingWatchlistEntrySchema, type SwingWatchlistEntry } from "@/swing/types";

export const SWING_WATCHLIST_MAX_BYTES = 5 * 1024 * 1024;

export class SwingWatchlistValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("\n"));
    this.name = "SwingWatchlistValidationError";
  }
}

function csvFields(line: string): string[] {
  const output: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { output.push(value.trim()); value = ""; }
    else value += character;
  }
  if (quoted) throw new SwingWatchlistValidationError(["CSV contains an unclosed quoted field."]);
  output.push(value.trim());
  return output;
}

function normalizeExchange(value: string): string {
  const normalized = value.trim().toUpperCase().replaceAll(/\s+/g, " ");
  return normalized === "NYSE AMERICAN" ? "AMEX" : normalized;
}

export function validateSwingWatchlistRows(rows: Array<Record<string, unknown>>): SwingWatchlistEntry[] {
  const issues: string[] = [];
  if (rows.length < 1 || rows.length > 20) issues.push("The watchlist must contain 1–20 data rows.");
  const seen = new Set<string>();
  const entries = rows.flatMap((row, position) => {
    const candidate = {
      stockName: String(row["stock name"] ?? "").trim(),
      symbol: String(row.symbol ?? "").trim(),
      exchange: normalizeExchange(String(row.exchange ?? "")),
      position,
    };
    const parsed = swingWatchlistEntrySchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((issue) => `Row ${position + 2}: ${String(issue.path.at(-1) ?? "value")} ${issue.message}.`));
      return [];
    }
    if (seen.has(parsed.data.symbol)) issues.push(`Row ${position + 2}: duplicate symbol ${parsed.data.symbol}.`);
    seen.add(parsed.data.symbol);
    return [parsed.data];
  });
  if (issues.length) throw new SwingWatchlistValidationError(issues);
  return entries;
}

export function parseSwingWatchlistCsv(content: string): SwingWatchlistEntry[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new SwingWatchlistValidationError(["CSV needs a header and at least one data row."]);
  const header = csvFields(lines[0]).map((value) => value.trim().toLowerCase());
  const required = ["stock name", "symbol", "exchange"];
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length) throw new SwingWatchlistValidationError([`Missing required header(s): ${missing.join(", ")}.`]);
  if (new Set(header).size !== header.length) throw new SwingWatchlistValidationError(["CSV contains duplicate headers."]);
  const rows = lines.slice(1).map((line, index) => {
    const values = csvFields(line);
    if (values.length !== header.length) throw new SwingWatchlistValidationError([`Row ${index + 2}: wrong number of columns.`]);
    return Object.fromEntries(header.map((name, column) => [name, values[column]]));
  });
  return validateSwingWatchlistRows(rows);
}

export async function parseSwingWatchlistXlsx(content: Buffer): Promise<SwingWatchlistEntry[]> {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(Uint8Array.from(content).buffer); }
  catch { throw new SwingWatchlistValidationError(["XLSX could not be read as a valid Excel workbook."]); }

  const populated = workbook.worksheets.flatMap((worksheet) => {
    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.from({ length: Math.max(row.cellCount, row.actualCellCount) }, (_, index) => row.getCell(index + 1).text.trim());
      while (values.at(-1) === "") values.pop();
      if (values.some(Boolean)) rows.push(values);
    });
    return rows.length ? [{ name: worksheet.name, rows }] : [];
  });
  if (populated.length !== 1) {
    throw new SwingWatchlistValidationError([
      populated.length ? "XLSX must contain exactly one populated worksheet." : "XLSX needs one populated worksheet with a header and at least one data row.",
    ]);
  }

  const rows = populated[0]!.rows;
  if (rows.length < 2) throw new SwingWatchlistValidationError(["XLSX needs a header and at least one data row."]);
  const header = rows[0]!.map((value) => value.toLowerCase());
  const required = ["stock name", "symbol", "exchange"];
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length) throw new SwingWatchlistValidationError([`Missing required header(s): ${missing.join(", ")}.`]);
  if (new Set(header).size !== header.length) throw new SwingWatchlistValidationError(["XLSX contains duplicate headers."]);

  const records = rows.slice(1).map((values, index) => {
    if (values.length > header.length) throw new SwingWatchlistValidationError([`Row ${index + 2}: contains data outside the declared headers.`]);
    return Object.fromEntries(header.map((name, column) => [name, values[column] ?? ""]));
  });
  return validateSwingWatchlistRows(records);
}
