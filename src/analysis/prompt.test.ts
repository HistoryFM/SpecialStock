import { describe, expect, it } from "vitest";

import { buildCompactAnalysisPrompt, COMPACT_PROMPT_VERSION } from "@/analysis/prompt";
import type { ChartAnalysisInput } from "@/analysis/types";

function input(interval: ChartAnalysisInput["interval"]): ChartAnalysisInput {
  return {
    version: "chart-img-input-v2",
    symbol: "AAPL",
    chartSymbol: "NASDAQ:AAPL",
    capturedAt: "2026-09-03T13:35:16.321Z",
    interval,
    session: "regular",
    barStatus: interval === "5m" ? "closed" : "open",
    range: { from: "2026-09-03T13:30:00.000Z", to: "2026-09-03T13:35:16.321Z" },
    width: 1600,
    height: 1920,
    studies: ["VWAP", "Keltner Channels", "Volume", "Average Directional Index", "Relative Strength Index", "MACD", "Commodity Channel Index", "Chaikin Money Flow"],
    inputHash: "hash",
  };
}

describe("compact analysis prompt", () => {
  it("uses v2 and the exact scheduled 5m prompt", () => {
    expect(COMPACT_PROMPT_VERSION).toBe("chart-compact-v2");
    expect(buildCompactAnalysisPrompt(input("5m"))).toBe(`Review the attached frozen TradingView chart for the next 15–30 minutes and return only the compact JSON object requested by the schema.

The chart is the sole source of technical evidence. It contains five-minute candles; VWAP and Keltner Channels over price; and separate panes for Volume, ADX, RSI, MACD, CCI, and Chaikin Money Flow (CMF). Do not calculate or reconstruct indicators, derive values from OHLC data, or claim access to any data not visibly present in the image.

Analyze this chart.

To prevent generic trend-following bias, perform a strict structural audit on the most recent 3 candles (use fewer candles if 3 aren't yet available after market open) before giving a direction:

Candlestick Physics: Compare the specific real-body sizes of the last 3 candles. Is velocity expanding or contracting? Note any precise wick rejections against the indicator lines.

Volume Divergence: Check whether the volume bars under the last 3 candles are expanding, flat, or drying up relative to each other. Match the volume directly to the price action.

Line Confluence: Determine whether the last 3 candles are accepting or rejecting VWAP and the visible Keltner upper, middle, or lower lines. A directional call requires agreement between candle structure, volume behavior, and those visible line interactions; otherwise return no_trade.

Do not give a generic macro projection; state the immediate micro-move based strictly on the data.

Capture metadata:

Symbol: NASDAQ:AAPL
Captured at: 2026-09-03T13:35:16.321Z
Interval/session: 5m, regular
Latest bar status: closed

Return exactly six judgments: observed price (p), verdict (v), conviction (c), target (t), invalidation (i), and visual quality (q).

Guardrails:

Separate visible evidence from inference and prefer no_trade when evidence conflicts.
Transcribe price levels only when their chart labels are legible. Never estimate an unreadable label.
A directional verdict requires a legible observed price, target, and invalidation. Otherwise return no_trade with null target and invalidation.
For bullish: target > observed price > invalidation. For bearish: target < observed price < invalidation.
Treat an open candle as incomplete.
Conviction is qualitative, never a probability.
Visual quality is clear only when the price and the relevant panes/labels are legible, partial when a judgment remains possible with limited visibility, and unreadable when no reliable judgment is possible.
Return no narratives, evidence, indicator readings, or extra fields.`);
  });

  it.each([["1m", "one-minute"], ["10m", "ten-minute"]] as const)("uses dynamic %s wording and metadata", (interval, wording) => {
    const prompt = buildCompactAnalysisPrompt(input(interval));
    expect(prompt).toContain(`contains ${wording} candles`);
    expect(prompt).toContain(`Interval/session: ${interval}, regular`);
    expect(prompt).toContain("Latest bar status: open");
  });
});
