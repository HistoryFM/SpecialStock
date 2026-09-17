import "server-only";

import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { getServerEnv } from "@/config/env";
import { sha256 } from "@/lib/hash";
import {
  SWING_MODEL_ID,
  SWING_MARKET_CONFIG,
  swingCandidateResultSchema,
  swingMacroResultSchema,
  type SwingAttempt,
  type SwingCandidateResult,
  type SwingMacroResult,
  type SwingMarket,
} from "@/swing/types";

export const SWING_OPENROUTER_TIMEOUT_MS = 150_000;

const responseSchema = z.object({
  id: z.string().optional(), model: z.string().optional(), provider: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), completion_tokens_details: z.object({ reasoning_tokens: z.number().nullable().optional() }).optional(), cost: z.number().optional() }).optional(),
});

function macroJsonSchema(market: SwingMarket) { const keys = SWING_MARKET_CONFIG[market].macro.map((anchor) => anchor.key); return {
  type: "object", additionalProperties: false,
  required: ["regime", "long_bias", "short_bias", "high_beta_long_forbidden", "summary", "anchors"],
  properties: {
    regime: { type: "string", enum: ["BULLISH_ACCELERATION", "BEARISH_REGIME", "CHOPPING_RANGE", "VOLATILITY_ENVELOPE_SQUEEZE"] },
    long_bias: { type: "string", enum: ["SUPPORTIVE", "NEUTRAL", "HOSTILE"] },
    short_bias: { type: "string", enum: ["SUPPORTIVE", "NEUTRAL", "HOSTILE"] },
    high_beta_long_forbidden: { type: "boolean" }, summary: { type: "string" },
    anchors: { type: "object", additionalProperties: false, required: keys, properties: Object.fromEntries(keys.map((symbol) => [symbol, { type: "object", additionalProperties: false, required: ["stance", "observation", "visual_quality"], properties: { stance: { type: "string", enum: ["BULLISH", "BEARISH", "NEUTRAL", "UNREADABLE"] }, observation: { type: "string" }, visual_quality: { type: "string", enum: ["CLEAR", "PARTIAL", "UNREADABLE"] } } }])) },
  },
}; }

const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const stockJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["symbol", "direction", "observed_price", "entry_zone_low", "entry_zone_high", "stop_loss", "profit_target_1", "profit_target_2", "conviction_level", "macro_context", "pattern_name", "polarity_analysis", "moving_average_analysis", "structural_setup_and_polarity", "core_indicators_and_volume", "volume_ratio", "volume_analysis", "macd_analysis", "rsi_analysis", "cci_analysis", "cmf_analysis", "three_candle_micro_audit", "trigger_rule", "entry_rationale", "stop_rationale", "target_1_rationale", "target_2_rationale", "risk_notes", "visual_quality", "unreadable_fields"],
  properties: {
    symbol: { type: "string" }, direction: { type: "string", enum: ["LONG", "SHORT", "NO_TRADE"] },
    observed_price: nullableNumber, entry_zone_low: nullableNumber, entry_zone_high: nullableNumber,
    stop_loss: nullableNumber, profit_target_1: nullableNumber, profit_target_2: nullableNumber,
    conviction_level: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    macro_context: { type: "string" }, pattern_name: { type: "string" }, polarity_analysis: { type: "string" }, moving_average_analysis: { type: "string" },
    structural_setup_and_polarity: { type: "string" }, core_indicators_and_volume: { type: "string" },
    volume_ratio: nullableNumber, volume_analysis: { type: "string" }, macd_analysis: { type: "string" }, rsi_analysis: { type: "string" }, cci_analysis: { type: "string" }, cmf_analysis: { type: "string" },
    three_candle_micro_audit: { type: "string" }, trigger_rule: { type: "string" },
    entry_rationale: { anyOf: [{ type: "string" }, { type: "null" }] }, stop_rationale: { anyOf: [{ type: "string" }, { type: "null" }] },
    target_1_rationale: { anyOf: [{ type: "string" }, { type: "null" }] }, target_2_rationale: { anyOf: [{ type: "string" }, { type: "null" }] },
    risk_notes: { type: "array", items: { type: "string" } },
    visual_quality: { type: "string", enum: ["CLEAR", "PARTIAL", "UNREADABLE"] },
    unreadable_fields: { type: "array", items: { type: "string" } },
  },
};

export class SwingModelError extends Error {
  constructor(message: string, readonly failureKind: string, readonly attempts: SwingAttempt[]) { super(message); this.name = "SwingModelError"; }
}

function validateMacro(value: unknown, market: SwingMarket): SwingMacroResult {
  const parsed = swingMacroResultSchema.parse(value);
  const keys = SWING_MARKET_CONFIG[market].macro.map((anchor) => anchor.key);
  if (Object.keys(parsed.anchors).length !== keys.length || keys.some((key) => !parsed.anchors[key])) throw new z.ZodError([{ code: "custom", path: ["anchors"], message: "Macro result does not contain the required market anchors.", input: parsed.anchors }]);
  if (Object.values(parsed.anchors).some((anchor) => anchor.stance === "UNREADABLE" || anchor.visual_quality === "UNREADABLE")) throw new z.ZodError([{ code: "custom", path: ["anchors"], message: "Macro result contains an unreadable anchor.", input: parsed.anchors }]);
  const ruleTriggered = market === "US"
    ? parsed.anchors.SPY?.stance === "BEARISH" && parsed.anchors.QQQ?.stance === "BEARISH" && parsed.anchors.TLT?.stance === "BEARISH"
    : parsed.anchors.NIFTY50?.stance === "BEARISH" && parsed.anchors.BANKNIFTY?.stance === "BEARISH" && parsed.anchors.INDIAVIX?.stance === "BULLISH";
  if (ruleTriggered && !parsed.high_beta_long_forbidden) throw new z.ZodError([{ code: "custom", path: ["high_beta_long_forbidden"], message: "Macro result contradicts the locked high-beta regime rule.", input: parsed.high_beta_long_forbidden }]);
  return parsed;
}

function classify(error: unknown, response: Response | null) {
  if (error instanceof Error && error.name === "AbortError") return "canceled";
  if (error instanceof Error && /timeout/i.test(error.name)) return "timeout";
  if (response && !response.ok) return response.status >= 500 || [408, 409, 429].includes(response.status) ? "http_transient" : "http_terminal";
  if (error instanceof SyntaxError) return "malformed_json";
  if (error instanceof z.ZodError) return "validation_error";
  return "invalid_response";
}

function safeMessage(kind: string) {
  if (kind === "timeout") return "OpenRouter Swing analysis timed out.";
  if (kind === "canceled") return "Swing analysis was canceled.";
  if (kind === "http_terminal") return "OpenRouter rejected the Swing analysis request.";
  if (kind === "http_transient") return "OpenRouter was temporarily unavailable for Swing analysis.";
  return "OpenRouter returned an invalid Swing analysis response.";
}

export class SwingOpenRouterProvider {
  async analyzeMacro(input: { prompt: string; images: Buffer[]; market?: SwingMarket; signal?: AbortSignal }) {
    const market = input.market ?? "US";
    return Sentry.startSpan({ name: "Analyze Swing macro", op: "specialstock.swing.model", attributes: { "specialstock.swing.phase": "macro", "specialstock.swing.image_count": input.images.length } }, () =>
      this.analyze<SwingMacroResult>({ phase: "macro", prompt: input.prompt, images: input.images, schema: macroJsonSchema(market), validate: (value) => validateMacro(value, market), maxTokens: 6500, signal: input.signal }));
  }

  async analyzeCandidate(input: { prompt: string; image: Buffer; symbol: string; signal?: AbortSignal }) {
    return Sentry.startSpan({ name: "Analyze Swing candidate", op: "specialstock.swing.model", attributes: { "specialstock.swing.phase": "stock", "specialstock.swing.image_count": 1 } }, () =>
      this.analyze<SwingCandidateResult>({ phase: "stock", prompt: input.prompt, images: [input.image], schema: stockJsonSchema, validate: (value) => {
        const parsed = swingCandidateResultSchema.parse(value);
        if (parsed.symbol !== input.symbol) throw new Error("Swing response symbol does not match the candidate.");
        return parsed;
      }, maxTokens: 6500, signal: input.signal }));
  }

  private async analyze<T>(input: { phase: "macro" | "stock"; prompt: string; images: Buffer[]; schema: Record<string, unknown>; validate(value: unknown): T; maxTokens: number; signal?: AbortSignal }) {
    const env = getServerEnv();
    if (!env.OPENROUTER_API_KEY) throw new SwingModelError("OPENROUTER_API_KEY is not configured.", "not_configured", []);
    const attempts: SwingAttempt[] = [];
    for (let index = 0; index < 2; index += 1) {
      const prompt = index === 0 ? input.prompt : `${input.prompt}\n\nCORRECTION: The previous response was empty, malformed, schema-invalid, or semantically invalid. Return one corrected JSON object only.`;
      const promptHash = sha256(prompt);
      const requestSettings = { temperature: 0.1, max_tokens: input.maxTokens, streaming: false, structured_output: true, model: SWING_MODEL_ID };
      const started = performance.now();
      let response: Response | null = null;
      let raw: z.infer<typeof responseSchema> | null = null;
      try {
        response = await fetch(env.OPENROUTER_API_URL, {
          method: "POST", cache: "no-store", signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(SWING_OPENROUTER_TIMEOUT_MS)]) : AbortSignal.timeout(SWING_OPENROUTER_TIMEOUT_MS),
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
          body: JSON.stringify({
            model: SWING_MODEL_ID, temperature: 0.1, max_tokens: input.maxTokens, stream: false,
            provider: { require_parameters: true },
            messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...input.images.map((image) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}` } }))] }],
            response_format: { type: "json_schema", json_schema: { name: input.phase === "macro" ? "swing_macro" : "swing_candidate", strict: true, schema: input.schema } },
          }),
        });
        if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}.`);
        raw = responseSchema.parse(await response.json());
        const content = raw.choices[0]?.message.content;
        if (!content) throw new Error("OpenRouter returned an empty response.");
        if (raw.choices[0]?.finish_reason === "length") {
          attempts.push({
            attemptNumber: index + 1, status: "failed", failureKind: "token_limit", queueWaitMs: 0,
            latencyMs: Math.round(performance.now() - started), inputTokens: raw.usage?.prompt_tokens ?? null,
            outputTokens: raw.usage?.completion_tokens ?? null, costUsd: raw.usage?.cost ?? null,
            reasoningTokens: raw.usage?.completion_tokens_details?.reasoning_tokens ?? null,
            responseId: raw.id ?? null, actualModel: raw.model ?? null, actualProvider: raw.provider ?? null,
            requestSettings, rawResponse: raw, promptSnapshot: prompt, promptHash,
          });
          throw new SwingModelError("OpenRouter Swing response exceeded its token limit.", "token_limit", attempts);
        }
        const result = input.validate(JSON.parse(content));
        const attempt: SwingAttempt = {
          attemptNumber: index + 1, status: "valid", failureKind: null, queueWaitMs: 0, latencyMs: Math.round(performance.now() - started),
          inputTokens: raw.usage?.prompt_tokens ?? null, outputTokens: raw.usage?.completion_tokens ?? null, costUsd: raw.usage?.cost ?? null,
          reasoningTokens: raw.usage?.completion_tokens_details?.reasoning_tokens ?? null,
          responseId: raw.id ?? null, actualModel: raw.model ?? null, actualProvider: raw.provider ?? null,
          requestSettings, rawResponse: raw, promptSnapshot: prompt, promptHash,
        };
        attempts.push(attempt);
        return { result, attempts, actualModel: raw.model ?? null, actualProvider: raw.provider ?? null };
      } catch (error) {
        if (error instanceof SwingModelError) throw error;
        const failureKind = classify(error, response);
        attempts.push({
          attemptNumber: index + 1, status: "failed", failureKind, queueWaitMs: 0, latencyMs: Math.round(performance.now() - started),
          inputTokens: raw?.usage?.prompt_tokens ?? null, outputTokens: raw?.usage?.completion_tokens ?? null, costUsd: raw?.usage?.cost ?? null,
          reasoningTokens: raw?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
          responseId: raw?.id ?? null, actualModel: raw?.model ?? null, actualProvider: raw?.provider ?? null,
          requestSettings, rawResponse: raw, promptSnapshot: prompt, promptHash,
        });
        const retryable = ["http_transient", "malformed_json", "validation_error", "invalid_response"].includes(failureKind);
        if (!retryable || index === 1) throw new SwingModelError(safeMessage(failureKind), failureKind, attempts);
        Sentry.logger.info("swing.model.retry", { "specialstock.swing.phase": input.phase, "specialstock.swing.failure_kind": failureKind, "specialstock.swing.attempt": index + 1 });
      }
    }
    throw new SwingModelError("OpenRouter Swing analysis failed.", "invalid_response", attempts);
  }
}
