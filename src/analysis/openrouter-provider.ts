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

export class OpenRouterAnalysisModelProvider implements AnalysisModelProvider {
  readonly id = "openrouter";

  async analyze({ frozen, png, model, phase = "compact", lockedSignal, maxAttempts = 2 }: Parameters<AnalysisModelProvider["analyze"]>[0]) {
    if (model !== DEFAULT_MODEL_ID) throw new Error(`Only ${DEFAULT_MODEL_ID} is allowed for visual analysis.`);
    const apiKey = getServerEnv().OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
    const compact = phase === "compact";
    const prompt = compact ? buildCompactAnalysisPrompt(frozen) : buildFullAnalysisPrompt(frozen, lockedSignal);
    const maxTokens = compact ? 256 : FULL_MAX_TOKENS;
    const estimate = compact ? COMPACT_ESTIMATE_USD : FULL_ESTIMATE_USD;
    const attempts: ModelAttemptResult[] = [];
    let lastError: unknown;

    for (let index = 0; index < maxAttempts; index += 1) {
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
        if (raw.choices[0]!.finish_reason === "length") throw new Error("OpenRouter response exceeded the structured-output token budget.");
        if (!content) throw new Error("OpenRouter returned an empty response.");
        const analysis = compact
          ? validateCompactAnalysis(parseJsonResponse(content))
          : validateFullAnalysis(parseJsonResponse(content));
        let inputTokens = raw.usage?.prompt_tokens ?? null;
        let outputTokens = raw.usage?.completion_tokens ?? null;
        let costUsd = raw.usage?.cost ?? null;
        if (raw.id && (inputTokens === null || outputTokens === null || costUsd === null)) {
          const usage = await reconcileUsage(apiKey, raw.id);
          inputTokens ??= usage?.native_tokens_prompt ?? null;
          outputTokens ??= usage?.native_tokens_completion ?? null;
          costUsd ??= usage?.total_cost ?? null;
        }
        attempts.push({
          attemptNumber: index + 1, responseId: raw.id ?? null, status: "valid",
          latencyMs: Math.round(performance.now() - started), inputTokens, outputTokens, costUsd,
          estimatedCostUsd: costUsd === null ? estimate : null, errorCode: null, rawResponse: raw,
        });
        const latencyMs = attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0);
        return {
          phase, analysis, requestedModel: model, actualModel: raw.model ?? model,
          actualProvider: raw.provider ?? "openrouter", latencyMs,
          inputTokens: total(attempts, "inputTokens"), outputTokens: total(attempts, "outputTokens"),
          costUsd: attempts.reduce((sum, attempt) => sum + (attempt.costUsd ?? attempt.estimatedCostUsd ?? 0), 0),
          rawResponse: raw, failoverFrom: null, attempts,
        } as Awaited<ReturnType<AnalysisModelProvider["analyze"]>>;
      } catch (error) {
        lastError = error;
        const timedOut = error instanceof Error && error.name === "AbortError";
        const responseId = raw?.id ?? null;
        let costUsd = raw?.usage?.cost ?? null;
        let inputTokens = raw?.usage?.prompt_tokens ?? null;
        let outputTokens = raw?.usage?.completion_tokens ?? null;
        if (responseId && (costUsd === null || inputTokens === null || outputTokens === null)) {
          const usage = await reconcileUsage(apiKey, responseId);
          costUsd ??= usage?.total_cost ?? null;
          inputTokens ??= usage?.native_tokens_prompt ?? null;
          outputTokens ??= usage?.native_tokens_completion ?? null;
        }
        attempts.push({
          attemptNumber: index + 1, responseId,
          status: timedOut ? "timed_out" : raw || providerResponse !== null ? "invalid" : "failed",
          latencyMs: Math.round(performance.now() - started), inputTokens, outputTokens, costUsd,
          estimatedCostUsd: costUsd === null && (shouldRetry || response?.ok) ? estimate : null,
          errorCode: error instanceof Error ? error.message.slice(0, 180) : "provider_error",
          rawResponse: providerResponse ?? raw,
        });
        Sentry.logger.warn("Gemini chart analysis attempt failed", {
          phase, attempt: index + 1, max_attempts: maxAttempts, will_retry: shouldRetry && index + 1 < maxAttempts,
          chart_sha256: createHash("sha256").update(png).digest("hex"),
        });
        if (!shouldRetry || index + 1 >= maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response)));
      } finally {
        clearTimeout(timeout);
      }
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
