import type { PriceRow } from "./types";

function fields(line: string): string[] {
  const output: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const character = line[i];
    if (character === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { output.push(value.trim()); value = ""; }
    else value += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  output.push(value.trim());
  return output;
}

function parseDate(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Invalid CSV date: ${value}`);
  const date = new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])));
  if (date.getUTCFullYear() !== Number(match[3]) || date.getUTCMonth() + 1 !== Number(match[1]) || date.getUTCDate() !== Number(match[2])) throw new Error(`Invalid CSV date: ${value}`);
  return date.toISOString().slice(0, 10);
}

function number(value: string, required: boolean): number | null {
  const clean = value.replaceAll("$", "").replaceAll(",", "").trim();
  if (!required && (!clean || /^(?:N\/A|NA|--|NULL)$/i.test(clean))) return null;
  const parsed = Number(clean);
  if (!clean || !Number.isFinite(parsed) || (required && parsed <= 0) || (!required && parsed < 0)) throw new Error(`Invalid CSV price or volume: ${value}`);
  return parsed;
}

function skippedWeekdays(start: string, end: string): number {
  let count = 0;
  for (let time = Date.parse(start) + 86400000; time < Date.parse(end); time += 86400000) {
    const day = new Date(time).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export function parsePriceCsv(content: string): { rows: PriceRow[]; warnings: string[] } {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 3) throw new Error("CSV needs a header and at least two daily rows.");
  const header = fields(lines[0]).map((field) => field.toLowerCase());
  const column = (names: string[], required: boolean) => {
    const index = header.findIndex((field) => names.includes(field));
    if (required && index < 0) throw new Error(`CSV is missing ${names[0]}.`);
    return index;
  };
  const dateIndex = column(["date"], true);
  const closeIndex = column(["close/last", "close"], true);
  const openIndex = column(["open"], false);
  const highIndex = column(["high"], false);
  const lowIndex = column(["low"], false);
  const volumeIndex = column(["volume"], false);
  const seen = new Set<string>();
  const rows = lines.slice(1).map((line, lineNumber) => {
    const parts = fields(line);
    if (parts.length !== header.length) throw new Error(`CSV row ${lineNumber + 2} has the wrong number of columns.`);
    const date = parseDate(parts[dateIndex]);
    if (seen.has(date)) throw new Error(`CSV contains duplicate date ${date}.`);
    seen.add(date);
    return {
      date,
      close: number(parts[closeIndex], true)!,
      open: openIndex < 0 ? null : number(parts[openIndex], false),
      high: highIndex < 0 ? null : number(parts[highIndex], false),
      low: lowIndex < 0 ? null : number(parts[lowIndex], false),
      volume: volumeIndex < 0 ? null : number(parts[volumeIndex], false),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const warnings: string[] = [];
  warnings.push("Price returns only: dividends are not included.");
  const optionalMissing = rows.filter((row) => (openIndex >= 0 && row.open === null) || (highIndex >= 0 && row.high === null) || (lowIndex >= 0 && row.low === null) || (volumeIndex >= 0 && row.volume === null)).length;
  if (optionalMissing) warnings.push(`${optionalMissing} row(s) have missing optional OHLC or volume values.`);
  if (rows.some((row) => { const day = new Date(`${row.date}T00:00:00Z`).getUTCDay(); return day === 0 || day === 6; })) warnings.push("Weekend dates found; confirm that each row represents an actual trading session.");
  if (rows.some((row, index) => index > 0 && skippedWeekdays(rows[index - 1].date, row.date) >= 2)) warnings.push("Long weekday gap found; check whether market closures or missing sessions explain it.");
  if (rows.some((row, index) => index > 0 && (row.close / rows[index - 1].close > 1.8 || row.close / rows[index - 1].close < 0.55))) warnings.push("Large price jump detected; verify split adjustment before relying on results.");
  return { rows, warnings };
}
