import "server-only";

import ExcelJS from "exceljs";

import { SWING_MARKET_CONFIG, SWING_WATCHLIST_MAX_ENTRIES, swingWatchlistCandidateSchema, swingWatchlistEntrySchema, type SwingMarket, type SwingWatchlistCandidate, type SwingWatchlistEntry } from "@/swing/types";

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
  if (normalized === "NYSE AMERICAN") return "AMEX";
  if (["NATIONAL STOCK EXCHANGE", "NATIONAL STOCK EXCHANGE OF INDIA"].includes(normalized)) return "NSE";
  if (["BOMBAY STOCK EXCHANGE", "BSE LIMITED"].includes(normalized)) return "BSE";
  return normalized;
}

export function validateSwingWatchlistSourceRows(rows: Array<Record<string, unknown>>, market: SwingMarket = "US"): SwingWatchlistCandidate[] {
  const issues: string[] = [];
  if (rows.length < 1) issues.push("The watchlist must contain at least one data row.");
  const seen = new Set<string>();
  const entries = rows.flatMap((row, position) => {
    const candidate = {
      stockName: String(row["stock name"] ?? "").trim(),
      symbol: String(row.symbol ?? "").trim(),
      exchange: normalizeExchange(String(row.exchange ?? "")),
      industry: String(row.industry ?? "").trim(),
    };
    const parsed = swingWatchlistCandidateSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((issue) => `Row ${position + 2}: ${String(issue.path.at(-1) ?? "value")} ${issue.message}.`));
      return [];
    }
    if (!(SWING_MARKET_CONFIG[market].exchanges as readonly string[]).includes(parsed.data.exchange)) {
      issues.push(`Row ${position + 2}: exchange ${parsed.data.exchange} is not valid for ${market}.`);
      return [];
    }
    if (seen.has(parsed.data.symbol)) issues.push(`Row ${position + 2}: duplicate symbol ${parsed.data.symbol}.`);
    seen.add(parsed.data.symbol);
    return [parsed.data];
  });
  if (issues.length) throw new SwingWatchlistValidationError(issues);
  return entries;
}

export function selectSwingWatchlistEntries(candidates: SwingWatchlistCandidate[], selectedSymbols?: string[]): SwingWatchlistEntry[] {
  if (!selectedSymbols) {
    if (candidates.length > SWING_WATCHLIST_MAX_ENTRIES) {
      throw new SwingWatchlistValidationError([`The file contains ${candidates.length} valid data rows. Choose 1–${SWING_WATCHLIST_MAX_ENTRIES} stocks to activate.`]);
    }
    selectedSymbols = candidates.map((candidate) => candidate.symbol);
  }
  const normalized = selectedSymbols.map((symbol) => symbol.trim().toUpperCase());
  if (normalized.length < 1 || normalized.length > SWING_WATCHLIST_MAX_ENTRIES) throw new SwingWatchlistValidationError([`Choose 1–${SWING_WATCHLIST_MAX_ENTRIES} stocks to activate.`]);
  if (new Set(normalized).size !== normalized.length) throw new SwingWatchlistValidationError(["The selected stocks contain a duplicate symbol."]);
  const selected = new Set(normalized);
  const entries = candidates.filter((candidate) => selected.has(candidate.symbol)).map((candidate, position) => swingWatchlistEntrySchema.parse({ ...candidate, position }));
  if (entries.length !== normalized.length) throw new SwingWatchlistValidationError(["One or more selected stocks are not present in the uploaded file."]);
  return entries;
}

export function validateSwingWatchlistRows(rows: Array<Record<string, unknown>>, market: SwingMarket = "US"): SwingWatchlistEntry[] {
  return selectSwingWatchlistEntries(validateSwingWatchlistSourceRows(rows, market));
}

export function parseSwingWatchlistCsvSource(content: string, market: SwingMarket = "US"): SwingWatchlistCandidate[] {
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
  return validateSwingWatchlistSourceRows(rows, market);
}

export function parseSwingWatchlistCsv(content: string, market: SwingMarket = "US"): SwingWatchlistEntry[] {
  return selectSwingWatchlistEntries(parseSwingWatchlistCsvSource(content, market));
}

export async function parseSwingWatchlistXlsxSource(content: Buffer, market: SwingMarket = "US"): Promise<SwingWatchlistCandidate[]> {
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
  return validateSwingWatchlistSourceRows(records, market);
}

export async function parseSwingWatchlistXlsx(content: Buffer, market: SwingMarket = "US"): Promise<SwingWatchlistEntry[]> {
  return selectSwingWatchlistEntries(await parseSwingWatchlistXlsxSource(content, market));
}
