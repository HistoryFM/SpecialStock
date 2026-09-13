import { describe, expect, it } from "vitest";

import { isFullAnalysisEligible, validateCompactAnalysis, validateFullAnalysis } from "@/analysis/validate";

const valid = {
  p: 100,
  v: "bullish",
  setup_type: "VWAP continuation",
  immediate_bias: "Upward pressure is visible.",
  broader_trend: "The visible session structure is constructive.",
  c: "high",
  candlestick_analysis: "Recent candles show higher closes.",
  vwap_keltner_analysis: "Price is visually above VWAP and the Keltner midline.",
  cci_analysis: "CCI is visibly above its centerline.",
  indicator_readings: Object.fromEntries(
    ["price_action", "vwap", "keltner", "volume", "adx", "rsi", "macd", "cci", "cmf"].map(
      (key) => [key, { stance: "bullish", readability: "clear", observation: `${key} is visually constructive.` }],
    ),
  ),
  supporting_evidence: ["Higher lows support the thesis."],
  conflicting_evidence: ["Nearby resistance may limit follow-through."],
  support_levels: [98],
  resistance_levels: [104],
  t: 104,
  deeper_scenario: "Continuation requires the visible structure to hold.",
  i: 97,
  q: "clear",
  data_quality_flags: [],
  summary: "Bullish visual thesis.",
};
const validFull = {
  phase1: "A visible range is forming near VWAP.",
  phase2: "ADX rising; RSI below midline; MACD contracts; CCI near centerline; CMF below zero.",
  phase3: "Three small candles with flat volume near VWAP.",
  phase4: "Price and volume are mixed. The locked no-trade verdict follows from conflict. Watch for a fresh scan after a clear break.",
  summary: "Visible signals conflict.",
};

describe("analysis validation", () => {
  it("makes every completed compact verdict eligible for full analysis", () => {
    expect(isFullAnalysisEligible({ verdict: "bullish", conviction: "medium" })).toBe(true);
    expect(isFullAnalysisEligible({ verdict: "bearish", conviction: "high" })).toBe(true);
    expect(isFullAnalysisEligible({ verdict: "bullish", conviction: "low" })).toBe(true);
    expect(isFullAnalysisEligible({ verdict: "no_trade", conviction: "high" })).toBe(true);
  });

  it("accepts a visually grounded directional response", () => {
    expect(validateCompactAnalysis(valid).verdict).toBe("bullish");
  });

  it("rejects contradictory levels and unavailable-data claims", () => {
    expect(() => validateCompactAnalysis({ ...valid, t: 95 })).toThrow(/contradictory/);
    expect(() => validateFullAnalysis({ ...validFull, summary: "Institutional buying confirms this view" })).toThrow(/unavailable data/);
    expect(() => validateFullAnalysis({ ...validFull, verdict: "bullish" })).toThrow(/locked fields/);
    expect(() => validateFullAnalysis({ ...validFull, phase2: "MACD 0.06 is above 0.24 (is incorrect)." })).toThrow(/self-correction/);
    expect(validateFullAnalysis(validFull).phase4).toContain("no-trade");
  });

  it("requires no-trade levels to remain null", () => {
    expect(() => validateCompactAnalysis({ ...valid, v: "no_trade" })).toThrow(/no_trade/);
    expect(validateCompactAnalysis({
      ...valid,
      p: null, v: "no_trade", c: "low", t: null, i: null,
    }).verdict).toBe("no_trade");
  });

  it("requires no trade when price action is unreadable", () => {
    expect(() => validateCompactAnalysis({ ...valid, q: "unreadable" })).toThrow(/unreadable/);
  });
});
