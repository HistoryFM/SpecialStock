import type { ChartAnalysisInput } from "@/analysis/types";

export const COMPACT_PROMPT_VERSION = "chart-compact-v2";
export const FULL_PROMPT_VERSION = "chart-full-v1";
export const PROMPT_VERSION = COMPACT_PROMPT_VERSION;

const INTERVAL_LABELS: Record<ChartAnalysisInput["interval"], string> = {
  "1m": "one-minute",
  "5m": "five-minute",
  "10m": "ten-minute",
};

export function buildCompactAnalysisPrompt(input: ChartAnalysisInput): string {
  return `Review the attached frozen TradingView chart for the next 15–30 minutes and return only the compact JSON object requested by the schema.

The chart is the sole source of technical evidence. It contains ${INTERVAL_LABELS[input.interval]} candles; VWAP and Keltner Channels over price; and separate panes for Volume, ADX, RSI, MACD, CCI, and Chaikin Money Flow (CMF). Do not calculate or reconstruct indicators, derive values from OHLC data, or claim access to any data not visibly present in the image.

Analyze this chart.

To prevent generic trend-following bias, perform a strict structural audit on the most recent 3 candles (use fewer candles if 3 aren't yet available after market open) before giving a direction:

Candlestick Physics: Compare the specific real-body sizes of the last 3 candles. Is velocity expanding or contracting? Note any precise wick rejections against the indicator lines.

Volume Divergence: Check whether the volume bars under the last 3 candles are expanding, flat, or drying up relative to each other. Match the volume directly to the price action.

Line Confluence: Determine whether the last 3 candles are accepting or rejecting VWAP and the visible Keltner upper, middle, or lower lines. A directional call requires agreement between candle structure, volume behavior, and those visible line interactions; otherwise return no_trade.

Do not give a generic macro projection; state the immediate micro-move based strictly on the data.

Capture metadata:

Symbol: ${input.chartSymbol}
Captured at: ${input.capturedAt}
Interval/session: ${input.interval}, ${input.session}
Latest bar status: ${input.barStatus}

Return exactly six judgments: observed price (p), verdict (v), conviction (c), target (t), invalidation (i), and visual quality (q).

Guardrails:

Separate visible evidence from inference and prefer no_trade when evidence conflicts.
Transcribe price levels only when their chart labels are legible. Never estimate an unreadable label.
A directional verdict requires a legible observed price, target, and invalidation. Otherwise return no_trade with null target and invalidation.
For bullish: target > observed price > invalidation. For bearish: target < observed price < invalidation.
Treat an open candle as incomplete.
Conviction is qualitative, never a probability.
Visual quality is clear only when the price and the relevant panes/labels are legible, partial when a judgment remains possible with limited visibility, and unreadable when no reliable judgment is possible.
Return no narratives, evidence, indicator readings, or extra fields.`;
}

export function buildFullAnalysisPrompt(input: ChartAnalysisInput, locked?: {
  observedPrice: number | null;
  verdict: "bullish" | "bearish" | "no_trade";
  conviction: "low" | "medium" | "high";
  target: number | null;
  invalidation: number | null;
}): string {
  return `Explain the already-locked technical signal using only the attached frozen TradingView chart and return only the narrative JSON object requested by the schema.

Capture metadata:
- Symbol: ${input.chartSymbol}
- Captured at: ${input.capturedAt}
- Interval/session: ${input.interval}, ${input.session}
- Latest bar status: ${input.barStatus}

Locked compact signal:
- Verdict / conviction: ${locked?.verdict ?? "unknown"}, ${locked?.conviction ?? "unknown"}
- Observed price / target / invalidation: ${locked?.observedPrice ?? "unreadable"}, ${locked?.target ?? "none"}, ${locked?.invalidation ?? "none"}

The chart is the sole technical evidence. Describe only visible price action, VWAP, Keltner Channels, Volume, ADX, RSI, MACD, CCI, and CMF. Never calculate indicator values, infer unavailable data, discuss execution mechanics, or invent signals. Complete every indicator reading, using unreadable where necessary. Do not return verdict, conviction, observed price, target, or invalidation: those fields are locked by the compact signal.`;
}

export const buildAnalysisPrompt = buildCompactAnalysisPrompt;
