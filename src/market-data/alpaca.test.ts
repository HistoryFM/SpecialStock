import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlpacaMarketDataProvider } from "@/market-data/alpaca";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "a-secure-test-secret-that-is-at-least-32-characters");
  vi.stubEnv("APP_PASSWORD_HASH", "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy");
  vi.stubEnv("ALPACA_API_KEY", "test-alpaca-key");
  vi.stubEnv("ALPACA_API_SECRET", "test-alpaca-secret");
});

describe("Alpaca market calendar", () => {
  it("interprets exchange clock times in America/New_York", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{
      date: "2026-08-31",
      open: "09:30",
      close: "16:00",
    }])));

    await expect(new AlpacaMarketDataProvider().getSession(
      new Date("2026-08-31T15:55:00.000Z"),
    )).resolves.toMatchObject({
      date: "2026-08-31",
      opensAt: new Date("2026-08-31T13:30:00.000Z"),
      closesAt: new Date("2026-08-31T20:00:00.000Z"),
      isRegularSession: true,
    });
  });
});
