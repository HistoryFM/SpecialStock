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

export const analysisResultSchema = z.object({
  observed_price: z.number().positive().nullable(),
  verdict: z.enum(["bullish", "bearish", "no_trade"]),
  setup_type: z.string().min(1).max(120),
  immediate_bias: z.string().min(1).max(600),
  broader_trend: z.string().min(1).max(600),
  conviction: z.enum(["low", "medium", "high"]),
  candlestick_analysis: z.string().min(1).max(1_200),
  vwap_keltner_analysis: z.string().min(1).max(1_200),
  cci_analysis: z.string().min(1).max(1_200),
  indicator_readings: indicatorReadingsSchema,
  supporting_evidence: z.array(z.string().min(1).max(300)).max(8),
  conflicting_evidence: z.array(z.string().min(1).max(300)).max(8),
  support_levels: z.array(z.number().positive()).max(8),
  resistance_levels: z.array(z.number().positive()).max(8),
  primary_target: z.number().positive().nullable(),
  deeper_scenario: z.string().min(1).max(600),
  invalidation_level: z.number().positive().nullable(),
  data_quality_flags: z.array(z.string().min(1).max(120)).max(20),
  summary: z.string().min(1).max(700),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export type ChartAnalysisInput = {
  version: "chart-img-input-v1";
  symbol: string;
  chartSymbol: string;
  capturedAt: string;
  interval: "5m";
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

export type ModelRunResult = {
  analysis: AnalysisResult;
  requestedModel: string;
  actualModel: string;
  actualProvider: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  rawResponse: unknown;
  failoverFrom: string | null;
};
