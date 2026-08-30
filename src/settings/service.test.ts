import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL_ID } from "@/models/catalog";
import type { ModelCatalogProvider } from "@/models/provider";
import { watchlistSchema } from "@/settings/schema";
import { DEFAULT_SETTINGS, SettingsService, getSettingsSnapshot } from "@/settings/service";
import type { AppSettings, SettingsRepository } from "@/settings/types";

class MemorySettingsRepository implements SettingsRepository {
  constructor(public settings: AppSettings = DEFAULT_SETTINGS) {}
  async get() { return this.settings; }
  async update(input: Omit<AppSettings, "updatedAt">) {
    this.settings = { ...input, updatedAt: new Date() };
    return this.settings;
  }
}

const catalog: ModelCatalogProvider = {
  id: "test",
  async getAvailability() {
    return [{
      id: DEFAULT_MODEL_ID,
      status: "available" as const,
      supportsImageInput: true,
      supportsStructuredOutput: true,
      reason: "available",
      checkedAt: new Date(),
    }];
  },
};

describe("watchlist validation", () => {
  it("normalizes exchange-aware entries", () => {
    expect(watchlistSchema.parse([
      { symbol: " aapl ", exchange: "NASDAQ" },
      { symbol: "ibm", exchange: "NYSE" },
    ])).toEqual([
      { symbol: "AAPL", exchange: "NASDAQ", automaticScanEnabled: false },
      { symbol: "IBM", exchange: "NYSE", automaticScanEnabled: false },
    ]);
  });

  it("rejects duplicate tickers and unsupported exchanges", () => {
    expect(watchlistSchema.safeParse([
      { symbol: "AAPL", exchange: "NASDAQ" },
      { symbol: "aapl", exchange: "NYSE" },
    ]).success).toBe(false);
    expect(watchlistSchema.safeParse([{ symbol: "AAPL", exchange: "OTC" }]).success).toBe(false);
  });
});

describe("SettingsService", () => {
  it("persists exchange mapping and keeps a newly added stock off unless enabled", async () => {
    const service = new SettingsService(new MemorySettingsRepository(), catalog);
    const updated = await service.update({
      watchlist: [{ symbol: "IBM", exchange: "NYSE" }],
      activeModel: DEFAULT_MODEL_ID,
    });
    expect(updated.watchlist).toEqual([{ symbol: "IBM", exchange: "NYSE", automaticScanEnabled: false }]);
    expect(updated.automaticScansEnabled).toBe(false);
    expect(updated.activeModel).toBe("google/gemini-2.5-pro");
    expect(updated.fallbackModel).toBeNull();
    expect(updated.comparisonEnabled).toBe(false);
  });

  it("preserves per-symbol automation when editing the watchlist", async () => {
    const repository = new MemorySettingsRepository({
      ...DEFAULT_SETTINGS,
      watchlist: [{ symbol: "NVDA", exchange: "NASDAQ", automaticScanEnabled: true }],
    });
    const service = new SettingsService(repository, catalog);
    const updated = await service.update({
      watchlist: [{ symbol: "NVDA", exchange: "NYSE" }],
      activeModel: DEFAULT_MODEL_ID,
    });
    expect(updated.watchlist[0]).toEqual({
      symbol: "NVDA",
      exchange: "NYSE",
      automaticScanEnabled: true,
    });
  });
});

describe("getSettingsSnapshot", () => {
  it("shows approved defaults when persistence is unavailable", async () => {
    const repository: SettingsRepository = {
      async get() { throw new Error("offline"); },
      async update() { throw new Error("offline"); },
    };
    await expect(getSettingsSnapshot(repository)).resolves.toMatchObject({
      persistence: "unavailable",
      settings: { activeModel: DEFAULT_MODEL_ID, automaticScansEnabled: false },
    });
  });
});
