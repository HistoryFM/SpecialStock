import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SavedRun } from "./types";

describe.sequential("backtesting strategy storage", () => {
  let root: string;
  let storage: typeof import("./storage");
  const originalDatabasePath = process.env.LOCAL_DATABASE_PATH;
  const originalIsolation = process.env.SPECIALSTOCK_E2E_ISOLATED;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "specialstock-e2e-strategies-"));
    process.env.LOCAL_DATABASE_PATH = join(root, "database");
    process.env.SPECIALSTOCK_E2E_ISOLATED = "1";
    vi.resetModules();
    storage = await import("./storage");
  });

  afterAll(async () => {
    if (originalDatabasePath === undefined) delete process.env.LOCAL_DATABASE_PATH; else process.env.LOCAL_DATABASE_PATH = originalDatabasePath;
    if (originalIsolation === undefined) delete process.env.SPECIALSTOCK_E2E_ISOLATED; else process.env.SPECIALSTOCK_E2E_ISOLATED = originalIsolation;
    await rm(root, { recursive: true, force: true });
  });

  it("seeds TQQQ-Daily and rejects case-insensitive duplicate names", async () => {
    const initial = await storage.listBacktestStrategies();
    expect(initial.strategies).toEqual([expect.objectContaining({ id: storage.DEFAULT_BACKTEST_STRATEGY_ID, name: "TQQQ-Daily" })]);
    await expect(storage.createBacktestStrategy(" tqqq-daily ")).rejects.toThrow("already exists");
  });

  it("normalizes legacy runs into the default strategy without rewriting their source file", async () => {
    const runsDir = join(root, "backtesting", "runs");
    await mkdir(runsDir, { recursive: true });
    const run = sampleRun("11111111-1111-4111-8111-111111111111");
    const path = join(runsDir, `${run.id}.json`);
    await writeFile(path, JSON.stringify(run));
    const loaded = await storage.getRun(run.id);
    expect(loaded?.strategyId).toBe(storage.DEFAULT_BACKTEST_STRATEGY_ID);
    expect(JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(path, "utf8"))).strategyId).toBeUndefined();
    await expect(storage.listRunSummaries()).resolves.toEqual([expect.objectContaining({ strategyId: storage.DEFAULT_BACKTEST_STRATEGY_ID, strategyName: "TQQQ-Daily" })]);
  });

  it("tags new runs to a named strategy and rejects unknown identifiers", async () => {
    const strategy = await storage.createBacktestStrategy("Second strategy");
    const run = { ...sampleRun("22222222-2222-4222-8222-222222222222"), strategyId: strategy.id };
    await storage.saveRun(run);
    expect((await storage.getRun(run.id))?.strategyId).toBe(strategy.id);
    expect((await storage.listRunSummaries()).find((item) => item.id === run.id)).toMatchObject({ strategyId: strategy.id, strategyName: "Second strategy" });
    await expect(storage.resolveBacktestStrategyId("33333333-3333-4333-8333-333333333333")).rejects.toThrow("not found");
  });
});

function sampleRun(id: string): SavedRun {
  return {
    id, createdAt: "2026-01-02T00:00:00.000Z", commentaries: [],
    input: { longTicker: "TQQQ", comparisons: [], mode: "cash", startingCapital: 1000, cashRate: 0, slippage: 0, fee: 0,
      prompt: "Test strategy", model: "google/gemini-2.5-pro", strategy: { entry: [{ kind: "price_sma", period: 50, relation: "crosses_above" }], exit: [{ kind: "price_sma", period: 50, relation: "crosses_below" }], rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, macdFast: 12, macdSlow: 26, macdSignal: 9 } },
    result: { startDate: "2025-01-02", endDate: "2025-01-03", dates: ["2025-01-02", "2025-01-03"], fileIds: {}, warnings: [], trades: [], annual: [{ year: "2025", returns: { Strategy: 1 } }], series: [{ ticker: "Strategy", values: [1000, 1010] }], drawdowns: [{ ticker: "Strategy", percent: -1, peakDate: "2025-01-02", troughDate: "2025-01-03" }] },
  };
}
