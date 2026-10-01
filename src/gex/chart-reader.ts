import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/config/env";
import { DEFAULT_MODEL_ID } from "@/models/catalog";

const responseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().nullable().optional() }).optional(),
    cost: z.number().optional(),
  }).optional(),
});
const readingSchema = z.object({
  readable: z.boolean(),
  lastPrice: z.number().nullable(),
  vwap: z.number().nullable(),
  keltnerUpper: z.number().nullable(),
  keltnerMiddle: z.number().nullable(),
  keltnerLower: z.number().nullable(),
}).strict().superRefine((value, context) => {
  if (!value.readable && Object.values(value).slice(1).some((reading) => reading !== null)) context.addIssue({ code: "custom", message: "Unreadable charts cannot return values." });
  if (value.readable && Object.values(value).slice(1).some((reading) => reading === null)) context.addIssue({ code: "custom", message: "Readable charts need all values." });
});

export type GexChartReading = z.infer<typeof readingSchema>;
export type GexModelUsage = {
  purpose: "chart_values" | "gex_flip";
  requestedModel: string;
  actualModel: string | null;
  actualProvider: string | null;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
};
export type GexChartReadResult = { values: GexChartReading; usage: GexModelUsage };
export class GexChartReaderError extends Error { constructor(message: string) { super(message); this.name = "GexChartReaderError"; } }

const schema = {
  type: "object", additionalProperties: false,
  required: ["readable", "lastPrice", "vwap", "keltnerUpper", "keltnerMiddle", "keltnerLower"],
  properties: {
    readable: { type: "boolean" },
    lastPrice: { anyOf: [{ type: "number" }, { type: "null" }] },
    vwap: { anyOf: [{ type: "number" }, { type: "null" }] },
    keltnerUpper: { anyOf: [{ type: "number" }, { type: "null" }] },
    keltnerMiddle: { anyOf: [{ type: "number" }, { type: "null" }] },
    keltnerLower: { anyOf: [{ type: "number" }, { type: "null" }] },
  },
};

export class GexChartValueReader {
  async read(input: { png: Buffer; fetcher?: typeof fetch }): Promise<GexChartReadResult> {
    const env = getServerEnv();
    if (!env.OPENROUTER_API_KEY) throw new GexChartReaderError("OPENROUTER_API_KEY is not configured.");
    let response: Response;
    try {
      response = await (input.fetcher ?? fetch)(env.OPENROUTER_API_URL, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(45_000),
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:3000", "X-Title": "SpecialStock" },
        body: JSON.stringify({
          model: DEFAULT_MODEL_ID, temperature: 0, max_tokens: 256, reasoning: { effort: "low", exclude: true },
          response_format: { type: "json_schema", json_schema: { name: "gex_chart_values", strict: true, schema } },
          messages: [{ role: "user", content: [
            { type: "text", text: "Read only the visible latest chart values. Return the current last price, VWAP, and Keltner Channels upper, middle, and lower legend values. Do not calculate, infer, explain, recommend, or perform trade analysis. If any requested value is not clearly visible, set readable false and every numeric field null." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${input.png.toString("base64")}` } },
          ] }],
        }),
      });
    } catch { throw new GexChartReaderError("The GEX chart-value reader did not respond before its deadline."); }
    if (!response.ok) throw new GexChartReaderError("The GEX chart-value reader could not read the chart.");
    let parsed: z.infer<typeof responseSchema>;
    try { parsed = responseSchema.parse(await response.json()); }
    catch { throw new GexChartReaderError("The GEX chart-value reader returned an invalid response."); }
    const content = parsed.choices[0]!.message.content;
    if (!content) throw new GexChartReaderError("The GEX chart-value reader returned no values.");
    try {
      return {
        values: readingSchema.parse(JSON.parse(content)),
        usage: {
          purpose: "chart_values",
          requestedModel: DEFAULT_MODEL_ID,
          actualModel: parsed.model ?? null,
          actualProvider: parsed.provider ?? null,
          responseId: parsed.id ?? null,
          inputTokens: parsed.usage?.prompt_tokens ?? null,
          outputTokens: parsed.usage?.completion_tokens ?? null,
          reasoningTokens: parsed.usage?.completion_tokens_details?.reasoning_tokens ?? null,
          costUsd: parsed.usage?.cost ?? null,
        },
      };
    }
    catch { throw new GexChartReaderError("The GEX chart-value reader could not verify the visible values."); }
  }
}
