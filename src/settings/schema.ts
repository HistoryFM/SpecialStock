import { z } from "zod";

import { DEFAULT_MODEL_ID, MODEL_IDS, type ModelId } from "@/models/catalog";
import { WATCHLIST_EXCHANGES } from "@/settings/types";

export const tickerSchema = z
  .string()
  .trim()
  .transform((symbol) => symbol.toUpperCase())
  .pipe(
    z
      .string()
      .min(1)
      .max(10)
      .regex(/^[A-Z][A-Z0-9.-]*$/, "Use a valid US stock symbol"),
  );

export const watchlistEntrySchema = z.object({
  symbol: tickerSchema,
  exchange: z.enum(WATCHLIST_EXCHANGES),
  automaticScanEnabled: z.boolean().default(false),
});

export const watchlistSchema = z
  .array(watchlistEntrySchema)
  .min(1, "Add at least one symbol")
  .max(20, "Use at most 20 symbols")
  .superRefine((entries, context) => {
    if (new Set(entries.map((entry) => entry.symbol)).size !== entries.length) {
      context.addIssue({
        code: "custom",
        message: "Each watchlist symbol must be unique",
      });
    }
  });

export const settingsInputSchema = z.object({
  watchlist: watchlistSchema,
  activeModel: z.enum(MODEL_IDS).default(DEFAULT_MODEL_ID),
  fallbackModel: z.enum(MODEL_IDS).nullable(),
  comparisonModel: z.enum(MODEL_IDS).nullable(),
  comparisonEnabled: z.boolean(),
  automaticScansEnabled: z.boolean(),
  notificationsEnabled: z.boolean(),
  dailyBudgetUsd: z.number().min(1).max(100),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

export function parseWatchlistFields(
  symbols: FormDataEntryValue[],
  exchanges: FormDataEntryValue[],
) {
  return symbols.flatMap((value, index) => {
    const symbol = typeof value === "string" ? value.trim() : "";
    if (!symbol) return [];
    return [{ symbol, exchange: exchanges[index] }];
  });
}

export function isModelId(value: string): value is ModelId {
  return MODEL_IDS.some((modelId) => modelId === value);
}
