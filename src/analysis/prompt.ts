import type { ChartAnalysisInput } from "@/analysis/types";

export const PROMPT_VERSION = "chart-judgment-v2";

export function buildAnalysisPrompt(input: ChartAnalysisInput): string {
  return `Review the attached frozen TradingView chart for the next 15–30 minutes and return only the requested JSON object.

The chart is the sole source of technical evidence. It contains five-minute candles; VWAP and Keltner Channels over price; and separate panes for Volume, ADX, RSI, MACD, CCI, and Chaikin Money Flow (CMF). Do not calculate or reconstruct indicators, derive values from OHLC data, or claim access to any data not visibly present in the image.

Capture metadata:
- Symbol: ${input.chartSymbol}
- Captured at: ${input.capturedAt}
- Interval/session: ${input.interval}, ${input.session}
- Latest bar status: ${input.barStatus}

Guardrails:
- Separate visible evidence from inference and prefer no_trade when evidence conflicts.
- Complete every indicator_readings entry. Describe only what is visually legible; use unreadable when a pane or label cannot be judged.
- Transcribe observed_price and other price levels only when their chart labels are legible. Never estimate an unreadable label.
- A directional verdict requires a legible observed price, target, and invalidation. Otherwise return no_trade with null target and invalidation.
- For bullish: target > observed price > invalidation. For bearish: target < observed price < invalidation.
- Treat an open candle as incomplete.
- You may judge the visible Volume, ADX, RSI, MACD, CCI, and CMF plots, but never calculate their values or infer institutional activity.
- Do not discuss options, order mechanics, position sizing, or fabricate crossover signals that are not visibly plotted.
- Conviction is qualitative, never a probability.
- Add concise data_quality_flags for watermarking, stale/incomplete bars, cropped panes, or illegible labels.
- Keep each narrative field and indicator observation concise; return only the structured object.`;
}
