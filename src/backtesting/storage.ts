import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import { parsePriceCsv } from "./csv";
import { describePredicate, type BacktestStrategy, type BacktestTimeframe, type PriceFile, type PriceRow } from "./types";
import { describeAllocations, isPlannedRun, type AnyRun } from "./plan";

const e2eDatabase = resolve(process.env.LOCAL_DATABASE_PATH ?? ".data/e2e");
const isolatedE2e = process.env.SPECIALSTOCK_E2E_ISOLATED === "1" && e2eDatabase.startsWith(`${resolve(tmpdir())}${sep}specialstock-e2e-`);
const root = isolatedE2e ? join(dirname(e2eDatabase), "backtesting") : resolve(process.cwd(), ".data", "backtesting");
const filesDir = join(root, "files");
const runsDir = join(root, "runs");
const strategiesPath = join(root, "strategies.json");
export const DEFAULT_BACKTEST_STRATEGY_ID = "00000000-0000-4000-8000-000000000001";
const defaultStrategy: BacktestStrategy = { id: DEFAULT_BACKTEST_STRATEGY_ID, name: "TQQQ-Daily", createdAt: "2026-01-01T00:00:00.000Z" };
type StrategyRegistry = { version: 1; strategies: BacktestStrategy[] };
let strategyMutation: Promise<unknown> = Promise.resolve();

async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, path);
}

async function listJson(directory: string): Promise<string[]> {
  try { return (await readdir(directory)).filter((name) => name.endsWith(".json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function readStrategyRegistry(): Promise<StrategyRegistry> {
  try {
    const parsed = JSON.parse(await readFile(strategiesPath, "utf8")) as StrategyRegistry;
    if (parsed.version !== 1 || !Array.isArray(parsed.strategies) || !parsed.strategies.some((strategy) => strategy.id === DEFAULT_BACKTEST_STRATEGY_ID)) {
      throw new Error("Backtesting strategy registry is invalid.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const registry: StrategyRegistry = { version: 1, strategies: [defaultStrategy] };
    await mkdir(root, { recursive: true });
    await atomicJson(strategiesPath, registry);
    return registry;
  }
}

export async function listBacktestStrategies(): Promise<{ strategies: BacktestStrategy[]; defaultStrategyId: string }> {
  const registry = await readStrategyRegistry();
  return { strategies: [...registry.strategies].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), defaultStrategyId: DEFAULT_BACKTEST_STRATEGY_ID };
}

export async function resolveBacktestStrategyId(strategyId?: string): Promise<string> {
  const id = strategyId ?? DEFAULT_BACKTEST_STRATEGY_ID;
  const registry = await readStrategyRegistry();
  if (!registry.strategies.some((strategy) => strategy.id === id)) throw new Error("Backtesting strategy was not found.");
  return id;
}

export async function createBacktestStrategy(name: string): Promise<BacktestStrategy> {
  const normalized = name.trim();
  if (!normalized || normalized.length > 80) throw new Error("Strategy name must contain 1–80 characters.");
  const operation = strategyMutation.then(async () => {
    const registry = await readStrategyRegistry();
    if (registry.strategies.some((strategy) => strategy.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
      throw new Error("A strategy with this name already exists.");
    }
    const strategy: BacktestStrategy = { id: randomUUID(), name: normalized, createdAt: new Date().toISOString() };
    await atomicJson(strategiesPath, { ...registry, strategies: [...registry.strategies, strategy] });
    return strategy;
  });
  strategyMutation = operation.then(() => undefined, () => undefined);
  return operation;
}

const normalizeFile = (file: Omit<PriceFile, "timeframe"> & { timeframe?: BacktestTimeframe }): PriceFile => ({ ...file, timeframe: file.timeframe ?? "daily" });

export async function importPriceFile(input: { ticker: string; name: string; content: string; timeframe: BacktestTimeframe; splitAdjustedConfirmed: boolean }): Promise<PriceFile> {
  if (!input.splitAdjustedConfirmed) throw new Error("Confirm that the historical close prices are split-adjusted.");
  if (Buffer.byteLength(input.content) > 10_000_000) throw new Error("CSV exceeds the 10 MB import limit.");
  const { rows, warnings } = parsePriceCsv(input.content, input.timeframe);
  const id = createHash("sha256").update(input.ticker).update("\0").update(input.timeframe).update("\0").update(input.content).digest("hex");
  const metadata: PriceFile = {
    id, ticker: input.ticker, name: input.name.slice(0, 180), uploadedAt: new Date().toISOString(),
    firstDate: rows[0].date, lastDate: rows.at(-1)!.date, rows: rows.length, timeframe: input.timeframe,
    splitAdjustedConfirmed: true, warnings,
  };
  await mkdir(filesDir, { recursive: true });
  const path = join(filesDir, `${id}.json`);
  try { return normalizeFile((JSON.parse(await readFile(path, "utf8")) as { metadata: PriceFile }).metadata); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await atomicJson(path, { metadata, rows });
  return metadata;
}

export async function listPriceFiles(): Promise<PriceFile[]> {
  const names = await listJson(filesDir);
  const files = await Promise.all(names.map(async (name) => normalizeFile((JSON.parse(await readFile(join(filesDir, name), "utf8")) as { metadata: PriceFile }).metadata)));
  return files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function loadLatestPriceFiles(tickers: string[], timeframe: BacktestTimeframe = "daily"): Promise<Record<string, { id: string; rows: PriceRow[] }>> {
  const latest = new Map<string, PriceFile>();
  for (const file of await listPriceFiles()) if (file.timeframe === timeframe && tickers.includes(file.ticker) && !latest.has(file.ticker)) latest.set(file.ticker, file);
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

export async function listRunSummaries(): Promise<Array<{ id: string; name: string; strategyId: string; strategyName: string; createdAt: string; longTicker: string; mode: string; model: string; timeframe: BacktestTimeframe; startDate: string; endDate: string; entryRule: string; exitRule: string; engineVersion: number; finalValue: number; maxDrawdown: number }>> {
  const names = await listJson(runsDir);
  const runs = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(runsDir, name), "utf8")) as AnyRun));
  const registry = await readStrategyRegistry();
  const strategyNames = new Map(registry.strategies.map((strategy) => [strategy.id, strategy.name]));
  return runs.map((run) => {
    const strategy = run.result.series.find((item) => item.ticker === "Strategy") ?? run.result.series[0];
    const drawdown = run.result.drawdowns.find((item) => item.ticker === "Strategy") ?? run.result.drawdowns[0];
    const timeframe = isPlannedRun(run) ? run.plan.settings.timeframe ?? "daily" : run.input.timeframe ?? "daily";
    const primary = isPlannedRun(run) ? run.plan.states.flatMap((state) => state.allocations.map((item) => item.ticker))[0] ?? "CASH" : run.input.longTicker;
    const strategyId = run.strategyId ?? DEFAULT_BACKTEST_STRATEGY_ID;
    const common = { id: run.id, name: run.name ?? `${primary} ${timeframe === "weekly" ? "weekly" : "daily"} strategy`, strategyId,
      strategyName: strategyNames.get(strategyId) ?? defaultStrategy.name, createdAt: run.createdAt, timeframe,
      finalValue: strategy.values.at(-1) ?? 0, maxDrawdown: drawdown?.percent ?? 0 };
    return isPlannedRun(run)
    ? { ...common, longTicker: primary, mode: "multi-asset", model: run.input.model,
      startDate: run.result.startDate, endDate: run.result.endDate, entryRule: run.plan.transitions.map((item) => `${item.from} → ${item.to}`).join(" · "),
      exitRule: run.plan.states.map((state) => `${state.label}: ${describeAllocations(state.allocations)}`).join(" · "), engineVersion: run.engineVersion }
    : { ...common, longTicker: run.input.longTicker, mode: run.input.mode, model: run.input.model, startDate: run.result.startDate, endDate: run.result.endDate,
      entryRule: run.input.strategy.entry.map(describePredicate).join(" AND "), exitRule: run.input.strategy.exit.map(describePredicate).join(" AND "), engineVersion: 1 };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveRun(run: AnyRun): Promise<void> {
  await mkdir(runsDir, { recursive: true });
  const strategyId = await resolveBacktestStrategyId(run.strategyId);
  await atomicJson(join(runsDir, `${run.id}.json`), { ...run, strategyId });
}

export async function getRun(id: string): Promise<AnyRun | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  try {
    const run = JSON.parse(await readFile(join(runsDir, `${id}.json`), "utf8")) as AnyRun;
    return { ...run, strategyId: await resolveBacktestStrategyId(run.strategyId) };
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function renameRun(id: string, name: string): Promise<AnyRun | null> {
  const run = await getRun(id);
  if (!run) return null;
  run.name = name;
  await saveRun(run);
  return run;
}

export async function deleteRun(id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  try { await unlink(join(runsDir, `${id}.json`)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
