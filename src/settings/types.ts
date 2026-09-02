import type { ModelId } from "@/models/catalog";

export const WATCHLIST_EXCHANGES = ["NASDAQ", "NYSE", "AMEX"] as const;
export type WatchlistExchange = (typeof WATCHLIST_EXCHANGES)[number];
export type WatchlistEntry = {
  symbol: string;
  exchange: WatchlistExchange;
  automaticScanEnabled: boolean;
};

export type AppSettings = {
  watchlist: WatchlistEntry[];
  activeModel: ModelId;
  fallbackModel: ModelId | null;
  comparisonModel: ModelId | null;
  comparisonEnabled: boolean;
  automaticScansEnabled: boolean;
  notificationsEnabled: boolean;
  dailyBudgetUsd: number;
  updatedAt: Date;
};

export interface SettingsRepository {
  get(): Promise<AppSettings>;
  update(input: Omit<AppSettings, "updatedAt">, expectedUpdatedAt?: Date): Promise<AppSettings>;
}
