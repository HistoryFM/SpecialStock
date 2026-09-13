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
  it("requires four grounded phases while preserving the locked signal", () => {
    const prompt = buildFullAnalysisPrompt(input("5m"), {
      observedPrice: 100,
      verdict: "bullish",
      conviction: "high",
      target: 104,
      invalidation: 97,
    });
    expect(prompt).toContain("Phase 1 (phase1):");
    expect(prompt).toContain("Phase 2 (phase2):");
    expect(prompt).toContain("Phase 3 (phase3):");
    expect(prompt).toContain("Phase 4 (phase4):");
    expect(prompt).toContain("locked bullish verdict");
    expect(prompt).toContain("numeric readings or price levels only when labels are legible");
    expect(prompt).toContain("those fields are locked by the compact signal");
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
