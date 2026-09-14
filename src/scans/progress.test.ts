import { beforeEach, describe, expect, it, vi } from "vitest";

import { appSettings, manualScanGroups } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  groups: [] as Array<{ id: string; symbol: string; requestedIntervals: Array<"1m" | "5m" | "10m"> }>,
  slots: [] as Array<{ manualScanGroupId?: string; scanInterval?: string; symbol?: string; status: string }>,
  watchlist: [] as Array<{ symbol: string }>,
}));

vi.mock("@/db/client", () => ({
  getDatabase: async () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: async () => table === manualScanGroups ? mocks.groups : table === appSettings
          ? [{ watchlist: mocks.watchlist }] : mocks.slots,
      }),
    }),
  }),
}));

import { getManualBatchProgress, getScheduledBatchProgress } from "@/scans/progress";

beforeEach(() => {
  mocks.groups = [];
  mocks.slots = [];
  mocks.watchlist = [];
});

describe("batch progress", () => {
  it("reports each of 16 manual jobs, including unclaimed, running, completed, and failed siblings", async () => {
    mocks.groups = Array.from({ length: 16 }, (_, index) => ({
      id: `group-${index}`, symbol: `STOCK${index}`, requestedIntervals: ["5m"],
    }));
    mocks.slots = [
      { manualScanGroupId: "group-0", scanInterval: "5m", status: "completed" },
      { manualScanGroupId: "group-1", scanInterval: "5m", status: "running" },
      { manualScanGroupId: "group-2", scanInterval: "5m", status: "failed" },
      { manualScanGroupId: "group-3", scanInterval: "5m", status: "skipped" },
    ];
    const progress = await getManualBatchProgress("6c61da59-55f5-4cb1-8fe1-00fb5b63fc22");
    expect(progress).toHaveLength(16);
    expect(progress.slice(0, 5).map((item) => item.status)).toEqual([
      "completed", "running", "failed", "failed", "pending",
    ]);
  });

  it("uses scheduled slot keys for 20 configured symbols without treating missing slots as completed", async () => {
    mocks.watchlist = Array.from({ length: 20 }, (_, index) => ({ symbol: `STOCK${index}` }));
    mocks.slots = [{ symbol: "STOCK0", status: "completed" }, { symbol: "STOCK1", status: "running" }];
    const progress = await getScheduledBatchProgress("postclose:2026-09-14T14:00:00.000Z");
    expect(progress).toHaveLength(20);
    expect(progress.slice(0, 3).map((item) => item.status)).toEqual(["completed", "running", "pending"]);
    expect(progress.every((item) => item.timeframe === "5m")).toBe(true);
  });
});
