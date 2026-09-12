import { z } from "zod";

export const backtestModels = [
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol · High" },
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5 · High" },
] as const;
export const modelSchema = z.enum(["google/gemini-2.5-pro", "openai/gpt-5.6-sol", "anthropic/claude-opus-5"]);
export type BacktestModel = z.infer<typeof modelSchema>;

export const predicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("price_sma"), period: z.union([z.literal(50), z.literal(200)]), relation: z.enum(["above", "below", "crosses_above", "crosses_below"]) }).strict(),
  z.object({ kind: z.literal("sma_pair"), relation: z.enum(["above", "below", "crosses_above", "crosses_below"]) }).strict(),
  z.object({ kind: z.literal("rsi"), threshold: z.number().gt(0).lt(100), relation: z.enum(["above", "below", "crosses_above", "crosses_below"]) }).strict(),
  z.object({ kind: z.literal("macd"), relation: z.enum(["above", "below", "crosses_above", "crosses_below"]) }).strict(),
]);
export type Predicate = z.infer<typeof predicateSchema>;
export const strategySchema = z.object({
  entry: z.array(predicateSchema).min(1).max(6),
  exit: z.array(predicateSchema).min(1).max(6),
  rsiPeriod: z.number().int().min(2).max(100).default(14),
  rsiOversold: z.number().gt(0).lt(100).default(30),
  rsiOverbought: z.number().gt(0).lt(100).default(70),
  macdFast: z.number().int().min(2).max(100).default(12),
  macdSlow: z.number().int().min(3).max(200).default(26),
  macdSignal: z.number().int().min(2).max(100).default(9),
}).strict().refine((value) => value.macdFast < value.macdSlow && value.rsiOversold < value.rsiOverbought, "Indicator parameters are inconsistent.");
export type Strategy = z.infer<typeof strategySchema>;

export const tickerSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.-]{0,9}$/);
export const runInputSchema = z.object({
  longTicker: tickerSchema,
  inverseTicker: tickerSchema.optional(),
  comparisons: z.array(tickerSchema).max(20).default([]),
  mode: z.enum(["cash", "inverse"]),
  startingCapital: z.number().positive().max(1e9),
  cashRate: z.number().min(0).max(100),
  slippage: z.number().min(0).max(20),
  fee: z.number().min(0).max(1e6),
  prompt: z.string().min(3).max(4000),
  model: modelSchema,
  strategy: strategySchema,
  parentRunId: z.string().uuid().optional(),
}).strict().refine((value) => value.mode !== "inverse" || Boolean(value.inverseTicker), "Inverse ticker is required.");
export type RunInput = z.infer<typeof runInputSchema>;

export type PriceRow = { date: string; close: number; open: number | null; high: number | null; low: number | null; volume: number | null };
export type PriceFile = { id: string; ticker: string; name: string; uploadedAt: string; firstDate: string; lastDate: string; rows: number; splitAdjustedConfirmed: boolean; warnings: string[] };
export type Trade = { date: string; action: "buy" | "sell"; ticker: string; equityAfter: number; fee: number; slippagePercent: number };
export type Series = { ticker: string; values: number[] };
export type Drawdown = { ticker: string; percent: number; peakDate: string; troughDate: string };
export type AnnualRow = { year: string; returns: Record<string, number> };
export type RunResult = { startDate: string; endDate: string; dates: string[]; series: Series[]; annual: AnnualRow[]; drawdowns: Drawdown[]; trades: Trade[]; fileIds: Record<string, string>; warnings: string[] };
export type ModelUsage = { model: BacktestModel; actualModel: string; requestedReasoning: { effort: "high" } | { max_tokens: number }; maxOutputTokens: number; responseFormat: "json_object"; requireParameters: true; inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; costUsd: number | null; at: string };
export type Suggestion = { title: string; reason: string; strategy: Strategy };
export type Commentary = { model: BacktestModel; summary: string; riskNotes: string[]; suggestions: Suggestion[]; usage: ModelUsage };
export type SavedRun = { id: string; createdAt: string; input: RunInput; result: RunResult; interpretationUsage?: ModelUsage; commentaries: Commentary[];
  comparison?: { baselineRunId: string; startDate: string; endDate: string; baseline: { annual: AnnualRow[]; drawdowns: Drawdown[]; finalBalance: number }; variant: { annual: AnnualRow[]; drawdowns: Drawdown[]; finalBalance: number } } };

export function describePredicate(predicate: Predicate): string {
  const lhs = predicate.kind === "price_sma" ? "Price" : predicate.kind === "sma_pair" ? "50-day SMA" : predicate.kind === "rsi" ? "RSI" : "MACD line";
  const rhs = predicate.kind === "price_sma" ? `${predicate.period}-day SMA` : predicate.kind === "sma_pair" ? "200-day SMA" : predicate.kind === "rsi" ? String(predicate.threshold) : "MACD signal";
  const verb = { above: "is above", below: "is below", crosses_above: "crosses above", crosses_below: "crosses below" }[predicate.relation];
  return `${lhs} ${verb} ${rhs}`;
}
