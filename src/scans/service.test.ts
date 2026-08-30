import { describe, expect, it } from "vitest";

import { chartRangeForTest } from "@/scans/service";

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
});
