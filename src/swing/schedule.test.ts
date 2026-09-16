import { describe, expect, it } from "vitest";

import { dateFromMarketParts } from "@/market-data/time";
import { eligibleSwingSlot, missedSwingSlot, swingScheduledFor } from "@/swing/schedule";

describe("Swing scheduler", () => {
  it("is DST-safe at 3:50:10 Eastern", () => {
    for (const date of ["2026-01-15", "2026-07-15"]) {
      expect(swingScheduledFor({ date, closesAt: dateFromMarketParts(date, 16, 0), isRegularSession: true })?.toISOString()).toBe(dateFromMarketParts(date, 15, 50, 10).toISOString());
    }
  });

  it("runs ten minutes and ten seconds before an early close", () => {
    const date = "2026-11-27";
    expect(swingScheduledFor({ date, closesAt: dateFromMarketParts(date, 13, 0), isRegularSession: true })?.toISOString()).toBe(dateFromMarketParts(date, 12, 49, 50).toISOString());
  });

  it("skips holidays and expires after ten minutes", () => {
    const date = "2026-12-25";
    expect(swingScheduledFor({ date, closesAt: dateFromMarketParts(date, 16, 0), isRegularSession: false })).toBeNull();
    const session = { date: "2026-07-15", closesAt: dateFromMarketParts("2026-07-15", 16, 0), isRegularSession: true };
    const due = swingScheduledFor(session)!;
    expect(eligibleSwingSlot(due, session)?.idempotencyKey).toBe("swing:auto:2026-07-15");
    expect(missedSwingSlot(new Date(due.getTime() + 10 * 60_000), session)).toBeNull();
    expect(eligibleSwingSlot(new Date(due.getTime() + 10 * 60_000 + 1), session)).toBeNull();
    expect(missedSwingSlot(new Date(due.getTime() + 10 * 60_000 + 1), session)?.toISOString()).toBe(due.toISOString());
  });
});
