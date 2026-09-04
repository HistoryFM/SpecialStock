import { z } from "zod";

export const indicatorReadingSchema = z.object({
  stance: z.enum(["bullish", "bearish", "neutral", "mixed", "unreadable"]),
  readability: z.enum(["clear", "partial", "unreadable"]),
  observation: z.string().min(1).max(400),
});

export const indicatorReadingsSchema = z.object({
  price_action: indicatorReadingSchema,
  vwap: indicatorReadingSchema,
  keltner: indicatorReadingSchema,
  volume: indicatorReadingSchema,
  adx: indicatorReadingSchema,
  rsi: indicatorReadingSchema,
  macd: indicatorReadingSchema,
  cci: indicatorReadingSchema,
  cmf: indicatorReadingSchema,
});

export type IndicatorReadings = z.infer<typeof indicatorReadingsSchema>;

export const compactAnalysisWireSchema = z.object({
  p: z.number().positive().nullable(),
  v: z.enum(["bullish", "bearish", "no_trade"]),
  c: z.enum(["low", "medium", "high"]),
  t: z.number().positive().nullable(),
  i: z.number().positive().nullable(),
  q: z.enum(["clear", "partial", "unreadable"]),
});

export const compactAnalysisResultSchema = z.object({
  observed_price: z.number().positive().nullable(),
  verdict: z.enum(["bullish", "bearish", "no_trade"]),
  conviction: z.enum(["low", "medium", "high"]),
  primary_target: z.number().positive().nullable(),
  invalidation_level: z.number().positive().nullable(),
  visual_quality: z.enum(["clear", "partial", "unreadable"]),
});

export const fullAnalysisResultSchema = z.object({
  setup_type: z.string().min(1).max(120),
  immediate_bias: z.string().min(1).max(600),
  broader_trend: z.string().min(1).max(600),
  candlestick_analysis: z.string().min(1).max(1_200),
  vwap_keltner_analysis: z.string().min(1).max(1_200),
  cci_analysis: z.string().min(1).max(1_200),
  indicator_readings: indicatorReadingsSchema,
  supporting_evidence: z.array(z.string().min(1).max(300)).max(8),
  conflicting_evidence: z.array(z.string().min(1).max(300)).max(8),
  support_levels: z.array(z.number().positive()).max(8),
  resistance_levels: z.array(z.number().positive()).max(8),
  deeper_scenario: z.string().min(1).max(600),
  data_quality_flags: z.array(z.string().min(1).max(120)).max(20),
  summary: z.string().min(1).max(700),
});

export type CompactAnalysisResult = z.infer<typeof compactAnalysisResultSchema>;
export type FullAnalysisResult = z.infer<typeof fullAnalysisResultSchema>;

export type ManualScanTimeframe = "1m" | "5m" | "10m";
export type ChartTimeframe = ManualScanTimeframe;

export type ChartAnalysisInput = {
  version: "chart-img-input-v1" | "chart-img-input-v2";
  symbol: string;
  chartSymbol: string;
  capturedAt: string;
  interval: ChartTimeframe;
  session: "regular";
  barStatus: "open" | "closed";
  range: { from: string; to: string };
  width: number;
  height: number;
  studies: [
    "VWAP",
    "Keltner Channels",
    "Volume",
    "Average Directional Index",
    "Relative Strength Index",
    "MACD",
    "Commodity Channel Index",
    "Chaikin Money Flow",
  ];
  inputHash: string;
};

export type ModelAttemptResult = {
  attemptNumber: number;
  responseId: string | null;
  status: "valid" | "invalid" | "failed" | "timed_out";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  estimatedCostUsd: number | null;
  errorCode: string | null;
  rawResponse: unknown;
};

type ModelRunMetadata = {
  requestedModel: string;
  actualModel: string;
  actualProvider: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  rawResponse: unknown;
  failoverFrom: string | null;
  attempts: ModelAttemptResult[];
};

export type CompactModelRunResult = ModelRunMetadata & {
  phase: "compact";
  analysis: CompactAnalysisResult;
};

export type FullModelRunResult = ModelRunMetadata & {
  phase: "full";
  analysis: FullAnalysisResult;
};

export type ModelRunResult = CompactModelRunResult | FullModelRunResult;
