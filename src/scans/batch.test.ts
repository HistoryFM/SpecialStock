import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_WATCHLIST } from "@/models/catalog";

const mocks = vi.hoisted(() => ({
  runScan: vi.fn(),
  captureException: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  logger: { info: mocks.info },
  startSpan: vi.fn(async (_options, callback) => callback({
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
  })),
}));

vi.mock("@/scans/service", () => ({
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
        where: async () => [{ watchlist: DEFAULT_WATCHLIST }],
      }),
    }),
  })),
}));

import { runScheduledBatch } from "@/scans/batch";

describe("scheduled scan batch", () => {
  beforeEach(() => {
    mocks.runScan.mockReset();
    mocks.captureException.mockReset();
    mocks.info.mockReset();
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
  });
});
