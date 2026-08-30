import "server-only";

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
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const started = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      let raw: z.infer<typeof responseSchema> | undefined;
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
                  { type: "text", text: buildAnalysisPrompt(frozen) },
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
        raw = responseSchema.parse(await response.json());
        if (raw.choices[0]!.finish_reason === "length") {
          throw new Error("OpenRouter response exceeded the structured-output token budget.");
        }
        const content = raw.choices[0]!.message.content;
        if (!content) throw new Error("OpenRouter returned an empty response.");
        const analysis = validateAnalysis(parseJsonResponse(content));
        return {
          analysis,
          requestedModel: model,
          actualModel: raw.model ?? model,
          actualProvider: raw.provider ?? "openrouter",
          latencyMs: Math.round(performance.now() - started),
          inputTokens: raw.usage?.prompt_tokens ?? null,
          outputTokens: raw.usage?.completion_tokens ?? null,
          costUsd: raw.usage?.cost ?? null,
          rawResponse: raw,
          failoverFrom: null,
        };
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "AbortError";
        const message = error instanceof Error ? error.message : "OpenRouter analysis failed.";
        lastError = new AnalysisModelError(message, {
          status: timedOut ? "timed_out" : raw ? "invalid" : "failed",
          requestedModel: model,
          actualModel: raw?.model ?? null,
          actualProvider: raw?.provider ?? "openrouter",
          latencyMs: Math.round(performance.now() - started),
          inputTokens: raw?.usage?.prompt_tokens ?? null,
          outputTokens: raw?.usage?.completion_tokens ?? null,
          costUsd: raw?.usage?.cost ?? null,
          rawResponse: raw ?? null,
        });
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("OpenRouter analysis failed.");
  }
}
