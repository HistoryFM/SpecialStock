import { z } from "zod";

export const SWING_MODEL_ID = "google/gemini-2.5-pro" as const;
export const SWING_TEMPLATE_VERSION = "swing-daily-v2" as const;
export const SWING_MACRO_SYMBOLS = ["SPY", "QQQ", "GLD", "TLT"] as const;
export const SWING_EXCHANGES = ["NASDAQ", "NYSE", "AMEX"] as const;
export const SWING_WATCHLIST_MAX_ENTRIES = 100;

export const swingWatchlistCandidateSchema = z.object({
  stockName: z.string().trim().min(1).max(120),
  symbol: z.string().trim().transform((value) => value.toUpperCase()).pipe(
    z.string().min(1).max(10).regex(/^[A-Z][A-Z0-9.-]*$/, "Use a valid US stock symbol"),
  ),
  exchange: z.enum(SWING_EXCHANGES),
});

export const swingWatchlistEntrySchema = swingWatchlistCandidateSchema.extend({
  position: z.number().int().min(0).max(SWING_WATCHLIST_MAX_ENTRIES - 1),
});

export type SwingWatchlistCandidate = z.infer<typeof swingWatchlistCandidateSchema>;
export type SwingWatchlistEntry = z.infer<typeof swingWatchlistEntrySchema>;

const anchorSchema = z.object({
  stance: z.enum(["BULLISH", "BEARISH", "NEUTRAL", "UNREADABLE"]),
  observation: z.string().trim().min(1).max(2_000),
  visual_quality: z.enum(["CLEAR", "PARTIAL", "UNREADABLE"]),
}).strict();

export const swingMacroResultSchema = z.object({
  regime: z.enum(["BULLISH_ACCELERATION", "BEARISH_REGIME", "CHOPPING_RANGE", "VOLATILITY_ENVELOPE_SQUEEZE"]),
  long_bias: z.enum(["SUPPORTIVE", "NEUTRAL", "HOSTILE"]),
  short_bias: z.enum(["SUPPORTIVE", "NEUTRAL", "HOSTILE"]),
  high_beta_long_forbidden: z.boolean(),
  summary: z.string().trim().min(1).max(3_000),
  anchors: z.object({
    SPY: anchorSchema,
    QQQ: anchorSchema,
    GLD: anchorSchema,
    TLT: anchorSchema,
  }).strict(),
}).strict();

export type SwingMacroResult = z.infer<typeof swingMacroResultSchema>;

const nullablePrice = z.number().finite().positive().nullable();

export const swingCandidateResultSchema = z.object({
  symbol: z.string().trim().transform((value) => value.toUpperCase()),
  direction: z.enum(["LONG", "SHORT", "NO_TRADE"]),
  observed_price: nullablePrice,
  entry_zone_low: nullablePrice,
  entry_zone_high: nullablePrice,
  stop_loss: nullablePrice,
  profit_target_1: nullablePrice,
  profit_target_2: nullablePrice,
  conviction_level: z.enum(["HIGH", "MEDIUM", "LOW"]),
  macro_context: z.string().trim().min(1).max(4_000),
  pattern_name: z.string().trim().min(1).max(200),
  polarity_analysis: z.string().trim().min(1).max(4_000),
  moving_average_analysis: z.string().trim().min(1).max(4_000),
  structural_setup_and_polarity: z.string().trim().min(1).max(4_000),
  core_indicators_and_volume: z.string().trim().min(1).max(4_000),
  volume_ratio: z.number().finite().nonnegative().max(100).nullable(),
  volume_analysis: z.string().trim().min(1).max(4_000),
  macd_analysis: z.string().trim().min(1).max(4_000),
  rsi_analysis: z.string().trim().min(1).max(4_000),
  cci_analysis: z.string().trim().min(1).max(4_000),
  cmf_analysis: z.string().trim().min(1).max(4_000),
  three_candle_micro_audit: z.string().trim().min(1).max(4_000),
  trigger_rule: z.string().trim().min(1).max(4_000),
  entry_rationale: z.string().trim().min(1).max(2_000).nullable(),
  stop_rationale: z.string().trim().min(1).max(2_000).nullable(),
  target_1_rationale: z.string().trim().min(1).max(2_000).nullable(),
  target_2_rationale: z.string().trim().min(1).max(2_000).nullable(),
  risk_notes: z.array(z.string().trim().min(1).max(1_000)).max(20),
  visual_quality: z.enum(["CLEAR", "PARTIAL", "UNREADABLE"]),
  unreadable_fields: z.array(z.string().trim().min(1).max(200)).max(20),
}).strict().superRefine((value, context) => {
  const volumeUnreadable = value.unreadable_fields.some((field) => /volume.*ratio|ratio.*volume/i.test(field));
  if ((value.volume_ratio === null) !== volumeUnreadable) {
    context.addIssue({ code: "custom", message: "Volume-ratio readability and the structured value must agree." });
  }
  if (value.conviction_level === "HIGH" && value.volume_ratio === null) {
    context.addIssue({ code: "custom", message: "HIGH conviction requires a readable exact volume ratio." });
  }
  const execution = [value.entry_zone_low, value.entry_zone_high, value.stop_loss, value.profit_target_1];
  if (value.direction === "NO_TRADE") {
    if (execution.some((price) => price !== null) || value.profit_target_2 !== null) {
      context.addIssue({ code: "custom", message: "NO_TRADE requires null execution prices." });
    }
    if ([value.entry_rationale, value.stop_rationale, value.target_1_rationale, value.target_2_rationale].some((rationale) => rationale !== null)) {
      context.addIssue({ code: "custom", message: "NO_TRADE requires null execution-level rationales; use the trigger rule for conditions to watch." });
    }
    return;
  }
  if (value.observed_price === null || execution.some((price) => price === null)) {
    context.addIssue({ code: "custom", message: "Directional results require every execution price and observed price." });
    return;
  }
  if (value.visual_quality === "UNREADABLE") {
    context.addIssue({ code: "custom", message: "Directional results require readable chart evidence." });
  }
  const required = new Set(["observed_price", "entry_zone_low", "entry_zone_high", "stop_loss", "profit_target_1"]);
  if (value.unreadable_fields.some((field) => required.has(field))) {
    context.addIssue({ code: "custom", message: "Directional execution fields cannot be unreadable." });
  }
  if (!value.entry_rationale || !value.stop_rationale || !value.target_1_rationale || (value.profit_target_2 !== null) !== (value.target_2_rationale !== null)) {
    context.addIssue({ code: "custom", message: "Directional execution levels require matching visible-evidence rationales." });
  }
  const low = value.entry_zone_low!;
  const high = value.entry_zone_high!;
  const stop = value.stop_loss!;
  const first = value.profit_target_1!;
  if (value.direction === "LONG" && !(stop < low && low <= high && high < first && (value.profit_target_2 === null || value.profit_target_2 > first))) {
    context.addIssue({ code: "custom", message: "LONG execution levels are not ordered correctly." });
  }
  if (value.direction === "SHORT" && !(first < low && low <= high && high < stop && (value.profit_target_2 === null || value.profit_target_2 < first))) {
    context.addIssue({ code: "custom", message: "SHORT execution levels are not ordered correctly." });
  }
});

export type SwingCandidateResult = z.infer<typeof swingCandidateResultSchema>;

export type SwingChartInput = {
  version: "swing-chart-img-input-v1";
  role: "macro" | "candidate";
  symbol: string;
  chartSymbol: string;
  capturedAt: string;
  interval: "1D";
  session: "regular";
  timezone: "America/New_York";
  barStatus: "open";
  range: { from: string; to: string };
  width: 1600;
  height: 1920;
  studies: string[];
  inputHash: string;
};

export type SwingPromptRevisionSnapshot = {
  id: string;
  revisionNumber: number;
  instructions: string;
  instructionsHash: string;
  templateVersion: string;
};

export type SwingAttempt = {
  attemptNumber: number;
  status: "valid" | "failed";
  failureKind: string | null;
  queueWaitMs: number;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  responseId: string | null;
  actualModel: string | null;
  actualProvider: string | null;
  requestSettings: Record<string, unknown>;
  rawResponse: unknown;
  promptSnapshot: string;
  promptHash: string;
};
