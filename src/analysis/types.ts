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

const reportText = z.string().trim().min(1).max(1_200);
export const fourPhaseReportSchema = z.object({
  version: z.literal(1),
  phase1: reportText,
  phase2: reportText,
  phase3: reportText,
  phase4: reportText,
});
export type FourPhaseReport = z.infer<typeof fourPhaseReportSchema>;

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
  phase1: reportText,
  phase2: reportText,
  phase3: reportText,
  phase4: reportText,
  summary: z.string().trim().min(1).max(700),
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

export type ModelFailureKind =
  | "timeout"
  | "token_limit"
  | "http_transient"
  | "http_terminal"
  | "provider_finish_error"
  | "empty_response"
  | "malformed_json"
  | "validation_error"
  | "invalid_structure"
  | "request_failed";

export type ModelAttemptResult = {
  attemptNumber: number;
  responseId: string | null;
  status: "valid" | "invalid" | "failed" | "timed_out";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  queueWaitMs: number;
  costUsd: number | null;
  estimatedCostUsd: number | null;
  errorCode: string | null;
  failureKind: ModelFailureKind | null;
  requestSettings: Record<string, unknown>;
  rawResponse: unknown;
  promptSnapshot?: string;
  promptHash?: string;
};

type ModelRunMetadata = {
  inferenceProfile: string;
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
