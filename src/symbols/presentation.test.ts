import { describe, expect, it } from "vitest";

import {
  alertReasonText,
  analysisFreshness,
  analysisUrl,
  levelDistance,
} from "@/symbols/presentation";

describe("symbol analysis presentation", () => {
  it("builds immutable alert analysis links", () => {
    expect(analysisUrl("AAPL", "analysis-id")).toBe("/symbols/AAPL?analysis=analysis-id");
  });

  it("describes alert lifecycle reasons", () => {
    expect(alertReasonText({ reason: "new_high_conviction_thesis", direction: "bearish" })).toBe(
      "New high-conviction bearish thesis",
    );
    expect(alertReasonText({ reason: "direction_changed", direction: "bullish", previousDirection: "bearish" })).toBe(
      "Direction changed: bearish → bullish",
    );
  });

  it("calculates signed level distance from the frozen price", () => {
    expect(levelDistance(100, 105)).toEqual({ amount: 5, percent: 5 });
    expect(levelDistance(100, 95)).toEqual({ amount: -5, percent: -5 });
    expect(levelDistance(0, 95)).toBeNull();
  });

  it("prioritizes running and failed scans over age", () => {
    const now = new Date("2026-08-28T15:00:00Z");
    expect(analysisFreshness({ now, analysisCompletedAt: null, latestScanStatus: "running", marketOpen: true })).toBe("running");
    expect(analysisFreshness({ now, analysisCompletedAt: now, latestScanStatus: "failed", marketOpen: true })).toBe("failed");
    expect(analysisFreshness({ now, analysisCompletedAt: new Date(now.getTime() - 11 * 60_000), latestScanStatus: "completed", marketOpen: true })).toBe("stale");
    expect(analysisFreshness({ now, analysisCompletedAt: new Date(now.getTime() - 11 * 60_000), latestScanStatus: "completed", marketOpen: false })).toBe("market_closed");
  });
});
