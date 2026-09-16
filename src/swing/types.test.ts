import { describe, expect, it } from "vitest";

import { swingCandidateResultSchema, swingMacroResultSchema } from "@/swing/types";

const base = { symbol: "AAPL", observed_price: 100, entry_zone_low: 99, entry_zone_high: 101, stop_loss: 95, profit_target_1: 110, profit_target_2: null, conviction_level: "HIGH", macro_context: "Macro", pattern_name: "Range breakout", polarity_analysis: "Polarity", moving_average_analysis: "Moving averages", structural_setup_and_polarity: "Structure", core_indicators_and_volume: "Indicators", volume_ratio: 1.8, volume_analysis: "Volume", macd_analysis: "MACD", rsi_analysis: "RSI", cci_analysis: "CCI", cmf_analysis: "CMF", three_candle_micro_audit: "Candles", trigger_rule: "Daily close confirms", entry_rationale: "Entry", stop_rationale: "Stop", target_1_rationale: "Target one", target_2_rationale: null, risk_notes: [], visual_quality: "CLEAR", unreadable_fields: [] };

describe("Swing schemas", () => {
  it("accepts valid LONG, SHORT, and NO_TRADE results", () => {
    expect(swingCandidateResultSchema.parse({ ...base, direction: "LONG" }).direction).toBe("LONG");
    expect(swingCandidateResultSchema.parse({ ...base, direction: "SHORT", entry_zone_low: 99, entry_zone_high: 101, stop_loss: 106, profit_target_1: 90, profit_target_2: 80, target_2_rationale: "Target two" }).direction).toBe("SHORT");
    expect(swingCandidateResultSchema.parse({ ...base, direction: "NO_TRADE", entry_zone_low: null, entry_zone_high: null, stop_loss: null, profit_target_1: null, observed_price: null, visual_quality: "UNREADABLE", entry_rationale: null, stop_rationale: null, target_1_rationale: null }).direction).toBe("NO_TRADE");
  });

  it("rejects invalid level ordering and unreadable directional fields", () => {
    expect(() => swingCandidateResultSchema.parse({ ...base, direction: "LONG", stop_loss: 105 })).toThrow("ordered correctly");
    expect(() => swingCandidateResultSchema.parse({ ...base, direction: "LONG", unreadable_fields: ["stop_loss"] })).toThrow("cannot be unreadable");
    expect(() => swingCandidateResultSchema.parse({ ...base, direction: "LONG", volume_ratio: null, unreadable_fields: ["volume_ratio"] })).toThrow("readable exact volume ratio");
    expect(() => swingCandidateResultSchema.parse({ ...base, direction: "NO_TRADE" })).toThrow("null execution prices");
  });

  it("requires all four macro anchors", () => {
    expect(() => swingMacroResultSchema.parse({ regime: "CHOPPING_RANGE", long_bias: "NEUTRAL", short_bias: "NEUTRAL", high_beta_long_forbidden: false, summary: "Mixed", anchors: {} })).toThrow();
  });
});
