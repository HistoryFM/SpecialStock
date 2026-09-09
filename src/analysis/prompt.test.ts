import { describe, expect, it } from "vitest";

import { buildCompactAnalysisPrompt, buildFullAnalysisPrompt, COMPACT_PROMPT_VERSION } from "@/analysis/prompt";
import type { ChartAnalysisInput } from "@/analysis/types";

function input(interval: ChartAnalysisInput["interval"], barStatus: ChartAnalysisInput["barStatus"] = interval === "5m" ? "closed" : "open"): ChartAnalysisInput {
  return {
    version: "chart-img-input-v2",
    symbol: "AAPL",
    chartSymbol: "NASDAQ:AAPL",
    capturedAt: "2026-09-03T13:35:16.321Z",
    interval,
    session: "regular",
    barStatus,
    range: { from: "2026-09-03T13:30:00.000Z", to: "2026-09-03T13:35:16.321Z" },
    width: 1600,
    height: 1920,
    studies: ["VWAP", "Keltner Channels", "Volume", "Average Directional Index", "Relative Strength Index", "MACD", "Commodity Channel Index", "Chaikin Money Flow"],
    inputHash: "hash",
  };
}

describe("compact analysis prompt", () => {
  it.each([
    ["1m", "one-minute", "open"], ["1m", "one-minute", "closed"],
    ["5m", "five-minute", "open"], ["5m", "five-minute", "closed"],
    ["10m", "ten-minute", "open"], ["10m", "ten-minute", "closed"],
  ] as const)("composes the v3 %s/%s prompt with runtime bar status", (interval, wording, barStatus) => {
    expect(COMPACT_PROMPT_VERSION).toBe("chart-compact-v3");
    const prompt = buildCompactAnalysisPrompt(input(interval, barStatus));
    expect(prompt).toContain(`contains ${wording} candles`);
    expect(prompt).toContain(`Interval/session: ${interval}, regular`);
    expect(prompt).toContain(`Latest bar status: ${barStatus}`);
    expect(prompt).toContain("CRITICAL COUNTER-BIAS REQUIREMENT");
    expect(prompt).toContain("PHASE 4: CONFLICT RESOLUTION AND HIERARCHY");
    expect(prompt).toContain("only when their labels and the plotted value are visibly legible");
    expect(prompt).toContain("treat it as incomplete only when the runtime metadata says it is open");
    expect(prompt).toContain("return no_trade");
    expect(prompt).not.toContain("5-minute stock chart");
  });
});

describe("full analysis prompt", () => {
  it("keeps the default locked prompt byte-for-byte stable", () => {
    expect(buildFullAnalysisPrompt(input("5m"), {
      observedPrice: 100,
      verdict: "bullish",
      conviction: "high",
      target: 104,
      invalidation: 97,
    })).toBe(`Explain the already-locked technical signal using only the attached frozen TradingView chart and return only the narrative JSON object requested by the schema.

Capture metadata:
- Symbol: NASDAQ:AAPL
- Captured at: 2026-09-03T13:35:16.321Z
- Interval/session: 5m, regular
- Latest bar status: closed

Locked compact signal:
- Verdict / conviction: bullish, high
- Observed price / target / invalidation: 100, 104, 97

The chart is the sole technical evidence. Describe only visible price action, VWAP, Keltner Channels, Volume, ADX, RSI, MACD, CCI, and CMF. Never calculate indicator values, infer unavailable data, discuss execution mechanics, or invent signals. Complete every indicator reading, using unreadable where necessary. Do not return verdict, conviction, observed price, target, or invalidation: those fields are locked by the compact signal.`);
  });

  it("changes only the editable instruction block", () => {
    const prompt = buildFullAnalysisPrompt(input("5m"), {
      observedPrice: 100,
      verdict: "bullish",
      conviction: "high",
      target: 104,
      invalidation: 97,
    }, "Focus on rejection wicks and volume contraction.");
    expect(prompt).toContain("Focus on rejection wicks and volume contraction.");
    expect(prompt).toContain("The chart is the sole technical evidence.");
    expect(prompt).toContain("those fields are locked by the compact signal");
  });
});
