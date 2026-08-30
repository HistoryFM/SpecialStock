import { describe, expect, it } from "vitest";

import { evaluateDirectionalOutcome } from "@/outcomes/evaluate";

const at = (minute: number, high: number, low: number) => ({ startsAt: new Date(Date.UTC(2026, 7, 28, 14, minute)), high, low });

describe("outcome evaluation", () => {
  it("tracks target and invalidation ordering", () => {
    expect(evaluateDirectionalOutcome({ direction: "bullish", target: 105, invalidation: 95, bars: [at(1, 102, 99), at(2, 106, 98)], expectedBars: 2 })).toBe("target_first");
    expect(evaluateDirectionalOutcome({ direction: "bearish", target: 95, invalidation: 105, bars: [at(1, 102, 94)], expectedBars: 1 })).toBe("target_first");
  });

  it("marks same-bar ordering ambiguous", () => {
    expect(evaluateDirectionalOutcome({ direction: "bullish", target: 105, invalidation: 95, bars: [at(1, 106, 94)], expectedBars: 1 })).toBe("ambiguous");
  });

  it("separates expired from missing coverage", () => {
    expect(evaluateDirectionalOutcome({ direction: "bullish", target: 105, invalidation: 95, bars: [at(1, 102, 98)], expectedBars: 1 })).toBe("expired");
    expect(evaluateDirectionalOutcome({ direction: "bullish", target: 105, invalidation: 95, bars: [], expectedBars: 30 })).toBe("missing_data");
  });
});
