import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_WATCHLIST } from "@/models/catalog";

const mocks = vi.hoisted(() => ({
  runScan: vi.fn(),
  captureException: vi.fn(),
  info: vi.fn(),
  spans: [] as Array<{ options: { op?: string }; span: { setAttribute: ReturnType<typeof vi.fn>; setAttributes: ReturnType<typeof vi.fn>; setStatus: ReturnType<typeof vi.fn> } }>,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  logger: { info: mocks.info },
  startSpan: vi.fn(async (options, callback) => {
    const span = { setAttribute: vi.fn(), setAttributes: vi.fn(), setStatus: vi.fn() };
    mocks.spans.push({ options, span });
    return callback(span);
  }),
}));

vi.mock("@/scans/service", () => ({
  ScanAlreadyRunningError: class ScanAlreadyRunningError extends Error {},
  runScan: mocks.runScan,
}));

vi.mock("@/analysis/prompt-revisions", () => ({
  getActivePromptRevision: vi.fn(async () => ({ id: "compact-revision", phase: "compact", revisionNumber: 1, instructions: "default", templateVersion: "chart-compact-v2", instructionsHash: "hash" })),
}));

const session = {
  date: "2026-09-03",
  opensAt: new Date("2026-09-03T13:30:00.000Z"),
  closesAt: new Date("2026-09-03T20:00:00.000Z"),
  isRegularSession: true,
  quality: { provider: "demo", feed: "demo", observedAt: new Date(), flags: [] },
};

vi.mock("@/market-data/factory", () => ({
  createMarketDataProvider: () => ({ getSession: vi.fn(async () => session) }),
}));

vi.mock("@/db/client", () => ({
  getDatabase: vi.fn(async () => ({
    insert: () => ({ values: () => ({
      onConflictDoNothing: async () => undefined,
      onConflictDoUpdate: () => ({ returning: async () => [{ id: "manual-group" }] }),
    }) }),
    select: () => ({ from: () => ({ where: async () => [{ watchlist: DEFAULT_WATCHLIST }] }) }),
  })),
}));

import { runManualBatch } from "@/scans/manual-batch";
import { ScanAlreadyRunningError } from "@/scans/service";

describe("manual scan batch", () => {
  beforeEach(() => {
    mocks.runScan.mockReset();
    mocks.captureException.mockReset();
    mocks.info.mockReset();
    mocks.spans.length = 0;
  });

  it("starts siblings concurrently, forwards idempotency and preserves partial outcomes", async () => {
    const timeframes = ["1m", "5m", "10m"];
    const starts: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.runScan.mockImplementation(async (input: { symbol: string; timeframe: string }) => {
      starts.push(input.timeframe);
      if (starts.length === timeframes.length) release?.();
      await gate;
      if (input.timeframe === "10m") throw new Error("provider failed");
      if (input.timeframe === "5m") throw new ScanAlreadyRunningError("AAPL 5m is busy");
      return { slotId: "slot-AAPL", analysisId: "analysis-AAPL", status: "completed", reused: false };
    });

    const result = await runManualBatch({
      runs: [
        { symbol: "AAPL", timeframe: "1m" },
        { symbol: "AAPL", timeframe: "5m" },
        { symbol: "AAPL", timeframe: "10m" },
      ],
      requestId: "55c30fd4-8adb-4982-97df-8bdbecead050",
      now: new Date("2026-09-03T14:02:00.000Z"),
    });

    expect(starts).toEqual(timeframes);
    expect(mocks.runScan).toHaveBeenCalledTimes(3);
    expect(mocks.runScan).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "AAPL",
      timeframe: "1m",
      manualRequestId: "55c30fd4-8adb-4982-97df-8bdbecead050",
      resolvedSession: session,
      manualScanGroupId: "manual-group",
      promptRevision: expect.objectContaining({ id: "compact-revision" }),
    }));
    expect(mocks.runScan).toHaveBeenCalledWith(expect.objectContaining({ symbol: "AAPL", timeframe: "5m" }));
    expect(mocks.runScan).toHaveBeenCalledWith(expect.objectContaining({ symbol: "AAPL", timeframe: "10m" }));
    expect(result.counts).toEqual({ completed: 1, reused: 0, alreadyRunning: 1, failed: 1 });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: "AAPL", timeframe: "1m", outcome: "completed" }),
      expect.objectContaining({ symbol: "AAPL", timeframe: "5m", outcome: "already_running" }),
      expect.objectContaining({ symbol: "AAPL", timeframe: "10m", outcome: "failed" }),
    ]));
    const batchSpan = mocks.spans.find(({ options }) => options.op === "specialstock.scan.manual_batch");
    expect(batchSpan?.span.setAttributes).toHaveBeenCalledWith(expect.objectContaining({
      "specialstock.scan.batch_peak_in_flight": 3,
    }));
    expect(mocks.info).toHaveBeenCalledWith("scan.manual_batch.started", expect.objectContaining({
      "specialstock.scan.batch_interval_profile": "mixed",
      "specialstock.scan.batch_interval_1m": 1,
      "specialstock.scan.batch_interval_5m": 1,
      "specialstock.scan.batch_interval_10m": 1,
    }));
  });
});
