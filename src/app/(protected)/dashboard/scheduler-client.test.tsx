// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SchedulerClient } from "@/app/(protected)/dashboard/scheduler-client";
import type { SymbolDashboardItem } from "@/dashboard/data";

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

  it("runs enabled symbols sequentially for the due server slot", async () => {
    const events: string[] = [];
    const slotKey = "postclose:2026-08-31T15:50:00.000Z";
    const fetchMock = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = String(request);
      if (url === "/api/scans/status" && !init?.method) {
        return Response.json({
          due: true,
          slotKey,
          nextScanAt: "2026-08-31T16:00:10.000Z",
          marketOpen: true,
          automaticSymbols: ["AAPL", "MSFT"],
          enabledCount: 2,
          configuredCount: 2,
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
        await Promise.resolve();
        events.push(`finish:${symbol}`);
        expect(JSON.parse(String(init?.body))).toEqual({ mode: "scheduled", slotKey });
        return Response.json({ status: "completed" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SchedulerClient
        initialItems={[item("AAPL"), item("MSFT")]}
        database={{ engine: "PGlite", status: "connected" }}
        budget={{ todayUsd: 0, monthUsd: 0, capUsd: 1 }}
        demoMode={false}
      />,
    );

    await waitFor(() => expect(events).toEqual([
      "start:AAPL",
      "finish:AAPL",
      "start:MSFT",
      "finish:MSFT",
    ]));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
