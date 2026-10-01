import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/config/env";
import { DEFAULT_MODEL_ID } from "@/models/catalog";
import type { GexModelUsage } from "@/gex/chart-reader";
import { getActiveGexTemplate } from "@/gex/repository";

const responseSchema = z.object({
  id: z.string().optional(), model: z.string().optional(), provider: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), completion_tokens_details: z.object({ reasoning_tokens: z.number().nullable().optional() }).optional(), cost: z.number().optional() }).optional(),
});

const resultSchema = z.object({
  ticker: z.string().min(1), current_spot: z.number().positive(), calculated_zero_gamma_flip: z.number().positive(),
  active_regime: z.enum(["POSITIVE_GAMMA", "NEGATIVE_GAMMA"]),
  institutional_call_wall: z.object({ strike: z.number().positive(), distance_pct: z.number() }),
  institutional_put_wall: z.object({ strike: z.number().positive(), distance_pct: z.number() }),
  tactical_signals: z.object({ breakout_cascade_trigger: z.number().positive(), saturation_floor_boundary: z.number().positive() }),
}).strict();

type RawContract = { strikePrice?: unknown; gamma?: unknown; volatility?: unknown; openInterest?: unknown; totalVolume?: unknown; volume?: unknown };
export type GexFlipResult = z.infer<typeof resultSchema>;

const outputSchema = {
  type: "object", additionalProperties: false,
  required: ["ticker", "current_spot", "calculated_zero_gamma_flip", "active_regime", "institutional_call_wall", "institutional_put_wall", "tactical_signals"],
  properties: {
    ticker: { type: "string" }, current_spot: { type: "number" }, calculated_zero_gamma_flip: { type: "number" }, active_regime: { type: "string", enum: ["POSITIVE_GAMMA", "NEGATIVE_GAMMA"] },
    institutional_call_wall: { type: "object", additionalProperties: false, required: ["strike", "distance_pct"], properties: { strike: { type: "number" }, distance_pct: { type: "number" } } },
    institutional_put_wall: { type: "object", additionalProperties: false, required: ["strike", "distance_pct"], properties: { strike: { type: "number" }, distance_pct: { type: "number" } } },
    tactical_signals: { type: "object", additionalProperties: false, required: ["breakout_cascade_trigger", "saturation_floor_boundary"], properties: { breakout_cascade_trigger: { type: "number" }, saturation_floor_boundary: { type: "number" } } },
  },
};

export const DEFAULT_GEX_FLIP_PROMPT = `You are a deterministic quantitative risk engine specializing in options market microstructure and market maker inventory mechanics. Your sole task is to ingest a raw option chain text payload for a target asset and calculate the exact Intraday Zero-Gamma Flip Price.

CORE FORMULA ARRAY (MARKET MAKERS NET EXPOSURE ANALYSIS):
- Total GEX per Strike = GEX_Call + GEX_Put
- GEX_Call = -1 * (Call_OI + Call_Volume) * Call_Gamma * Spot_Price^2 * 0.01 * 100
- GEX_Put = +1 * (Put_OI + Put_Volume) * Put_Gamma * Spot_Price^2 * 0.01 * 100
- Zero-Gamma Flip Price = The exact spot price where Total GEX = 0

INSTRUCTIONS FOR EXECUTION:
1. Parse the raw option chain block. Use Strike, Call/Put Open Interest, Call/Put Intraday Volume, and Gamma values.
2. If Gamma is missing, derive it only from the supplied IV with Black-Scholes.
3. Compute net dollar GEX per strike, locate adjacent positive/negative strikes, and linearly interpolate the exact zero-gamma coordinate.
4. Identify the institutional call and put walls from the highest call/put volume plus open-interest cluster.
5. Return only the requested JSON object. Do not explain or recommend trades.`;

function finite(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function contracts(contracts: RawContract[]) {
  return contracts.map((contract) => ({ strike: finite(contract.strikePrice), open_interest: finite(contract.openInterest), volume: finite(contract.totalVolume) ?? finite(contract.volume) ?? 0, gamma: finite(contract.gamma), implied_volatility: finite(contract.volatility) })).filter((contract) => contract.strike !== null);
}

export class GexFlipReaderError extends Error { constructor(message: string) { super(message); this.name = "GexFlipReaderError"; } }

export class GexFlipReader {
  async calculate(input: { symbol: string; spot: number; expiration: string; calls: RawContract[]; puts: RawContract[]; fetcher?: typeof fetch }): Promise<{ result: GexFlipResult; usage: GexModelUsage }> {
    const env = getServerEnv();
    if (!env.OPENROUTER_API_KEY) throw new GexFlipReaderError("OPENROUTER_API_KEY is not configured.");
    let response: Response;
    try {
      response = await (input.fetcher ?? fetch)(env.OPENROUTER_API_URL, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:3000", "X-Title": "SpecialStock" },
        body: JSON.stringify({ model: DEFAULT_MODEL_ID, temperature: 0, max_tokens: 768, reasoning: { effort: "low", exclude: true }, response_format: { type: "json_schema", json_schema: { name: "gex_flip", strict: true, schema: outputSchema } }, messages: [{ role: "user", content: [{ type: "text", text: `${await getActiveGexTemplate("flip_prompt") ?? DEFAULT_GEX_FLIP_PROMPT}\n\nRAW OPTION CHAIN:\n${JSON.stringify({ ticker: input.symbol, current_spot: input.spot, expiration: input.expiration, calls: contracts(input.calls), puts: contracts(input.puts) })}` }] }] }),
      });
    } catch { throw new GexFlipReaderError("The Gemini GEX-flip calculation did not respond before its deadline; the deterministic flip was retained."); }
    if (!response.ok) throw new GexFlipReaderError("The Gemini GEX-flip calculation could not be completed; the deterministic flip was retained.");
    let raw: z.infer<typeof responseSchema>;
    try { raw = responseSchema.parse(await response.json()); } catch { throw new GexFlipReaderError("The Gemini GEX-flip calculation returned an invalid response; the deterministic flip was retained."); }
    const content = raw.choices[0]!.message.content;
    if (!content) throw new GexFlipReaderError("The Gemini GEX-flip calculation returned no result; the deterministic flip was retained.");
    let result: GexFlipResult;
    try { result = resultSchema.parse(JSON.parse(content)); } catch { throw new GexFlipReaderError("The Gemini GEX-flip result could not be verified; the deterministic flip was retained."); }
    if (result.ticker.toUpperCase() !== input.symbol.toUpperCase()) throw new GexFlipReaderError("The Gemini GEX-flip result did not match the requested ticker; the deterministic flip was retained.");
    return { result, usage: { purpose: "gex_flip", requestedModel: DEFAULT_MODEL_ID, actualModel: raw.model ?? null, actualProvider: raw.provider ?? null, responseId: raw.id ?? null, inputTokens: raw.usage?.prompt_tokens ?? null, outputTokens: raw.usage?.completion_tokens ?? null, reasoningTokens: raw.usage?.completion_tokens_details?.reasoning_tokens ?? null, costUsd: raw.usage?.cost ?? null } };
  }
}
