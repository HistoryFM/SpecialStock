import "server-only";

import * as Sentry from "@sentry/nextjs";
import { createHash } from "node:crypto";
import { z } from "zod";

import { AnalysisModelError, type AnalysisModelProvider } from "@/analysis/provider";
import { buildCompactAnalysisPrompt, buildFullAnalysisPrompt } from "@/analysis/prompt";
import {
  compactAnalysisWireSchema,
  fullAnalysisResultSchema,
  type ModelAttemptResult,
} from "@/analysis/types";
import { parseJsonResponse, validateCompactAnalysis, validateFullAnalysis } from "@/analysis/validate";
import { getServerEnv } from "@/config/env";
import { DEFAULT_MODEL_ID } from "@/models/catalog";

const responseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({ content: z.union([z.string(), z.null()]) }),
    finish_reason: z.string().nullable().optional(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    cost: z.number().optional(),
  }).optional(),
});

const generationSchema = z.object({
  data: z.object({
    native_tokens_prompt: z.number().optional(),
    native_tokens_completion: z.number().optional(),
    total_cost: z.number().optional(),
  }).optional(),
});

const FULL_MAX_TOKENS = 3_200;
const COMPACT_ESTIMATE_USD = 0.015;
const FULL_ESTIMATE_USD = 0.08;

function compactJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(compactAnalysisWireSchema.shape),
    properties: {
      p: { anyOf: [{ type: "number" }, { type: "null" }] },
      v: { type: "string", enum: ["bullish", "bearish", "no_trade"] },
      c: { type: "string", enum: ["low", "medium", "high"] },
      t: { anyOf: [{ type: "number" }, { type: "null" }] },
      i: { anyOf: [{ type: "number" }, { type: "null" }] },
      q: { type: "string", enum: ["clear", "partial", "unreadable"] },
    },
  };
}

function fullJsonSchema() {
  const indicator = {
    type: "object",
    additionalProperties: false,
    required: ["stance", "readability", "observation"],
    properties: {
      stance: { type: "string", enum: ["bullish", "bearish", "neutral", "mixed", "unreadable"] },
      readability: { type: "string", enum: ["clear", "partial", "unreadable"] },
      observation: { type: "string" },
    },
  };
  const readingKeys = ["price_action", "vwap", "keltner", "volume", "adx", "rsi", "macd", "cci", "cmf"];
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(fullAnalysisResultSchema.shape),
    properties: {
      setup_type: { type: "string" }, immediate_bias: { type: "string" }, broader_trend: { type: "string" },
      candlestick_analysis: { type: "string" }, vwap_keltner_analysis: { type: "string" }, cci_analysis: { type: "string" },
      indicator_readings: {
        type: "object", additionalProperties: false, required: readingKeys,
        properties: Object.fromEntries(readingKeys.map((key) => [key, indicator])),
      },
      supporting_evidence: { type: "array", items: { type: "string" } },
      conflicting_evidence: { type: "array", items: { type: "string" } },
      support_levels: { type: "array", items: { type: "number" } },
      resistance_levels: { type: "array", items: { type: "number" } },
      deeper_scenario: { type: "string" }, data_quality_flags: { type: "array", items: { type: "string" } }, summary: { type: "string" },
    },
  };
}

function retryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryDelay(response: Response | null) {
  const header = response?.headers.get("retry-after");
  if (!header) return 300;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1_000));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(10_000, Math.max(0, date - Date.now())) : 300;
}

async function reconcileUsage(apiKey: string, responseId: string) {
  try {
    const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(responseId)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    const parsed = generationSchema.parse(await response.json());
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

function total(attempts: ModelAttemptResult[], field: "inputTokens" | "outputTokens" | "costUsd") {
  const values = attempts.map((attempt) => attempt[field]).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

type AttemptSpan = Parameters<Parameters<typeof Sentry.startSpan>[1]>[0];

function sentryInputMessages(prompt: string, png: Buffer, chartSha256: string) {
  return JSON.stringify([
    {
      role: "user",
      parts: [
        { type: "text", content: prompt },
        {
          type: "image",
          content: JSON.stringify({
            mime_type: "image/png",
            byte_length: png.byteLength,
            sha256: chartSha256,
          }),
        },
      ],
    },
  ]);
}

function sentryOutputMessages(content: string) {
  return JSON.stringify([
    {
      role: "assistant",
      parts: [{ type: "text", content }],
    },
  ]);
}

async function resolveUsage(
  apiKey: string,
  raw: z.infer<typeof responseSchema> | null,
) {
  let inputTokens = raw?.usage?.prompt_tokens ?? null;
  let outputTokens = raw?.usage?.completion_tokens ?? null;
  let costUsd = raw?.usage?.cost ?? null;
  if (raw?.id && (inputTokens === null || outputTokens === null || costUsd === null)) {
    const usage = await reconcileUsage(apiKey, raw.id);
    inputTokens ??= usage?.native_tokens_prompt ?? null;
    outputTokens ??= usage?.native_tokens_completion ?? null;
    costUsd ??= usage?.total_cost ?? null;
  }
  return { inputTokens, outputTokens, costUsd };
}

function setAttemptSpanAttributes(
  span: AttemptSpan,
  raw: z.infer<typeof responseSchema> | null,
  attempt: ModelAttemptResult,
  willRetry: boolean,
) {
  const accountedCost = attempt.costUsd ?? attempt.estimatedCostUsd;
  const costSource = attempt.costUsd !== null
    ? "exact"
    : attempt.estimatedCostUsd !== null ? "estimated" : "unaccounted";
  const attributes: Record<string, string | number | boolean> = {
    "gen_ai.response.streaming": false,
    "specialstock.analysis.status": attempt.status,
    "specialstock.analysis.will_retry": willRetry,
    "specialstock.analysis.retry_outcome": willRetry ? "retrying" : "terminal",
    "specialstock.cost.estimated": attempt.costUsd === null && attempt.estimatedCostUsd !== null,
    "specialstock.cost.source": costSource,
  };
  if (attempt.responseId) attributes["gen_ai.response.id"] = attempt.responseId;
  if (raw?.model) attributes["gen_ai.response.model"] = raw.model;
  if (raw?.provider) attributes["openrouter.response.provider"] = raw.provider;
  const finishReason = raw?.choices[0]?.finish_reason;
  if (finishReason) attributes["gen_ai.response.finish_reasons"] = finishReason;
  if (attempt.inputTokens !== null) attributes["gen_ai.usage.input_tokens"] = attempt.inputTokens;
  if (attempt.outputTokens !== null) attributes["gen_ai.usage.output_tokens"] = attempt.outputTokens;
  if (attempt.inputTokens !== null || attempt.outputTokens !== null) {
    attributes["gen_ai.usage.total_tokens"] =
      (attempt.inputTokens ?? 0) + (attempt.outputTokens ?? 0);
  }
  if (accountedCost !== null) attributes["gen_ai.cost.total_tokens"] = accountedCost;
  span.setAttributes(attributes);
}

function usageLogAttributes(input: {
  phase: "compact" | "full";
  usageClass: Parameters<AnalysisModelProvider["analyze"]>[0]["usageClass"];
  symbol: string;
  chartSha256: string;
  maxAttempts: number;
  attempt: ModelAttemptResult;
  raw: z.infer<typeof responseSchema> | null;
  model: string;
  willRetry: boolean;
}) {
  const accountedCost = input.attempt.costUsd ?? input.attempt.estimatedCostUsd;
  const costSource = input.attempt.costUsd !== null
    ? "exact"
    : input.attempt.estimatedCostUsd !== null ? "estimated" : "unaccounted";
  const attributes: Record<string, string | number | boolean> = {
    phase: input.phase,
    usage_class: input.usageClass,
    symbol: input.symbol,
    chart_sha256: input.chartSha256,
    attempt: input.attempt.attemptNumber,
    max_attempts: input.maxAttempts,
    status: input.attempt.status,
    latency_ms: input.attempt.latencyMs,
    requested_model: input.model,
    will_retry: input.willRetry,
    retry_outcome: input.willRetry ? "retrying" : "terminal",
    cost_is_estimate:
      input.attempt.costUsd === null && input.attempt.estimatedCostUsd !== null,
    cost_source: costSource,
  };
  if (input.raw?.model) attributes.actual_model = input.raw.model;
  if (input.raw?.provider) attributes.actual_provider = input.raw.provider;
  if (input.attempt.responseId) attributes.response_id = input.attempt.responseId;
  if (input.attempt.inputTokens !== null) attributes.input_tokens = input.attempt.inputTokens;
  if (input.attempt.outputTokens !== null) attributes.output_tokens = input.attempt.outputTokens;
  if (accountedCost !== null) attributes.cost_usd = accountedCost;
  return attributes;
}

export class OpenRouterAnalysisModelProvider implements AnalysisModelProvider {
  readonly id = "openrouter";

  async analyze({ frozen, png, model, phase, usageClass, lockedSignal, maxAttempts = 2 }: Parameters<AnalysisModelProvider["analyze"]>[0]) {
    if (model !== DEFAULT_MODEL_ID) throw new Error(`Only ${DEFAULT_MODEL_ID} is allowed for visual analysis.`);
    const apiKey = getServerEnv().OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
    const compact = phase === "compact";
    const prompt = compact ? buildCompactAnalysisPrompt(frozen) : buildFullAnalysisPrompt(frozen, lockedSignal);
    const maxTokens = compact ? 256 : FULL_MAX_TOKENS;
    const estimate = compact ? COMPACT_ESTIMATE_USD : FULL_ESTIMATE_USD;
    const chartSha256 = createHash("sha256").update(png).digest("hex");
    const inputMessages = sentryInputMessages(prompt, png, chartSha256);
    const attempts: ModelAttemptResult[] = [];
    let lastError: unknown;

    for (let index = 0; index < maxAttempts; index += 1) {
      const spanAttributes: Record<string, string | number | boolean> = {
        "gen_ai.operation.name": "chat",
        "gen_ai.operation.type": "ai_client",
        "gen_ai.provider.name": "openrouter",
        "gen_ai.request.model": model,
        "gen_ai.request.temperature": 0.1,
        "gen_ai.request.max_tokens": maxTokens,
        "gen_ai.prompt.name": "specialstock.visual-technical-analysis",
        "gen_ai.function_id": "specialstock.analyze-chart",
        "gen_ai.pipeline.name": "specialstock.chart-analysis",
        "gen_ai.input.messages": inputMessages,
        "specialstock.analysis.phase": phase,
        "specialstock.analysis.usage_class": usageClass,
        "specialstock.analysis.attempt": index + 1,
        "specialstock.symbol": frozen.symbol,
        "specialstock.chart.input_hash": frozen.inputHash,
        "specialstock.chart.sha256": chartSha256,
        "specialstock.chart.byte_length": png.byteLength,
      };
      if (compact) {
        spanAttributes["specialstock.request.thinking_budget_tokens"] = 128;
      } else {
        spanAttributes["gen_ai.request.reasoning.level"] = "low";
      }
      const outcome = await Sentry.startSpan(
        { name: `chat ${model}`, op: "gen_ai.chat", attributes: spanAttributes },
        async (span) => {
          const started = performance.now();
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 45_000);
          let response: Response | null = null;
          let raw: z.infer<typeof responseSchema> | null = null;
          let providerResponse: unknown = null;
          let shouldRetry = true;
          try {
            response = await fetch(getServerEnv().OPENROUTER_API_URL, {
              method: "POST", cache: "no-store", signal: controller.signal,
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:3000", "X-Title": "SpecialStock" },
              body: JSON.stringify({
                model, temperature: 0.1, max_tokens: maxTokens,
                reasoning: compact ? { max_tokens: 128 } : { effort: "low" },
                response_format: { type: "json_schema", json_schema: { name: compact ? "compact_signal" : "full_analysis", strict: true, schema: compact ? compactJsonSchema() : fullJsonSchema() } },
                messages: [{ role: "user", content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
                ] }],
              }),
            });
            if (!response.ok) {
              shouldRetry = retryableStatus(response.status);
              throw new Error(`OpenRouter returned HTTP ${response.status}.`);
            }
            providerResponse = await response.json();
            raw = responseSchema.parse(providerResponse);
            const content = raw.choices[0]!.message.content;
            if (content) span.setAttribute("gen_ai.output.messages", sentryOutputMessages(content));
            if (raw.choices[0]!.finish_reason === "length") throw new Error("OpenRouter response exceeded the structured-output token budget.");
            if (!content) throw new Error("OpenRouter returned an empty response.");
            const analysis = compact
              ? validateCompactAnalysis(parseJsonResponse(content))
              : validateFullAnalysis(parseJsonResponse(content));
            const usage = await resolveUsage(apiKey, raw);
            const attempt: ModelAttemptResult = {
              attemptNumber: index + 1, responseId: raw.id ?? null, status: "valid",
              latencyMs: Math.round(performance.now() - started), ...usage,
              estimatedCostUsd: usage.costUsd === null ? estimate : null,
              errorCode: null, rawResponse: raw,
            };
            setAttemptSpanAttributes(span, raw, attempt, false);
            span.setStatus({ code: 1 });
            Sentry.logger.info("Gemini visual analysis completed", usageLogAttributes({
              phase, usageClass, symbol: frozen.symbol, chartSha256, maxAttempts,
              attempt, raw, model, willRetry: false,
            }));
            return { ok: true as const, analysis, raw, attempt };
          } catch (error) {
            const timedOut = error instanceof Error && error.name === "AbortError";
            const usage = await resolveUsage(apiKey, raw);
            const willRetry = shouldRetry && index + 1 < maxAttempts;
            const attempt: ModelAttemptResult = {
              attemptNumber: index + 1, responseId: raw?.id ?? null,
              status: timedOut ? "timed_out" : raw || providerResponse !== null ? "invalid" : "failed",
              latencyMs: Math.round(performance.now() - started), ...usage,
              estimatedCostUsd: usage.costUsd === null && (shouldRetry || response?.ok) ? estimate : null,
              errorCode: error instanceof Error ? error.message.slice(0, 180) : "provider_error",
              rawResponse: providerResponse ?? raw,
            };
            setAttemptSpanAttributes(span, raw, attempt, willRetry);
            const message = error instanceof Error ? error.message : "OpenRouter analysis failed.";
            span.setStatus({ code: 2, message });
            Sentry.logger.warn("Gemini visual analysis failed", {
              ...usageLogAttributes({
                phase, usageClass, symbol: frozen.symbol, chartSha256, maxAttempts,
                attempt, raw, model, willRetry,
              }),
              error_type: timedOut
                ? "timeout"
                : response && !response.ok
                  ? `http_${response.status}`
                  : raw || providerResponse !== null
                    ? "invalid_response"
                    : "request_failed",
            });
            return { ok: false as const, error, attempt, willRetry, retryAfterMs: retryDelay(response) };
          } finally {
            clearTimeout(timeout);
          }
        },
      );
      attempts.push(outcome.attempt);
      if (outcome.ok) {
        const latencyMs = attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0);
        return {
          phase, analysis: outcome.analysis, requestedModel: model,
          actualModel: outcome.raw.model ?? model,
          actualProvider: outcome.raw.provider ?? "openrouter", latencyMs,
          inputTokens: total(attempts, "inputTokens"), outputTokens: total(attempts, "outputTokens"),
          costUsd: attempts.reduce((sum, attempt) => sum + (attempt.costUsd ?? attempt.estimatedCostUsd ?? 0), 0),
          rawResponse: outcome.raw, failoverFrom: null, attempts,
        } as Awaited<ReturnType<AnalysisModelProvider["analyze"]>>;
      }
      lastError = outcome.error;
      if (!outcome.willRetry) break;
      await new Promise((resolve) => setTimeout(resolve, outcome.retryAfterMs));
    }

    const last = attempts.at(-1)!;
    throw new AnalysisModelError(lastError instanceof Error ? lastError.message : "OpenRouter analysis failed.", {
      status: last.status === "valid" ? "invalid" : last.status, requestedModel: model, actualModel: null, actualProvider: "openrouter",
      latencyMs: attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
      inputTokens: total(attempts, "inputTokens"), outputTokens: total(attempts, "outputTokens"),
      costUsd: attempts.reduce((sum, attempt) => sum + (attempt.costUsd ?? attempt.estimatedCostUsd ?? 0), 0),
      rawResponse: last.rawResponse, attempts,
    });
  }
}
