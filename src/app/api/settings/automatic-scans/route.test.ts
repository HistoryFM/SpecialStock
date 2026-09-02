import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  captureException: vi.fn(),
  spans: [] as Array<{ options: { op?: string }; setAttributes: ReturnType<typeof vi.fn> }>,
}));

vi.mock("@sentry/nextjs", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error },
  captureException: mocks.captureException,
  startSpan: vi.fn(async (options, callback) => {
    const span = { setAttribute: vi.fn(), setAttributes: vi.fn(), setStatus: vi.fn() };
    mocks.spans.push({ options, setAttributes: span.setAttributes });
    return callback(span);
  }),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "local" } })) }));
vi.mock("@/auth/authorization", () => ({ isAuthorizedSession: vi.fn(() => true) }));

const initialWatchlist = [
  { symbol: "AAPL", exchange: "NASDAQ" as const, automaticScanEnabled: true },
  { symbol: "MSFT", exchange: "NASDAQ" as const, automaticScanEnabled: false },
];
const initialUpdatedAt = new Date("2026-09-02T18:00:00.000Z");

vi.mock("@/db/client", () => ({
  getDatabase: vi.fn(async () => ({
    transaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
      let pendingWatchlist = initialWatchlist;
      let pendingUpdatedAt = initialUpdatedAt;
      const transaction = {
        insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
        select: () => ({ from: () => ({ where: async () => [{ watchlist: initialWatchlist, updatedAt: initialUpdatedAt }] }) }),
        update: () => ({
          set: (values: { watchlist: typeof initialWatchlist; updatedAt: Date }) => {
            pendingWatchlist = values.watchlist;
            pendingUpdatedAt = values.updatedAt;
            return {
              where: () => ({
                returning: async () => [{ watchlist: pendingWatchlist, updatedAt: pendingUpdatedAt }],
              }),
            };
          },
        }),
      };
      return callback(transaction);
    },
  })),
}));

import { PATCH } from "@/app/api/settings/automatic-scans/route";

describe("automatic scan settings telemetry", () => {
  beforeEach(() => {
    mocks.info.mockReset();
    mocks.warn.mockReset();
    mocks.error.mockReset();
    mocks.captureException.mockReset();
    mocks.spans.length = 0;
  });

  it("records the requested change and authoritative before/after state", async () => {
    const response = await PATCH(new Request("http://localhost/api/settings/automatic-scans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: ["MSFT"], enabled: true }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabledCount: 2 });
    expect(mocks.info).toHaveBeenCalledWith(
      "settings.auto.updated",
      expect.objectContaining({
        "specialstock.settings.requested_symbols": "MSFT",
        "specialstock.settings.requested_enabled": true,
        "specialstock.settings.previous_enabled_count": 1,
        "specialstock.settings.enabled_count": 2,
        "specialstock.settings.changed_count": 1,
      }),
    );
    expect(mocks.spans.some(({ options }) => options.op === "specialstock.settings.auto_toggle")).toBe(true);
  });
});
