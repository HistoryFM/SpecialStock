import { describe, expect, it } from "vitest";

import { postProcessSwingCandidate, sortActionableSwingCandidates } from "@/swing/postprocess";
import type { SwingCandidateResult } from "@/swing/types";

const result = (overrides: Partial<SwingCandidateResult> = {}): SwingCandidateResult => ({
  symbol: "AAPL", direction: "LONG", observed_price: 123, entry_zone_low: 122, entry_zone_high: 124, stop_loss: 118,
  profit_target_1: 136, profit_target_2: 142, conviction_level: "HIGH", macro_context: "Macro context",
  pattern_name: "Range breakout", polarity_analysis: "Polarity", moving_average_analysis: "Moving averages", structural_setup_and_polarity: "Structure",
  core_indicators_and_volume: "Indicators", volume_ratio: 1.8, volume_analysis: "Volume", macd_analysis: "MACD", rsi_analysis: "RSI", cci_analysis: "CCI", cmf_analysis: "CMF", three_candle_micro_audit: "Candles",
  trigger_rule: "Daily close confirms", entry_rationale: "Entry", stop_rationale: "Stop", target_1_rationale: "Target one", target_2_rationale: "Target two",
  risk_notes: [], visual_quality: "CLEAR", unreadable_fields: [], ...overrides,
});

describe("Swing deterministic post-processing", () => {
  it("calculates conservative long R:R and proximity", () => {
    expect(postProcessSwingCandidate(result(), 2)).toMatchObject({ riskReward: 2, proximityPercent: 0, direction: "LONG" });
    expect(postProcessSwingCandidate(result({ observed_price: 120 }), 2).proximityPercent).toBe(1.67);
  });

  it("calculates short R:R", () => {
    const processed = postProcessSwingCandidate(result({ direction: "SHORT", observed_price: 101, entry_zone_low: 100, entry_zone_high: 102, stop_loss: 106, profit_target_1: 91, profit_target_2: 85 }), 0);
    expect(processed).toMatchObject({ riskReward: 1.5, proximityPercent: 0, direction: "SHORT" });
  });

  it("downgrades sub-1.5 results without losing the model explanation", () => {
    const processed = postProcessSwingCandidate(result({ profit_target_1: 130 }), 0);
    expect(processed.direction).toBe("NO_TRADE");
    expect(processed.originalDirection).toBe("LONG");
    expect(processed.rejectionReason).toContain("below 1.50");
  });

  it("sorts by proximity, conviction, R:R, quality, then watchlist order", () => {
    const items = [
      postProcessSwingCandidate(result({ symbol: "A", observed_price: 120, conviction_level: "HIGH" }), 0),
      postProcessSwingCandidate(result({ symbol: "B", observed_price: 123, conviction_level: "MEDIUM" }), 1),
      postProcessSwingCandidate(result({ symbol: "C", observed_price: 123, conviction_level: "HIGH", visual_quality: "PARTIAL" }), 2),
      postProcessSwingCandidate(result({ symbol: "D", observed_price: 123, conviction_level: "HIGH" }), 3),
    ];
    expect(sortActionableSwingCandidates(items).map((item) => item.symbol)).toEqual(["D", "C", "B", "A"]);
  });
});
