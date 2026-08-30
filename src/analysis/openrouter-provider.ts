import "server-only";

import * as Sentry from "@sentry/nextjs";
import { createHash } from "node:crypto";
import { z } from "zod";

import {
  AnalysisModelError,
  type AnalysisModelProvider,
} from "@/analysis/provider";
import { buildAnalysisPrompt } from "@/analysis/prompt";
import { analysisResultSchema } from "@/analysis/types";
import { parseJsonResponse, validateAnalysis } from "@/analysis/validate";
import { getServerEnv } from "@/config/env";
import { DEFAULT_MODEL_ID } from "@/models/catalog";

const responseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  choices: z.array(
    z.object({
      message: z.object({ content: z.union([z.string(), z.null()]) }),
      finish_reason: z.string().nullable().optional(),
    }),
  ).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
});

function jsonSchema() {
  const indicatorReading = {
    type: "object",
    additionalProperties: false,
    required: ["stance", "readability", "observation"],
    properties: {
      stance: {
        type: "string",
        enum: ["bullish", "bearish", "neutral", "mixed", "unreadable"],
      },
      readability: { type: "string", enum: ["clear", "partial", "unreadable"] },
      observation: { type: "string" },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(analysisResultSchema.shape),
    properties: {
      observed_price: { anyOf: [{ type: "number" }, { type: "null" }] },
      verdict: { type: "string", enum: ["bullish", "bearish", "no_trade"] },
      setup_type: { type: "string" },
      immediate_bias: { type: "string" },
      broader_trend: { type: "string" },
      conviction: { type: "string", enum: ["low", "medium", "high"] },
      candlestick_analysis: { type: "string" },
      vwap_keltner_analysis: { type: "string" },
      cci_analysis: { type: "string" },
      indicator_readings: {
        type: "object",
        additionalProperties: false,
        required: ["price_action", "vwap", "keltner", "volume", "adx", "rsi", "macd", "cci", "cmf"],
        properties: {
          price_action: indicatorReading,
          vwap: indicatorReading,
          keltner: indicatorReading,
          volume: indicatorReading,
          adx: indicatorReading,
          rsi: indicatorReading,
          macd: indicatorReading,
          cci: indicatorReading,
          cmf: indicatorReading,
        },
      },
      supporting_evidence: { type: "array", items: { type: "string" } },
      conflicting_evidence: { type: "array", items: { type: "string" } },
      support_levels: { type: "array", items: { type: "number" } },
      resistance_levels: { type: "array", items: { type: "number" } },
      primary_target: { anyOf: [{ type: "number" }, { type: "null" }] },
      deeper_scenario: { type: "string" },
      invalidation_level: { anyOf: [{ type: "number" }, { type: "null" }] },
      data_quality_flags: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
  };
}

function sentryInputMessages(prompt: string, png: Buffer) {
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
            sha256: createHash("sha256").update(png).digest("hex"),
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

function setUsageAttributes(
  span: Parameters<Parameters<typeof Sentry.startSpan>[1]>[0],
  raw: z.infer<typeof responseSchema>,
) {
  const inputTokens = raw.usage?.prompt_tokens;
  const outputTokens = raw.usage?.completion_tokens;
  span.setAttributes({
    "gen_ai.response.id": raw.id,
    "gen_ai.response.model": raw.model,
    "gen_ai.response.finish_reasons": raw.choices[0]?.finish_reason ?? undefined,
    "gen_ai.response.streaming": false,
    "gen_ai.usage.input_tokens": inputTokens,
    "gen_ai.usage.output_tokens": outputTokens,
    "gen_ai.usage.total_tokens":
      inputTokens === undefined && outputTokens === undefined
        ? undefined
        : (inputTokens ?? 0) + (outputTokens ?? 0),
    "gen_ai.cost.total_tokens": raw.usage?.cost,
    "openrouter.response.provider": raw.provider,
  });
}

function usageLogAttributes(input: {
  attempt: number;
  maxAttempts: number;
  latencyMs: number;
  model: string;
  raw?: z.infer<typeof responseSchema>;
}) {
  const attributes: Record<string, string | number | boolean> = {
    attempt: input.attempt,
    max_attempts: input.maxAttempts,
    latency_ms: input.latencyMs,
    requested_model: input.model,
  };
  if (input.raw?.model) attributes.actual_model = input.raw.model;
  if (input.raw?.provider) attributes.actual_provider = input.raw.provider;
  if (input.raw?.id) attributes.response_id = input.raw.id;
  if (input.raw?.usage?.prompt_tokens !== undefined) {
    attributes.input_tokens = input.raw.usage.prompt_tokens;
  }
  if (input.raw?.usage?.completion_tokens !== undefined) {
    attributes.output_tokens = input.raw.usage.completion_tokens;
  }
  if (input.raw?.usage?.cost !== undefined) attributes.cost_usd = input.raw.usage.cost;
  return attributes;
}

export class OpenRouterAnalysisModelProvider implements AnalysisModelProvider {
  readonly id = "openrouter";

  async analyze({
    frozen,
    png,
    model,
    maxAttempts = 2,
  }: Parameters<AnalysisModelProvider["analyze"]>[0]) {
    if (model !== DEFAULT_MODEL_ID) {
      throw new Error(`Only ${DEFAULT_MODEL_ID} is allowed for visual analysis.`);
    }
    const apiKey = getServerEnv().OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
    const prompt = buildAnalysisPrompt(frozen);
    const inputMessages = sentryInputMessages(prompt, png);
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const started = performance.now();
      try {
        return await Sentry.startSpan(
          {
            name: `chat ${model}`,
            op: "gen_ai.chat",
            attributes: {
              "gen_ai.operation.name": "chat",
              "gen_ai.operation.type": "ai_client",
              "gen_ai.provider.name": "openrouter",
              "gen_ai.request.model": model,
              "gen_ai.request.temperature": 0.1,
              "gen_ai.request.max_tokens": 3_200,
              "gen_ai.request.reasoning.level": "low",
              "gen_ai.prompt.name": "specialstock.visual-technical-analysis",
              "gen_ai.function_id": "specialstock.analyze-chart",
              "gen_ai.pipeline.name": "specialstock.chart-analysis",
              "gen_ai.input.messages": inputMessages,
              "specialstock.analysis.attempt": attempt + 1,
              "specialstock.symbol": frozen.symbol,
              "specialstock.chart.input_hash": frozen.inputHash,
            },
          },
          async (span) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 45_000);
            let raw: z.infer<typeof responseSchema> | undefined;
            let providerResponse: unknown;
            try {
              const response = await fetch(getServerEnv().OPENROUTER_API_URL, {
                method: "POST",
                cache: "no-store",
                signal: controller.signal,
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                  "HTTP-Referer": "http://localhost:3000",
                  "X-Title": "SpecialStock",
                },
                body: JSON.stringify({
                  model,
                  temperature: 0.1,
                  max_tokens: 3_200,
                  reasoning: { effort: "low" },
                  response_format: {
                    type: "json_schema",
                    json_schema: { name: "technical_analysis", strict: true, schema: jsonSchema() },
                  },
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: prompt },
                        {
                          type: "image_url",
                          image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
                        },
                      ],
                    },
                  ],
                }),
              });
              if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}.`);
              providerResponse = await response.json();
              raw = responseSchema.parse(providerResponse);
              setUsageAttributes(span, raw);
              const content = raw.choices[0]!.message.content;
              if (content) {
                span.setAttribute("gen_ai.output.messages", sentryOutputMessages(content));
              }
              if (raw.choices[0]!.finish_reason === "length") {
                throw new Error("OpenRouter response exceeded the structured-output token budget.");
              }
              if (!content) throw new Error("OpenRouter returned an empty response.");
              const analysis = validateAnalysis(parseJsonResponse(content));
              const latencyMs = Math.round(performance.now() - started);
              span.setStatus({ code: 1 });
              Sentry.logger.info(
                "Gemini visual analysis completed",
                usageLogAttributes({
                  attempt: attempt + 1,
                  maxAttempts,
                  latencyMs,
                  model,
                  raw,
                }),
              );
              return {
                analysis,
                requestedModel: model,
                actualModel: raw.model ?? model,
                actualProvider: raw.provider ?? "openrouter",
                latencyMs,
                inputTokens: raw.usage?.prompt_tokens ?? null,
                outputTokens: raw.usage?.completion_tokens ?? null,
                costUsd: raw.usage?.cost ?? null,
                rawResponse: raw,
                failoverFrom: null,
              };
            } catch (error) {
              const timedOut = error instanceof Error && error.name === "AbortError";
              const message = error instanceof Error ? error.message : "OpenRouter analysis failed.";
              const latencyMs = Math.round(performance.now() - started);
              if (raw) {
                setUsageAttributes(span, raw);
              } else if (providerResponse !== undefined) {
                span.setAttribute(
                  "gen_ai.output.messages",
                  sentryOutputMessages(JSON.stringify(providerResponse)),
                );
              }
              span.setStatus({ code: 2, message });
              Sentry.logger.warn("Gemini visual analysis failed", {
                ...usageLogAttributes({
                  attempt: attempt + 1,
                  maxAttempts,
                  latencyMs,
                  model,
                  raw,
                }),
                error_type: timedOut ? "timeout" : raw ? "invalid_response" : "request_failed",
                will_retry: attempt + 1 < maxAttempts,
              });
              throw new AnalysisModelError(message, {
                status: timedOut ? "timed_out" : raw ? "invalid" : "failed",
                requestedModel: model,
                actualModel: raw?.model ?? null,
                actualProvider: raw?.provider ?? "openrouter",
                latencyMs,
                inputTokens: raw?.usage?.prompt_tokens ?? null,
                outputTokens: raw?.usage?.completion_tokens ?? null,
                costUsd: raw?.usage?.cost ?? null,
                rawResponse: providerResponse ?? raw ?? null,
              });
            } finally {
              clearTimeout(timeout);
            }
          },
        );
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("OpenRouter analysis failed.");
  }
}
