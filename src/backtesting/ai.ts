import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/config/env";
import { modelSchema, strategySchema, type BacktestModel, type Commentary, type ModelUsage, type RunResult, type Strategy } from "./types";
import { reportConfigSchema, requiredTickers, strategyPlanSchema, type PlannedCommentary, type ReportConfig, type StrategyPlan } from "./plan";

const interpretationSchema = z.object({ clarification: z.string(), strategy: strategySchema.nullable() }).strict();
const suggestionSchema = z.object({ title: z.string().min(1).max(120), reason: z.string().min(1).max(600), strategy: strategySchema }).strict();
const commentarySchema = z.object({
  summary: z.string().min(1).max(3000), riskNotes: z.array(z.string().max(500)).max(6),
  suggestions: z.array(z.unknown()).max(3),
}).strict();
const planInterpretationSchema = z.object({ clarification: z.string(), plan: strategyPlanSchema.nullable() }).strict();
const planSuggestionSchema = z.object({ title: z.string().min(1).max(120), reason: z.string().min(1).max(600), plan: strategyPlanSchema }).strict();
const planCommentarySchema = z.object({ summary: z.string().min(1).max(3000), riskNotes: z.array(z.string().max(500)).max(6), suggestions: z.array(z.unknown()).max(3) }).strict();

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

export async function interpretPlan(prompt: string, selectedModel: string, availableTickers: string[]) {
  const model = modelSchema.parse(selectedModel);
  const system = `You interpret historical daily-close portfolio strategies. Return exactly JSON keys clarification and plan. If ambiguous, contradictory, unsupported, or a required asset is unavailable, return {"clarification":"specific question","plan":null}; do not invent a condition. Available CSV tickers: ${availableTickers.join(", ")}. SPY and QQQ CSVs are required. Do not calculate returns or generate executable code. Successful plan shape: {"version":2,"settings":{"startingCapital":1000,"cashRate":0,"borrowRate":0,"slippage":0,"fee":0,"startDate":"first_january"},"states":[{"id":"long","label":"Long TQQQ","allocations":[{"ticker":"TQQQ","side":"long","percent":100}]}],"transitions":[{"from":"cash","to":"long","when":{"any":[[{"kind":"price_sma","ticker":"TQQQ","period":50,"bandPct":0,"relation":"crosses_above"}]]}},{"from":"long","to":"cash","when":{"any":[[{"kind":"price_sma","ticker":"TQQQ","period":50,"bandPct":0,"relation":"crosses_below"}]]}}],"stops":[],"assumptions":[]}. Return this as the plan value and clarification "" only when it matches the actual prompt. Percentage setting values are percentage points, never decimal fractions: '2.5% annual cash interest' means cashRate:2.5, not 0.025; '1% borrow' means borrowRate:1, and '0.5% slippage' means slippage:0.5. The implicit initial state is cash; never include a cash state in states. States hold target allocations (gross exposure <=100%; residual is interest-earning cash). Transitions are ordered and only the first eligible transition from the current state executes per close; stops have priority. Model multi-step phases and asset-specific signals explicitly. A condition is an OR of AND groups via when.any. Atoms: price_sma(ticker,period 50 or 200,bandPct from -50 to 50,relation), rsi(ticker,period default 14,threshold,relation), macd(ticker,fast default 12,slow default 26,signal default 9,relation). Relations: above, below, at_or_above, at_or_below, crosses_above, crosses_below. For 'x% above SMA' set bandPct +x; 'x% below' set -x. A crossover is a one-day event, never a persistent level. For 'reenter when higher' use above. Use fixedPct/trailingPct per-asset stops only if requested. No daily rebalance, no leverage, no naked short proceeds interest. Settings default to $1000 and zero rates/costs; startDate first_january means first shared January trading day after indicator warm-up. If text asks for arbitrary indicators, intraday fills, unknown x%, or a condition whose meaning cannot be resolved, ask a clarification. Do not add the 200-day SMA unless explicitly requested. JSON only.`;
  const answer = await callModel(model, [{ role: "system", content: system }, { role: "user", content: prompt }], planInterpretationSchema);
  if (answer.value.plan) {
    const requested = [
      { key: "cashRate" as const, name: "Cash interest", patterns: [/(\d+(?:\.\d+)?)\s*%\s*(?:annual(?:ized)?\s*)?(?:interest|yield)\s+on\s+cash/i, /(?:cash\s+(?:interest|yield)|cash\s+at)\s*(?:at|of|=)?\s*(\d+(?:\.\d+)?)\s*%/i] },
      { key: "borrowRate" as const, name: "Short borrow", patterns: [/(\d+(?:\.\d+)?)\s*%\s*(?:annual(?:ized)?\s*)?(?:short\s+)?borrow/i, /(?:short\s+)?borrow\s+(?:rate\s*)?(?:at|of|=)?\s*(\d+(?:\.\d+)?)\s*%/i] },
      { key: "slippage" as const, name: "Slippage", patterns: [/(\d+(?:\.\d+)?)\s*%\s*slippage/i, /slippage\s*(?:at|of|=)?\s*(\d+(?:\.\d+)?)\s*%/i] },
    ];
    for (const { key, name, patterns } of requested) {
      const match = patterns.map((pattern) => prompt.match(pattern)).find(Boolean);
      if (!match) continue;
      const stated = Number(match[1]), interpreted = answer.value.plan.settings[key];
      if (Math.abs(interpreted - stated) < 1e-8) continue;
      if (Math.abs(interpreted * 100 - stated) < 1e-8) {
        answer.value.plan.settings[key] = stated;
        answer.value.plan.assumptions.push(`${name} normalized to the stated ${stated}%.`);
      } else {
        answer.value = { clarification: `${name} was stated as ${stated}% but interpreted as ${interpreted}%. Clarify the rate before running.`, plan: null };
        break;
      }
    }
    if (answer.value.plan && requiredTickers(answer.value.plan).some((ticker) => !availableTickers.includes(ticker)))
      answer.value = { clarification: "The plan references an asset without an uploaded CSV. Import that ticker before running.", plan: null };
    if (answer.value.plan && !/\b200\b|SMA\s*200/i.test(prompt) && answer.value.plan.transitions.some((transition) => transition.when.any.flat().some((atom) => atom.kind === "price_sma" && atom.period === 200)))
      answer.value = { clarification: "The plan added an unrequested 200-day SMA rule. Clarify the rules before running.", plan: null };
  }
  return answer;
}

export async function analyzePlannedRun(input: { model: BacktestModel; prompt: string; plan: StrategyPlan; result: RunResult }): Promise<PlannedCommentary> {
  const context = { prompt: input.prompt, plan: input.plan, startDate: input.result.startDate, endDate: input.result.endDate,
    annualReturns: input.result.annual, drawdowns: input.result.drawdowns, tradeCount: input.result.trades.length,
    finalBalances: Object.fromEntries(input.result.series.map((item) => [item.ticker, item.values.at(-1)])) };
  const system = `Return JSON keys summary, riskNotes (up to six strings), suggestions (up to three objects with title, reason, plan). Analyze only supplied calculated price-return metrics. Each suggestion is an untested hypothesis. A suggested plan must use the same version 2 structure, settings, and uploaded assets as the supplied plan, with explicit states and transitions. Only suggest supported SMA 50/200, RSI, MACD, percentage bands, allocations, or position stops. Do not invent measured results, executable code, or execution advice. JSON only.`;
  const { value, usage } = await callModel(input.model, [{ role: "system", content: system }, { role: "user", content: JSON.stringify(context) }], planCommentarySchema);
  const allowedTickers = new Set(Object.keys(input.result.fileIds));
  const suggestions = value.suggestions.flatMap((item) => { const parsed = planSuggestionSchema.safeParse(item);
    return parsed.success && JSON.stringify(parsed.data.plan.settings) === JSON.stringify(input.plan.settings) &&
      parsed.data.plan.states.flatMap((state) => state.allocations.map((allocation) => allocation.ticker)).every((ticker) => allowedTickers.has(ticker)) &&
      parsed.data.plan.transitions.flatMap((transition) => transition.when.any.flat().map((atom) => atom.ticker)).every((ticker) => allowedTickers.has(ticker))
      ? [parsed.data] : []; });
  const omitted = value.suggestions.length - suggestions.length;
  return { model: input.model, summary: value.summary,
    riskNotes: omitted ? [`${omitted} unsupported suggestion(s) omitted.`, ...value.riskNotes].slice(0, 6) : value.riskNotes,
    suggestions, usage };
}

export async function customizeReport(input: { model: BacktestModel; prompt: string; current: ReportConfig; series: string[]; tickers: string[] }) {
  const system = `Choose only supported report controls; no code or HTML. Return JSON with exactly visibleSeries (subset of ${JSON.stringify(input.series)}), sections (nonempty ordered subset of annual,drawdown,growth,trades), closeTickers (subset of ${JSON.stringify(input.tickers)}), range (full,last_year,last_two_years). Preserve existing selections unless asked to change them. Current settings: ${JSON.stringify(input.current)}. JSON only.`;
  return callModel(input.model, [{ role: "system", content: system }, { role: "user", content: input.prompt }], reportConfigSchema);
}
