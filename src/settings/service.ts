import {
  DEFAULT_MODEL_ID,
  DEFAULT_WATCHLIST,
  type ModelId,
} from "@/models/catalog";
import type { ModelCatalogProvider } from "@/models/provider";
import { unstable_rethrow } from "next/navigation";
import { settingsInputSchema, type SettingsInput } from "@/settings/schema";
import type {
  AppSettings,
  SettingsRepository,
  WatchlistEntry,
  WatchlistExchange,
} from "@/settings/types";

export const DEFAULT_SETTINGS: AppSettings = {
  watchlist: DEFAULT_WATCHLIST.map((entry) => ({ ...entry })),
  activeModel: DEFAULT_MODEL_ID,
  fallbackModel: null,
  comparisonModel: null,
  comparisonEnabled: false,
  automaticScansEnabled: false,
  notificationsEnabled: false,
  dailyBudgetUsd: 10,
  updatedAt: new Date(0),
};

export class ModelUnavailableError extends Error {
  constructor(readonly modelId: ModelId) {
    super(`Model ${modelId} is not currently available with image input.`);
    this.name = "ModelUnavailableError";
  }
}

export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly modelCatalog: ModelCatalogProvider,
  ) {}

  async get(): Promise<AppSettings> {
    return this.repository.get();
  }

  async update(
    rawInput: {
      watchlist: Array<{
        symbol: string;
        exchange: WatchlistExchange;
        automaticScanEnabled?: boolean;
      }>;
      activeModel: ModelId;
    } & Partial<Omit<SettingsInput, "watchlist" | "activeModel">>,
  ): Promise<AppSettings> {
    const current = await this.repository.get();
    const automaticState = new Map(
      current.watchlist.map((entry) => [entry.symbol, entry.automaticScanEnabled]),
    );
    const watchlist: WatchlistEntry[] = rawInput.watchlist.map((entry) => ({
      ...entry,
      automaticScanEnabled:
        entry.automaticScanEnabled ?? automaticState.get(entry.symbol) ?? false,
    }));
    const input = settingsInputSchema.parse({
      ...current,
      ...rawInput,
      watchlist,
      activeModel: DEFAULT_MODEL_ID,
      fallbackModel: null,
      comparisonModel: null,
      comparisonEnabled: false,
    });

    const changedModels = [
      input.activeModel !== current.activeModel ? input.activeModel : null,
      input.fallbackModel !== current.fallbackModel ? input.fallbackModel : null,
      input.comparisonModel !== current.comparisonModel ? input.comparisonModel : null,
    ].filter((model): model is ModelId => model !== null);
    if (changedModels.length) {
      const availability = await this.modelCatalog.getAvailability();
      for (const modelId of changedModels) {
        const selectedModel = availability.find((model) => model.id === modelId);
        if (selectedModel?.status !== "available") {
          throw new ModelUnavailableError(modelId);
        }
      }
    }

    return this.repository.update(input);
  }
}

export type SettingsSnapshot =
  | { settings: AppSettings; persistence: "connected"; error: null }
  | { settings: AppSettings; persistence: "unavailable"; error: string };

export async function getSettingsSnapshot(
  repository: SettingsRepository,
): Promise<SettingsSnapshot> {
  try {
    return { settings: await repository.get(), persistence: "connected", error: null };
  } catch (error) {
    unstable_rethrow(error);
    return {
      settings: DEFAULT_SETTINGS,
      persistence: "unavailable",
      error: "Database settings are unavailable. Showing approved defaults without saving changes.",
    };
  }
}
