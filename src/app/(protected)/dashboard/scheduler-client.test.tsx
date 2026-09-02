// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SchedulerClient } from "@/app/(protected)/dashboard/scheduler-client";
import type { SymbolDashboardItem } from "@/dashboard/data";
import { DEFAULT_WATCHLIST } from "@/models/catalog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function item(symbol: string): SymbolDashboardItem {
  return {
    symbol,
    exchange: "NASDAQ",
    automaticScanEnabled: true,
    slotId: null,
    analysisId: null,
    artifactId: null,
    status: "awaiting_scan",
    slotKind: null,
    scannedAt: null,
    attemptStartedAt: null,
    attemptCompletedAt: null,
    attemptIsRunning: false,
    resultCompletedAt: null,
    sourceAt: null,
    freshnessSeconds: null,
    source: "Chart-Img / TradingView",
    latestPrice: null,
    verdict: null,
    conviction: null,
    summary: null,
    target: null,
    invalidation: null,
    model: "Gemini 2.5 Pro",
    latencyMs: null,
    costUsd: null,
    error: null,
    resultIsCurrent: false,
  };
}

describe("automatic scan scheduler", () => {
  beforeEach(() => {
    refresh.mockReset();
    localStorage.clear();
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("runs a due slot concurrently, keeps successful siblings, and refreshes once", async () => {
    const symbols = DEFAULT_WATCHLIST.map((entry) => entry.symbol);
    const events: string[] = [];
    let releaseBatch: (() => void) | undefined;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    const slotKey = "postclose:2026-08-31T15:50:00.000Z";
    const fetchMock = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = String(request);
      if (url === "/api/scans/status" && !init?.method) {
        return Response.json({
          due: true,
          slotKey,
          nextScanAt: "2026-08-31T16:00:10.000Z",
          marketOpen: true,
          automaticSymbols: symbols,
          enabledCount: symbols.length,
          configuredCount: symbols.length,
          runningScans: [],
          scanRevision: null,
        });
      }
      if (url === "/api/scans/status" && init?.method === "POST") {
        return Response.json({ ok: true });
      }
      if (url.startsWith("/api/scans/")) {
        const symbol = url.split("/").at(-1)!;
        events.push(`start:${symbol}`);
        if (events.filter((event) => event.startsWith("start:")).length === symbols.length) {
          releaseBatch?.();
        }
        await batchGate;
        events.push(`finish:${symbol}`);
        expect(JSON.parse(String(init?.body))).toEqual({ mode: "scheduled", slotKey });
        return symbol === "MSFT"
          ? Response.json({ error: "mock provider failure" }, { status: 502 })
          : Response.json({ status: "completed" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SchedulerClient
        initialItems={symbols.map(item)}
        database={{ engine: "PGlite", status: "connected" }}
        budget={{ todayUsd: 0, monthUsd: 0, capUsd: 1 }}
        demoMode={false}
      />,
    );

    await waitFor(() => expect(events.filter((event) => event.startsWith("finish:"))).toHaveLength(20));
    expect(events.slice(0, 20)).toEqual(symbols.map((symbol) => `start:${symbol}`));
    expect(new Set(events.slice(20))).toEqual(new Set(symbols.map((symbol) => `finish:${symbol}`)));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
