import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/config/env";
import { modelSchema, strategySchema, type BacktestModel, type Commentary, type ModelUsage, type RunResult, type Strategy } from "./types";

const interpretationSchema = z.object({ clarification: z.string(), strategy: strategySchema.nullable() }).strict();
const suggestionSchema = z.object({ title: z.string().min(1).max(120), reason: z.string().min(1).max(600), strategy: strategySchema }).strict();
const commentarySchema = z.object({
  summary: z.string().min(1).max(3000), riskNotes: z.array(z.string().max(500)).max(6),
  suggestions: z.array(z.unknown()).max(3),
}).strict();

function canonicalizeNumericFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeNumericFields);
  if (!value || typeof value !== "object") return value;
  const numeric = new Set(["period", "threshold", "rsiPeriod", "rsiOversold", "rsiOverbought", "macdFast", "macdSlow", "macdSignal"]);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === "clarification" && item === null ? "" :
    (key === "entry" || key === "exit") && item && typeof item === "object" && !Array.isArray(item) ? [canonicalizeNumericFields(item)] :
    key === "period" && typeof item === "string" && /^(50|200)(?:[ -]?day)?$/i.test(item.trim()) ? Number(item.trim().match(/^(50|200)/)![1]) :
    numeric.has(key) && typeof item === "string" && /^\d+(?:\.\d+)?$/.test(item.trim()) ? Number(item) : canonicalizeNumericFields(item)]));
}

async function callModel<T>(model: BacktestModel, messages: { role: "system" | "user"; content: string }[], validator: z.ZodType<T>): Promise<{ value: T; usage: ModelUsage }> {
  const key = getServerEnv().OPENROUTER_API_KEY;
  if (!key) throw new Error("Configure the existing OpenRouter key to use AI in Backtesting.");
  const reasoning = model === "google/gemini-2.5-pro" ? { max_tokens: 2_048, exclude: true } : { effort: "high", exclude: true };
  const response = await fetch(getServerEnv().OPENROUTER_API_URL, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, reasoning, max_tokens: 6_000,
      response_format: { type: "json_object" },
      provider: { require_parameters: true } }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: { message?: string; code?: number | string; metadata?: { raw?: unknown } } } | null;
    const providerRaw = failure?.error?.metadata?.raw;
    let providerReason: string | undefined;
    if (typeof providerRaw === "string") {
      try { const parsed = JSON.parse(providerRaw) as { error?: { message?: string }; message?: string }; providerReason = parsed.error?.message ?? parsed.message; }
      catch { providerReason = providerRaw; }
    } else if (providerRaw && typeof providerRaw === "object") {
      const parsed = providerRaw as { error?: { message?: string }; message?: string };
      providerReason = parsed.error?.message ?? parsed.message;
    }
    const reason = (providerReason ?? failure?.error?.message)?.replaceAll(key, "[redacted]").slice(0, 300);
    throw new Error(`Selected model returned HTTP ${response.status}${reason ? `: ${reason}` : ""}. No other model was tried.`);
  }
  const raw = await response.json() as { model?: string; choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; cost?: number } };
  if (raw.model && raw.model !== model && !raw.model.startsWith(`${model}-`)) throw new Error(`OpenRouter answered with ${raw.model} instead of the selected model. No backtest was run.`);
  const content = raw.choices?.[0]?.message?.content;
  if (!content) throw new Error("Selected model returned no usable response.");
  let parsed: unknown;
  try { parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("Selected model returned malformed JSON. No backtest was run."); }
  const validation = validator.safeParse(canonicalizeNumericFields(parsed));
  if (!validation.success) throw new Error(`Selected model response failed validation: ${validation.error.issues.slice(0, 2).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. No backtest was run.`);
  const value = validation.data;
  return { value, usage: { model, actualModel: raw.model ?? model, requestedReasoning: model === "google/gemini-2.5-pro" ? { max_tokens: 2_048 } : { effort: "high" }, maxOutputTokens: 6_000, responseFormat: "json_object", requireParameters: true, inputTokens: raw.usage?.prompt_tokens ?? null, outputTokens: raw.usage?.completion_tokens ?? null, reasoningTokens: raw.usage?.completion_tokens_details?.reasoning_tokens ?? null, costUsd: raw.usage?.cost ?? null, at: new Date().toISOString() } };
}

export async function interpretStrategy(prompt: string, selectedModel: string) {
  const model = modelSchema.parse(selectedModel);
  const system = `Return one valid JSON object with exactly these top-level keys: clarification and strategy. Successful example: {"clarification":"","strategy":{"entry":[{"kind":"price_sma","period":50,"relation":"crosses_above"}],"exit":[{"kind":"price_sma","period":50,"relation":"crosses_below"}],"rsiPeriod":14,"rsiOversold":30,"rsiOverbought":70,"macdFast":12,"macdSlow":26,"macdSignal":9}}. For an unclear strategy return {"clarification":"explain what is missing","strategy":null}. Adapt the example to the user's actual rules; never copy it when the user specifies different rules. Entry and exit must each be JSON arrays, even for one condition. The only supported predicate kinds are price_sma (requires period 50 or 200), sma_pair (50-day SMA vs 200-day SMA), rsi (requires numeric threshold), and macd (MACD line vs signal). The only supported relations are above, below, crosses_above, crosses_below. Combine each entry or exit array using strict AND. A crossover is a one-day event. If entry or exit is missing, contradictory, unclear, uses OR, or needs any other indicator, return a clarification and null strategy. Never invent an exit. Use RSI defaults 14/30/70 and MACD defaults 12/26/9 unless specified. Do not calculate performance. JSON only.`;
  return callModel(model, [{ role: "system", content: system }, { role: "user", content: prompt }], interpretationSchema);
}

export async function analyzeRun(input: { model: BacktestModel; prompt: string; strategy: Strategy; result: RunResult }): Promise<Commentary> {
  const compact = {
    rulePrompt: input.prompt, strategy: input.strategy,
    startDate: input.result.startDate, endDate: input.result.endDate,
    annualReturns: input.result.annual, drawdowns: input.result.drawdowns,
    tradeCount: input.result.trades.length, sampleTrades: [...input.result.trades.slice(0, 5), ...input.result.trades.slice(-8)],
    finalBalances: Object.fromEntries(input.result.series.map((series) => [series.ticker, series.values.at(-1)])),
  };
  const system = `Return one valid JSON object with exactly these keys: summary (string), riskNotes (array of strings), suggestions (array of zero to three objects). Each suggestion must have title (string), reason (string), and strategy with entry and exit arrays of supported predicates plus indicator parameters. Example shape: {"summary":"Measured performance observation","riskNotes":["Measured drawdown observation"],"suggestions":[{"title":"Test RSI filter","reason":"Hypothesis only; not yet measured","strategy":{"entry":[{"kind":"price_sma","period":50,"relation":"crosses_above"},{"kind":"rsi","threshold":40,"relation":"below"}],"exit":[{"kind":"price_sma","period":50,"relation":"crosses_below"}],"rsiPeriod":14,"rsiOversold":30,"rsiOverbought":70,"macdFast":12,"macdSlow":26,"macdSignal":9}}]}. Each predicate kind must be exactly price_sma, sma_pair, rsi, or macd. Each relation must be exactly above, below, crosses_above, or crosses_below. price_sma requires period 50 or 200; rsi requires a numeric threshold. Entry and exit must each be arrays joined by strict AND. Analyze this already-calculated price-return backtest using only supplied metrics. Suggest only specific variations using SMA50, SMA200, RSI, MACD. Suggestions are untested hypotheses; do not claim improvement until separately measured. Do not invent numbers or provide execution instructions. JSON only.`;
  const { value, usage } = await callModel(input.model, [{ role: "system", content: system }, { role: "user", content: JSON.stringify(compact) }], commentarySchema);
  const suggestions = value.suggestions.flatMap((candidate) => {
    const parsed = suggestionSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
  const omitted = value.suggestions.length - suggestions.length;
  const riskNotes = omitted > 0
    ? [`${omitted} unsupported AI suggestion${omitted === 1 ? " was" : "s were"} omitted; no strategy was run from ${omitted === 1 ? "it" : "them"}.`, ...value.riskNotes].slice(0, 6)
    : value.riskNotes;
  return { model: input.model, summary: value.summary, riskNotes, suggestions, usage };
}
