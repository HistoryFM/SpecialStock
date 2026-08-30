import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "@/analysis/types";
import { validateAnalysis } from "@/analysis/validate";

const valid: AnalysisResult = {
  observed_price: 100,
  verdict: "bullish",
  setup_type: "VWAP continuation",
  immediate_bias: "Upward pressure is visible.",
  broader_trend: "The visible session structure is constructive.",
  conviction: "high",
  candlestick_analysis: "Recent candles show higher closes.",
  vwap_keltner_analysis: "Price is visually above VWAP and the Keltner midline.",
  cci_analysis: "CCI is visibly above its centerline.",
  indicator_readings: Object.fromEntries(
    ["price_action", "vwap", "keltner", "volume", "adx", "rsi", "macd", "cci", "cmf"].map(
      (key) => [key, { stance: "bullish", readability: "clear", observation: `${key} is visually constructive.` }],
    ),
  ) as AnalysisResult["indicator_readings"],
  supporting_evidence: ["Higher lows support the thesis."],
  conflicting_evidence: ["Nearby resistance may limit follow-through."],
  support_levels: [98],
  resistance_levels: [104],
  primary_target: 104,
  deeper_scenario: "Continuation requires the visible structure to hold.",
  invalidation_level: 97,
  data_quality_flags: [],
  summary: "Bullish visual thesis.",
};

describe("analysis validation", () => {
  it("accepts a visually grounded directional response", () => {
    expect(validateAnalysis(valid).verdict).toBe("bullish");
  });

  it("rejects contradictory levels and unavailable-data claims", () => {
    expect(() => validateAnalysis({ ...valid, primary_target: 95 })).toThrow(/contradictory/);
    expect(() => validateAnalysis({ ...valid, summary: "Institutional buying confirms this view" })).toThrow(/unavailable/);
  });

  it("requires no-trade levels to remain null", () => {
    expect(() => validateAnalysis({ ...valid, verdict: "no_trade" })).toThrow(/no_trade/);
    expect(validateAnalysis({
      ...valid,
      observed_price: null,
      verdict: "no_trade",
      conviction: "low",
      primary_target: null,
      invalidation_level: null,
    }).verdict).toBe("no_trade");
  });

  it("requires no trade when price action is unreadable", () => {
    expect(() => validateAnalysis({
      ...valid,
      indicator_readings: {
        ...valid.indicator_readings,
        price_action: {
          stance: "unreadable",
          readability: "unreadable",
          observation: "The price pane is not legible.",
        },
      },
    })).toThrow(/unreadable/);
  });
});
