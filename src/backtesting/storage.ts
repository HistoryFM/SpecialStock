import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import { parsePriceCsv } from "./csv";
import { describePredicate, type PriceFile, type PriceRow, type SavedRun } from "./types";

const e2eDatabase = resolve(process.env.LOCAL_DATABASE_PATH ?? ".data/e2e");
const isolatedE2e = process.env.SPECIALSTOCK_E2E_ISOLATED === "1" && e2eDatabase.startsWith(`${resolve(tmpdir())}${sep}specialstock-e2e-`);
const root = isolatedE2e ? join(dirname(e2eDatabase), "backtesting") : resolve(process.cwd(), ".data", "backtesting");
const filesDir = join(root, "files");
const runsDir = join(root, "runs");

async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, path);
}

async function listJson(directory: string): Promise<string[]> {
  try { return (await readdir(directory)).filter((name) => name.endsWith(".json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export async function importPriceFile(input: { ticker: string; name: string; content: string; splitAdjustedConfirmed: boolean }): Promise<PriceFile> {
  if (!input.splitAdjustedConfirmed) throw new Error("Confirm that the historical close prices are split-adjusted.");
  if (Buffer.byteLength(input.content) > 10_000_000) throw new Error("CSV exceeds the 10 MB import limit.");
  const { rows, warnings } = parsePriceCsv(input.content);
  const id = createHash("sha256").update(input.ticker).update("\0").update(input.content).digest("hex");
  const metadata: PriceFile = {
    id, ticker: input.ticker, name: input.name.slice(0, 180), uploadedAt: new Date().toISOString(),
    firstDate: rows[0].date, lastDate: rows.at(-1)!.date, rows: rows.length,
    splitAdjustedConfirmed: true, warnings,
  };
  await mkdir(filesDir, { recursive: true });
  const path = join(filesDir, `${id}.json`);
  try { return (JSON.parse(await readFile(path, "utf8")) as { metadata: PriceFile }).metadata; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await atomicJson(path, { metadata, rows });
  return metadata;
}

export async function listPriceFiles(): Promise<PriceFile[]> {
  const names = await listJson(filesDir);
  const files = await Promise.all(names.map(async (name) => (JSON.parse(await readFile(join(filesDir, name), "utf8")) as { metadata: PriceFile }).metadata));
  return files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function loadLatestPriceFiles(tickers: string[]): Promise<Record<string, { id: string; rows: PriceRow[] }>> {
  const latest = new Map<string, PriceFile>();
  for (const file of await listPriceFiles()) if (tickers.includes(file.ticker) && !latest.has(file.ticker)) latest.set(file.ticker, file);
  const output: Record<string, { id: string; rows: PriceRow[] }> = {};
  for (const [ticker, file] of latest) {
    const parsed = JSON.parse(await readFile(join(filesDir, `${file.id}.json`), "utf8")) as { rows: PriceRow[] };
    output[ticker] = { id: file.id, rows: parsed.rows };
  }
  return output;
}

export async function loadPriceFilesById(ids: Record<string, string>): Promise<Record<string, { id: string; rows: PriceRow[] }>> {
  const output: Record<string, { id: string; rows: PriceRow[] }> = {};
  for (const [ticker, id] of Object.entries(ids)) {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("Saved price file identifier is invalid.");
    const parsed = JSON.parse(await readFile(join(filesDir, `${id}.json`), "utf8")) as { metadata: PriceFile; rows: PriceRow[] };
    if (parsed.metadata.ticker !== ticker) throw new Error("Saved price file ticker does not match.");
    output[ticker] = { id, rows: parsed.rows };
  }
  return output;
}

export async function listRunSummaries(): Promise<Array<{ id: string; createdAt: string; longTicker: string; mode: string; model: string; startDate: string; endDate: string; entryRule: string; exitRule: string }>> {
  const names = await listJson(runsDir);
  const runs = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(runsDir, name), "utf8")) as SavedRun));
  return runs.map((run) => ({ id: run.id, createdAt: run.createdAt, longTicker: run.input.longTicker, mode: run.input.mode, model: run.input.model, startDate: run.result.startDate, endDate: run.result.endDate,
    entryRule: run.input.strategy.entry.map(describePredicate).join(" AND "), exitRule: run.input.strategy.exit.map(describePredicate).join(" AND ") })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveRun(run: SavedRun): Promise<void> {
  await mkdir(runsDir, { recursive: true });
  await atomicJson(join(runsDir, `${run.id}.json`), run);
}

export async function getRun(id: string): Promise<SavedRun | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  try { return JSON.parse(await readFile(join(runsDir, `${id}.json`), "utf8")) as SavedRun; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
