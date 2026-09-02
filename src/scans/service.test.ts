import { describe, expect, it } from "vitest";

import type { MarketDataProvider, MarketSession } from "@/market-data/provider";
import { chartRangeForTest, resolveChartCaptureWindowForTest } from "@/scans/service";

describe("Chart-Img capture range", () => {
  const session = {
    date: "2026-08-28",
    opensAt: new Date("2026-08-28T13:30:00.000Z"),
    closesAt: new Date("2026-08-28T20:00:00.000Z"),
    isRegularSession: true,
  };

  it("uses only the current regular session during market hours", () => {
    expect(chartRangeForTest(new Date("2026-08-28T17:12:00.000Z"), session)).toEqual({
      from: new Date("2026-08-28T13:30:00.000Z"),
      to: new Date("2026-08-28T17:12:00.000Z"),
    });
  });

  it("uses the completed current session after the close", () => {
    expect(chartRangeForTest(new Date("2026-08-28T21:00:00.000Z"), session)).toEqual({
      from: new Date("2026-08-28T13:30:00.000Z"),
      to: new Date("2026-08-28T20:00:00.000Z"),
    });
  });

  it("ends a scheduled capture at the completed candle instead of the current partial candle", () => {
    expect(chartRangeForTest(
      new Date("2026-08-28T13:35:20.000Z"),
      session,
      new Date("2026-08-28T13:35:00.000Z"),
    )).toEqual({
      from: new Date("2026-08-28T13:30:00.000Z"),
      to: new Date("2026-08-28T13:35:00.000Z"),
    });
  });

  it("uses the previous actual session before the first five-minute bar", async () => {
    const previous: MarketSession = {
      date: "2026-08-27",
      opensAt: new Date("2026-08-27T13:30:00.000Z"),
      closesAt: new Date("2026-08-27T20:00:00.000Z"),
      isRegularSession: true,
      quality: { provider: "demo", feed: "demo", observedAt: new Date(), flags: [] },
    };
    const marketProvider = {
      getPreviousRegularSession: async () => previous,
    } as unknown as MarketDataProvider;

    await expect(resolveChartCaptureWindowForTest({
      now: new Date("2026-08-28T13:32:00.000Z"),
      session: { ...session, quality: previous.quality },
      mode: "manual",
      marketProvider,
    })).resolves.toEqual({
      range: { from: previous.opensAt, to: previous.closesAt },
      barStatus: "closed",
    });
  });

  it("uses the current session once a complete five-minute bar exists", async () => {
    const marketProvider = {
      getPreviousRegularSession: async () => { throw new Error("should not load previous session"); },
    } as unknown as MarketDataProvider;

    await expect(resolveChartCaptureWindowForTest({
      now: new Date("2026-08-28T13:35:00.000Z"),
      session: {
        ...session,
        quality: { provider: "demo", feed: "demo", observedAt: new Date(), flags: [] },
      },
      mode: "manual",
      marketProvider,
    })).resolves.toEqual({
      range: {
        from: new Date("2026-08-28T13:30:00.000Z"),
        to: new Date("2026-08-28T13:35:00.000Z"),
      },
      barStatus: "open",
    });
  });
});
