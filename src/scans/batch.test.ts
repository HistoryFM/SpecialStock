import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_WATCHLIST } from "@/models/catalog";

const mocks = vi.hoisted(() => ({
  runScan: vi.fn(),
  captureException: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  spans: [] as Array<{
    options: { name: string; op?: string };
    span: { setAttribute: ReturnType<typeof vi.fn>; setAttributes: ReturnType<typeof vi.fn>; setStatus: ReturnType<typeof vi.fn> };
  }>,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  logger: { info: mocks.info, warn: mocks.warn },
  startSpan: vi.fn(async (options, callback) => {
    const span = { setAttribute: vi.fn(), setAttributes: vi.fn(), setStatus: vi.fn() };
    mocks.spans.push({ options, span });
    return callback(span);
  }),
}));

vi.mock("@/scans/service", () => ({
  ScanAlreadyRunningError: class ScanAlreadyRunningError extends Error {},
  ScanNotAvailableError: class ScanNotAvailableError extends Error {},
  runScan: mocks.runScan,
}));

const session = {
  date: "2026-09-01",
  opensAt: new Date("2026-09-01T13:30:00.000Z"),
  closesAt: new Date("2026-09-01T20:00:00.000Z"),
  isRegularSession: true,
  quality: { provider: "demo", feed: "demo", observedAt: new Date(), flags: [] },
};

vi.mock("@/market-data/factory", () => ({
  createMarketDataProvider: () => ({ getSession: vi.fn(async () => session) }),
}));

vi.mock("@/db/client", () => ({
  getDatabase: vi.fn(async () => ({
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    select: () => ({
      from: () => ({
        where: async () => [{ watchlist: DEFAULT_WATCHLIST, updatedAt: new Date("2026-09-01T13:59:00.000Z") }],
      }),
    }),
  })),
}));

import { runScheduledBatch } from "@/scans/batch";
import { ScanAlreadyRunningError } from "@/scans/service";

describe("scheduled scan batch", () => {
  beforeEach(() => {
    mocks.runScan.mockReset();
    mocks.captureException.mockReset();
    mocks.info.mockReset();
    mocks.warn.mockReset();
    mocks.spans.length = 0;
  });

  it("starts all 20 scans before settling and preserves successful siblings", async () => {
    const starts: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.runScan.mockImplementation(async ({ symbol }: { symbol: string }) => {
      starts.push(symbol);
      if (starts.length === DEFAULT_WATCHLIST.length) release?.();
      await gate;
      if (symbol === "MSFT") throw new Error("provider failed");
      return { slotId: `slot-${symbol}`, analysisId: `analysis-${symbol}`, status: "completed", reused: false };
    });

    const result = await runScheduledBatch(
      "postclose:2026-09-01T14:00:00.000Z",
      new Date("2026-09-01T14:05:20.000Z"),
    );

    expect(starts).toEqual(DEFAULT_WATCHLIST.map((entry) => entry.symbol));
    expect(result.counts).toEqual({
      completed: 19,
      alreadyCompleted: 0,
      alreadyRunning: 0,
      terminalFailed: 0,
      failed: 1,
    });
    expect(result.results.find((entry) => entry.symbol === "MSFT")).toMatchObject({
      outcome: "failed",
      error: "provider failed",
    });
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.spans.filter(({ options }) => options.op === "specialstock.scan.batch.item")).toHaveLength(20);
    const batchSpan = mocks.spans.find(({ options }) => options.op === "specialstock.scan.batch");
    expect(batchSpan?.span.setAttributes).toHaveBeenCalledWith(expect.objectContaining({
      "specialstock.scan.batch_peak_in_flight": 20,
      "specialstock.scan.batch_outcomes": expect.stringContaining("MSFT:failed"),
    }));
    expect(mocks.warn).toHaveBeenCalledWith(
      "scan.batch.completed_with_failures",
      expect.objectContaining({
        "specialstock.scan.batch_peak_in_flight": 20,
        "specialstock.scan.batch_outcomes": expect.stringContaining("MSFT:failed"),
      }),
    );
  });

  it("reports a manual collision as retryable without failing completed siblings", async () => {
    mocks.runScan.mockImplementation(async ({ symbol, mode, timeframe }: { symbol: string; mode: string; timeframe?: string }) => {
      expect(mode).toBe("scheduled");
      expect(timeframe).toBeUndefined();
      if (symbol === "MSFT") throw new ScanAlreadyRunningError("MSFT already has a scan in progress.");
      return { slotId: `slot-${symbol}`, analysisId: `analysis-${symbol}`, status: "completed", reused: false };
    });

    const result = await runScheduledBatch(
      "postclose:2026-09-01T14:00:00.000Z",
      new Date("2026-09-01T14:05:20.000Z"),
    );

    expect(result.counts).toEqual({
      completed: 19,
      alreadyCompleted: 0,
      alreadyRunning: 1,
      terminalFailed: 0,
      failed: 0,
    });
    expect(result.results.find((entry) => entry.symbol === "MSFT")).toMatchObject({
      outcome: "already_running",
    });
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});
