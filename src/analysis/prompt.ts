import type { ChartAnalysisInput } from "@/analysis/types";

export const COMPACT_PROMPT_VERSION = "chart-compact-v3";
export const FULL_PROMPT_VERSION = "chart-full-v4";
export const CHAT_PROMPT_VERSION = "analysis-chat-v1";
export const PROMPT_VERSION = COMPACT_PROMPT_VERSION;

export type PromptPhase = "compact" | "full";
export type PromptScope = "auto" | "manual_1m" | "manual_5m" | "manual_10m";
export type PromptRevisionSnapshot = {
  id: string;
  phase: PromptPhase;
  scope: PromptScope;
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
  return `Explain the already-locked technical signal using only the attached frozen TradingView chart and return only the structured four-phase JSON requested by the schema. Write concise, readable observations, not raw Markdown. Every required text field must contain a concrete observation, or say "unreadable" when the image does not support one; never return null or omit a field.

Capture metadata:
- Symbol: ${input.chartSymbol}
- Captured at: ${input.capturedAt}
- Interval/session: ${input.interval}, ${input.session}
- Latest bar status: ${input.barStatus}

Locked compact signal:
- Verdict / conviction: ${locked?.verdict ?? "unknown"}, ${locked?.conviction ?? "unknown"}
- Observed price / target / invalidation: ${locked?.observedPrice ?? "unreadable"}, ${locked?.target ?? "none"}, ${locked?.invalidation ?? "none"}

The chart is the sole technical evidence. ${instructions}

Return five non-null strings named phase1, phase2, phase3, phase4, and summary. Each phase string may use short labeled lines separated by newlines.
Phase 1 (phase1): Explain broad session structure and price relative to visibly labeled VWAP, Keltner, and support/resistance lines.
Phase 2 (phase2): Give a labeled observation for every lower indicator: ADX, RSI, MACD, CCI, and CMF. If a value or threshold is not visibly legible, say so; describe geometry only if it is actually visible. The chart uses ADX 14/14, RSI 14, MACD 12/26/9, CCI 20, and CMF 20.
Phase 3 (phase3): Compare up to the last three visible candles, their matching volume bars, and immediate line confluence. Respect the supplied latest-bar status.
Phase 4 (phase4): Explicitly weigh dominant price/VWAP/Keltner and volume evidence against secondary ADX/CMF and confirming oscillators. Explain why the locked ${locked?.verdict ?? "unknown"} verdict follows, including conflicts and extension risk. State chart conditions worth watching before a fresh scan, not an entry, order, position, or execution instruction. If the chart is unreadable, say what cannot be concluded.

Never calculate or reconstruct indicator values, infer unavailable prices, claim institutional transactions from CMF, assert mathematical certainty, or invent signals. Use numeric readings or price levels only when labels are legible in the image. Clearly separate visible evidence from inference. Do not return verdict, conviction, observed price, target, or invalidation: those fields are locked by the compact signal.`;
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

export function previewPrompt(phase: PromptPhase, instructions: string, scope: PromptScope = "auto"): string {
  const interval = scope === "manual_1m" ? "1m" : scope === "manual_10m" ? "10m" : "5m";
  const input = { ...PROMPT_PREVIEW_INPUT, interval: interval as ChartAnalysisInput["interval"] };
  return phase === "compact"
    ? buildCompactAnalysisPrompt(input, instructions)
    : buildFullAnalysisPrompt(input, {
        observedPrice: "{observedPrice}",
        verdict: "{verdict}",
        conviction: "{conviction}",
        target: "{target}",
        invalidation: "{invalidation}",
      }, instructions);
}

export const buildAnalysisPrompt = buildCompactAnalysisPrompt;
