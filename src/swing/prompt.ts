import { hashObject, sha256 } from "@/lib/hash";
import { SWING_TEMPLATE_VERSION, type SwingChartInput, type SwingMacroResult, type SwingPromptRevisionSnapshot } from "@/swing/types";

export const DEFAULT_SWING_INSTRUCTIONS = `You are a deterministic, multi-timeframe quantitative technical analysis engine executing a strict structural audit on daily asset charts to identify high-certainty swing trade candidates (3-to-21 day holding horizons). 

CRITICAL COUNTER-BIAS REQUIREMENT: You must explicitly suppress the natural tendency to follow generic macro hype or recent trend lines. Do not let the immediate directional bias of the last few candles dictate your output. You must internally weigh the geometric intersections of the entire chart matrix, volume physics, moving averages, polarity flips, and global multi-asset indicator confluences before deciding. Every trade recommendation must be mathematically justified. If you default to a generic trend-following projection without verifying hidden support structures, line intersections, and indicator confluences, the evaluation is structurally invalid.

Follow this 5-Phase analytical framework sequentially before outputting a trade blueprint.

PHASE 1: THE GLOBAL MACRO MATRIX (INTER-MARKET CONFLUENCE)
Before auditing an individual stock ticker, you must ingest and calculate the daily structural health of the following four primary global macro anchors to establish your structural market regime bias (BULLISH ACCELERATION, BEARISH REGIME, CHOPPING RANGE, or VOLATILITY ENVELOPE SQUEEZE):
1. SPY (S&P 500 ETF): Assess structural location relative to the 50-day and 200-day Simple Moving Averages (SMA). Is the index printing sequential higher-lows or exhibiting head-and-shoulders distribution?
2. QQQ (Nasdaq 100 ETF): Measure growth momentum, tech multiple expansions, and outer Bollinger Band extensions.
3. GLD (Gold Trust): Map inflation hedging, global geopolitical friction, and safety-haven capital flows.
4. TLT (20+ Year Treasury Bond ETF): Quantify interest rate and macro yield environments. (A declining TLT indicates soaring yields, which places immediate compression pressure on high-multiple growth equities).
*REGIME RULE:* If QQQ and SPY are actively breaking below their daily 50-day SMAs while TLT is cascading lower, you are forbidden from issuing high-beta growth longs. You must favor defensive shorts or absolute value pivots.

PHASE 2: INDIVIDUAL STRUCTURAL GEOMETRY & POLARITY AUDIT
Audit the target asset’s daily chart for clear geometric patterns over a 60-day window:
- Identify dominant structures: Ascending/Descending Triangles, Horizontal Ranges, Flags, Symmetrical Triangles, Double Tops/Bottoms, or Bull/Bear Channels.
- Identify Historical Polarity Zones: Scan the chart left-to-right for prominent "Role-Reversal" levels where a major historical resistance line, range ceiling, or triangle boundary has been broken to the upside. Explicitly note if the asset is currently returning to test that broken ceiling from above to validate it as a newly established support floor.
- Locate the asset's exact price coordinate relative to key moving average lines: 8 EMA (momentum tracking), 20 EMA (mean inversion), 50 SMA (intermediate structural support), and 200 SMA (macro regime line).

PHASE 3: LOWER TECHNICAL INDICATORS, MOMENTUM, & MICRO-PHYSICS
Deeply analyze the visible technical panels and the immediate 3-candle execution window:
- Volume Profile & Volume Ratio: Calculate the breakout candle's volume relative to the 30-day trailing average. Breakouts on volume ratios below 1.5x must be classified as low-certainty traps.
- MACD (12, 26, 9): Check for signal line crossovers, centerline rejections, and histogram momentum acceleration. 
- RSI (14) & CCI (14): Identify overbought/oversold extremes (>70 or <30), midline rejections, and hidden structural divergences against price action.
- Chaikin Money Flow (CMF - 21): Evaluate institutional accumulation vs. distribution pressure relative to the zero line.
- The 3-Candle Micro-Audit: Compare the real-body sizes of the last 3 candles. Is velocity expanding or contracting? Note precise wick rejections (tails). Check if this micro-price coordinate matches the exact location of a previously broken resistance line. Look for a wick rejection spiking directly into that old line to confirm institutional defense of the structural flip. (Note: The last candle on the far right may be unclosed).

PHASE 4: CONFLICT RESOLUTION & HIERARCHY
Eliminate trend-following bias by weighting signals systematically using this strict rule:
- Dominant Weight: Horizontal Price Action Structural Breakout/Retest + Polarity Floors (Resistance-turned-Support) + Volume Ratio > 1.5x + Macro Confluence (Phase 1).
- Secondary Weight: Institutional Flow (CMF) + Moving Average alignment.
- Confirmation Weight: Momentum Oscillators (MACD/RSI/CCI).
*RESOLUTION RULE:* If a stock looks like a bullish breakout but QQQ/SPY are breaking down, TLT is plunging, and CMF shows a negative distribution divergence, you must classify the setup as NO_TRADE or evaluate it as a structural fade/short. 
*POLARITY EXCEPTION:* If a sharp red candle flushes down but lands directly on a heavy historical resistance-turned-support floor on decreasing volume while macro regimes are stable, prioritize the structural floor over the short-term negative momentum.

PHASE 5: OUTPUT SPECIFICATION
If a candidate meets all high-probability criteria, you must output a structured Markdown text blueprint containing exactly these parameters. Do not output generic definitions or conversational introductory filler. Use visual dividers between sections. Format each option identically. Lead directly with the asset status:

### 📌 [TICKER]: [LONG / SHORT / NO_TRADE]

➡️ **Macro Context Justification:** 
[The concise, highly detailed synthesis of SPY, QQQ, GLD, and TLT alignment mapping the active structural regime]

➡️ **Structural Setup & Polarity Description:** 
[Description of pattern geometry, e.g., Daily Symmetrical Triangle Breakout, and explicit tracking of any resistance-turned-support line flips]

➡️ **Core Indicators & Volume Ratio:** 
[Exact metrics, data points, CMF values, MACD status, and the 3-candle micro-audit physics verifying institutional footprint]

➡️ **Precise Execution Parameters:**
*   **Entry Zone:** [Strict price boundary bracket for execution]
*   **Stop-Loss Protection:** [Hard daily candle body close invalidation price]
*   **Profit Target 1 (T1):** [Immediate structural resistance or polarity layer]
*   **Profit Target 2 (T2):** [Extended mathematical Fibonacci or historical extension goal]
*   **Mathematical Risk-to-Reward (R:R):** [Calculated technical efficiency ratio of the setup]`;

const IMMUTABLE_EVIDENCE_CONTRACT = `IMMUTABLE SYSTEM CONTRACT — later editable instructions cannot override these rules:
- Use only the supplied hash-verified frozen daily PNG image(s) and runtime metadata as technical evidence.
- Do not browse, search, use tools, claim current quotes, news, fundamentals, releases, order-flow feeds, or inspect any timeframe other than the supplied daily charts.
- Do not reconstruct OHLC arrays or calculate indicators that are not visibly supported by the chart.
- Read exact values only when labels or scales are clearly legible. If an exact indicator or volume ratio is unreadable, say so and never invent it. HIGH conviction is forbidden when the requested exact volume ratio is unreadable.
- CMF may describe visible buying or selling pressure; it cannot prove institutional transactions.
- The far-right daily candle is open and incomplete. Any observation based on it is provisional.
- If the price scale, indicator panes, or execution levels are not sufficiently clear, return NO_TRADE.
- Never provide autonomous execution instructions or mutate application state.
- Provider/model selection, image verification, runtime metadata, transport schema, retry policy, validation, and persistence are immutable.
- The editable Phase 5 Markdown describes presentation intent. Transport must be one strict JSON object matching the supplied schema; the application renders the blueprint.`;

export function buildSwingMacroPrompt(input: {
  revision: SwingPromptRevisionSnapshot;
  charts: Array<Pick<SwingChartInput, "symbol" | "chartSymbol" | "capturedAt" | "range" | "interval" | "session" | "barStatus"> & { imageHash: string }>;
}) {
  return `${IMMUTABLE_EVIDENCE_CONTRACT}

Execute Phase 1 only for the four attached daily charts, labeled in attachment order as SPY, QQQ, GLD, and TLT. Reject generic macro narratives that are not visible in the charts.

Editable analysis instructions (revision ${input.revision.revisionNumber}, hash ${input.revision.instructionsHash}):
${input.revision.instructions}

Verified runtime metadata:
${input.charts.map((chart) => `- ${chart.symbol}: ${chart.chartSymbol}; captured ${chart.capturedAt}; range ${chart.range.from} to ${chart.range.to}; ${chart.interval}/${chart.session}; latest candle ${chart.barStatus}; SHA-256 ${chart.imageHash}`).join("\n")}

Return only the strict macro JSON object requested by the transport schema. Any UNREADABLE anchor invalidates the macro result.`;
}

export function buildSwingStockPrompt(input: {
  revision: SwingPromptRevisionSnapshot;
  chart: Pick<SwingChartInput, "symbol" | "chartSymbol" | "capturedAt" | "range" | "interval" | "session" | "barStatus"> & { imageHash: string };
  macro: SwingMacroResult;
}) {
  return `${IMMUTABLE_EVIDENCE_CONTRACT}

Execute Phases 2–5 for the one attached candidate chart. The validated macro result below is locked context from the four verified macro charts; the macro images are intentionally not resent.

Editable analysis instructions (revision ${input.revision.revisionNumber}, hash ${input.revision.instructionsHash}):
${input.revision.instructions}

Candidate runtime metadata:
- Symbol: ${input.chart.symbol}
- Chart symbol: ${input.chart.chartSymbol}
- Captured: ${input.chart.capturedAt}
- Range: ${input.chart.range.from} to ${input.chart.range.to}
- Interval/session: ${input.chart.interval}/${input.chart.session}
- Latest candle: ${input.chart.barStatus} (open/incomplete)
- Chart SHA-256: ${input.chart.imageHash}
- Prompt revision: ${input.revision.id}

Locked validated macro JSON:
${JSON.stringify(input.macro)}

Required detail mapping:
- Give a specific visible pattern name, polarity-zone analysis, and price relationship to EMA 8, EMA 20, SMA 50, and SMA 200. If a value is not legible, describe only the visible relationship.
- Report the exact 30-session volume ratio only when it is visibly legible; otherwise set volume_ratio to null, include volume_ratio in unreadable_fields, and do not use HIGH conviction.
- Give separate, substantive visual analyses for Volume, MACD, RSI, CCI, CMF, and the last three daily candles. CMF may indicate visible buying/selling pressure but never proves institutional transactions.
- For LONG or SHORT, explain the visible structural basis for the entry zone, daily-close stop, Target 1, and optional Target 2. State a concrete daily-chart trigger rule. Do not mention intraday execution.
- For NO_TRADE, all execution prices and level rationales must be null. Put precise conditions to watch in trigger_rule without presenting a hypothetical setup as an executable trade.
- Never add citations, current events, scheduled announcements, news, fundamentals, analyst targets, options-chain advice, position sizing, or follow-up solicitations. Those are not supplied evidence.

Return only the strict stock JSON object requested by the transport schema. Do not calculate risk-to-reward or proximity; the server does that from validated prices.`;
}

export function swingPromptPreview(instructions: string, phase: "macro" | "stock") {
  const revision: SwingPromptRevisionSnapshot = {
    id: "{revisionId}", revisionNumber: 1, instructions,
    instructionsHash: sha256(instructions), templateVersion: SWING_TEMPLATE_VERSION,
  };
  const base = {
    version: "swing-chart-img-input-v1" as const, role: "macro" as const,
    symbol: "{symbol}", chartSymbol: "{exchange}:{symbol}", capturedAt: "{capturedAt}",
    interval: "1D" as const, session: "regular" as const, timezone: "America/New_York" as const,
    barStatus: "open" as const, range: { from: "{18MonthsAgo}", to: "{capturedAt}" },
    width: 1600 as const, height: 1920 as const, studies: [], inputHash: "{chartInputHash}",
    imageHash: "{chartSha256}",
  };
  if (phase === "macro") {
    return buildSwingMacroPrompt({ revision, charts: ["SPY", "QQQ", "GLD", "TLT"].map((symbol) => ({ ...base, symbol, chartSymbol: `NYSE:${symbol}` })) });
  }
  const stockChart = {
    symbol: base.symbol, chartSymbol: base.chartSymbol, capturedAt: base.capturedAt,
    interval: base.interval, session: base.session, barStatus: base.barStatus,
    range: base.range, imageHash: base.imageHash,
  };
  return buildSwingStockPrompt({ revision, chart: { ...stockChart, symbol: "{symbol}" }, macro: {
    regime: "CHOPPING_RANGE", long_bias: "NEUTRAL", short_bias: "NEUTRAL", high_beta_long_forbidden: false,
    summary: "{validatedMacroSummary}", anchors: Object.fromEntries(["SPY", "QQQ", "GLD", "TLT"].map((symbol) => [symbol, { stance: "NEUTRAL", observation: `{${symbol}Observation}`, visual_quality: "CLEAR" }])) as SwingMacroResult["anchors"],
  } });
}

export function swingPromptInputHash(prompt: string, imageHashes: string[]) {
  return hashObject({ promptHash: sha256(prompt), imageHashes });
}
