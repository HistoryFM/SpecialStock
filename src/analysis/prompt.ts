import type { ChartAnalysisInput } from "@/analysis/types";

export const COMPACT_PROMPT_VERSION = "chart-compact-v3";
export const FULL_PROMPT_VERSION = "chart-full-v1";
export const CHAT_PROMPT_VERSION = "analysis-chat-v1";
export const PROMPT_VERSION = COMPACT_PROMPT_VERSION;

export type PromptPhase = "compact" | "full";
export type PromptRevisionSnapshot = {
  id: string;
  phase: PromptPhase;
  revisionNumber: number;
  instructions: string;
  instructionsHash: string;
  templateVersion: string;
};

export const DEFAULT_COMPACT_ANALYSIS_INSTRUCTIONS = `You are a deterministic technical analysis engine executing a strict structural audit on an intraday stock chart.

CRITICAL COUNTER-BIAS REQUIREMENT:
Explicitly suppress the natural tendency to follow generic macro trends. Do not let the immediate directional momentum of the last few candles dictate the output. Internally weigh the visible geometric intersections of the entire chart, volume shifts, lower panels, and indicator lines before deciding. A generic trend-following projection without verifying visible support structures and indicator confluences is structurally invalid.

INTERNAL ARCHITECTURE INSTRUCTIONS:
Before selecting the final output values, internally inspect and weigh:

PHASE 1: BROAD STRUCTURAL ARCHITECTURE

- Scan the entire visible width of the chart, including its left and center. Identify major structures such as ranges, channels, flags, and double tops or bottoms, plus established horizontal support and resistance zones.
- Locate the current price relative to the overall visible indicator setup. Determine whether price is extended near outer bands or consolidating around a session midline.

PHASE 2: ALL LOWER TECHNICAL INDICATORS

Deeply analyze every visible oscillator, trend-strength, and momentum panel below the chart without reconstructing values that are not visibly shown:

- MACD: Check visible signal-line crossovers, histogram momentum shifts, and centerline rejections.
- RSI and CCI: Identify visible overbought or oversold extremes, midline rejections, and structural divergences against price action.
- ADX: Assess whether visible trend strength is rising or falling. Use numerical thresholds such as 20 or 25 only when their labels and the plotted value are visibly legible.
- Chaikin Money Flow (CMF): Evaluate visible buying or selling pressure and flow direction relative to the zero line.

PHASE 3: THE 3-CANDLE MICRO-AUDIT

- Candlestick Physics: Compare the real-body sizes of the last 3 visible candles, using fewer only when 3 are unavailable. Determine whether velocity is expanding or contracting and note visible wick rejections against indicator lines. Obey the supplied latest-bar status: treat it as incomplete only when the runtime metadata says it is open.
- Volume Divergence: Determine whether the volume bars under these candles are expanding, flat, or drying up relative to each other, and match volume directly to price action.
- Line Confluence: Identify the visibly legible price level and color or style of the indicator line acting as immediate support or resistance. Do not invent an unreadable level.

PHASE 4: CONFLICT RESOLUTION AND HIERARCHY

Weigh conflicting visible signals systematically to eliminate trend-following bias:

- Give dominant weight to price action relative to core VWAP and Keltner lines and to volume. Give secondary weight to trend strength (ADX) and flow (CMF). Use momentum oscillators (MACD, RSI, and CCI) as confirmation.
- Determine whether the 3-candle micro-move contradicts broader visible structures, such as an aggressive candle moving into core VWAP support while MACD shows a bullish crossover, CMF shows inflows, or ADX shows exhausted trend strength.
- If dominant indicators conflict fundamentally, return no_trade. If dominant indicators align while minor oscillators lag, make the high-probability directional call.`;

export const DEFAULT_FULL_ANALYSIS_INSTRUCTIONS =
  "Describe only visible price action, VWAP, Keltner Channels, Volume, ADX, RSI, MACD, CCI, and CMF.";

const INTERVAL_LABELS: Record<ChartAnalysisInput["interval"], string> = {
  "1m": "one-minute",
  "5m": "five-minute",
  "10m": "ten-minute",
};

export function buildCompactAnalysisPrompt(
  input: ChartAnalysisInput,
  instructions = DEFAULT_COMPACT_ANALYSIS_INSTRUCTIONS,
): string {
  return `Review the attached frozen TradingView chart for the next 15–30 minutes and return only the compact JSON object requested by the schema.

The chart is the sole source of technical evidence. It contains ${INTERVAL_LABELS[input.interval] ?? "{intervalLabel}"} candles; VWAP and Keltner Channels over price; and separate panes for Volume, ADX, RSI, MACD, CCI, and Chaikin Money Flow (CMF). Do not calculate or reconstruct indicators, derive values from OHLC data, or claim access to any data not visibly present in the image.

Analyze this chart.

${instructions}

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
  observedPrice: number | string | null;
  verdict: "bullish" | "bearish" | "no_trade" | `{${string}}`;
  conviction: "low" | "medium" | "high" | `{${string}}`;
  target: number | string | null;
  invalidation: number | string | null;
}, instructions = DEFAULT_FULL_ANALYSIS_INSTRUCTIONS): string {
  return `Explain the already-locked technical signal using only the attached frozen TradingView chart and return only the narrative JSON object requested by the schema.

Capture metadata:
- Symbol: ${input.chartSymbol}
- Captured at: ${input.capturedAt}
- Interval/session: ${input.interval}, ${input.session}
- Latest bar status: ${input.barStatus}

Locked compact signal:
- Verdict / conviction: ${locked?.verdict ?? "unknown"}, ${locked?.conviction ?? "unknown"}
- Observed price / target / invalidation: ${locked?.observedPrice ?? "unreadable"}, ${locked?.target ?? "none"}, ${locked?.invalidation ?? "none"}

The chart is the sole technical evidence. ${instructions} Never calculate indicator values, infer unavailable data, discuss execution mechanics, or invent signals. Complete every indicator reading, using unreadable where necessary. Do not return verdict, conviction, observed price, target, or invalidation: those fields are locked by the compact signal.`;
}

export const PROMPT_PREVIEW_INPUT = {
  version: "chart-img-input-v2",
  symbol: "{symbol}",
  chartSymbol: "{exchange}:{symbol}",
  capturedAt: "{capturedAt}",
  interval: "{interval}",
  session: "{session}",
  barStatus: "{barStatus}",
  range: { from: "{sessionOpen}", to: "{capturedAt}" },
  width: 1600,
  height: 1920,
  studies: [
    "VWAP",
    "Keltner Channels",
    "Volume",
    "Average Directional Index",
    "Relative Strength Index",
    "MACD",
    "Commodity Channel Index",
    "Chaikin Money Flow",
  ],
  inputHash: "{inputHash}",
} as unknown as ChartAnalysisInput;

export function previewPrompt(phase: PromptPhase, instructions: string): string {
  return phase === "compact"
    ? buildCompactAnalysisPrompt(PROMPT_PREVIEW_INPUT, instructions)
    : buildFullAnalysisPrompt(PROMPT_PREVIEW_INPUT, {
        observedPrice: "{observedPrice}",
        verdict: "{verdict}",
        conviction: "{conviction}",
        target: "{target}",
        invalidation: "{invalidation}",
      }, instructions);
}

export const buildAnalysisPrompt = buildCompactAnalysisPrompt;
