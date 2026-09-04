// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SchedulerClient } from "@/app/(protected)/dashboard/scheduler-client";
import type { SymbolDashboardItem } from "@/dashboard/data";
import { DEFAULT_WATCHLIST } from "@/models/catalog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const sentryMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  startNewTrace: vi.fn((callback: () => unknown) => callback()),
  suppressTracing: vi.fn((callback: () => unknown) => callback()),
  spans: [] as Array<{ options: { op?: string }; setAttributes: ReturnType<typeof vi.fn> }>,
}));
vi.mock("@sentry/nextjs", () => ({
  logger: { info: sentryMocks.info, warn: sentryMocks.warn },
  startNewTrace: sentryMocks.startNewTrace,
  suppressTracing: sentryMocks.suppressTracing,
  startSpan: vi.fn(async (options, callback) => {
    const span = { setAttribute: vi.fn(), setAttributes: vi.fn(), setStatus: vi.fn() };
    sentryMocks.spans.push({ options, setAttributes: span.setAttributes });
    return callback(span);
  }),
}));

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
    sentryMocks.info.mockReset();
    sentryMocks.warn.mockReset();
    sentryMocks.startNewTrace.mockClear();
    sentryMocks.suppressTracing.mockClear();
    sentryMocks.spans.length = 0;
    localStorage.clear();
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("submits one server-side due batch and refreshes once after partial failure", async () => {
    const symbols = DEFAULT_WATCHLIST.map((entry) => entry.symbol);
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
      if (url === "/api/scans/batch") {
        expect(JSON.parse(String(init?.body))).toEqual({ slotKey });
        return Response.json({
          slotKey,
          total: symbols.length,
          counts: {
            completed: 19,
            alreadyCompleted: 0,
            alreadyRunning: 0,
            terminalFailed: 0,
            failed: 1,
          },
          results: symbols.map((symbol) => ({
            symbol,
            outcome: symbol === "MSFT" ? "failed" : "completed",
          })),
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SchedulerClient
        initialItems={symbols.map(item)}
        database={{ engine: "PGlite", status: "connected" }}
        budget={{ todayUsd: 0, monthUsd: 0, targetUsd: 1 }}
        demoMode={false}
      />,
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.filter(([request]) => String(request) === "/api/scans/batch")).toHaveLength(1);
    expect(sentryMocks.startNewTrace).toHaveBeenCalledTimes(1);
    expect(sentryMocks.suppressTracing).toHaveBeenCalledTimes(
      fetchMock.mock.calls.filter(([request]) => String(request) === "/api/scans/status").length,
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sentryMocks.info).toHaveBeenCalledWith(
      "scheduler.leadership.changed",
      expect.objectContaining({ "specialstock.scheduler.is_leader": true }),
    );
    expect(sentryMocks.info).toHaveBeenCalledWith(
      "scheduler.status.changed",
      expect.objectContaining({
        "specialstock.scheduler.due": true,
        "specialstock.scheduler.enabled_count": 20,
      }),
    );
    expect(sentryMocks.info).toHaveBeenCalledWith(
      "scheduler.batch.completed",
      expect.objectContaining({
        "specialstock.scan.batch_completed": 19,
        "specialstock.scan.batch_failed": 1,
      }),
    );
    expect(sentryMocks.spans.some(({ options }) => options.op === "specialstock.scheduler.batch")).toBe(true);
  });

  it("retries the same automatic slot after a manual collision and then marks it complete", async () => {
    vi.useFakeTimers();
    const symbols = DEFAULT_WATCHLIST.map((entry) => entry.symbol);
    const slotKey = "postclose:2026-08-31T15:50:00.000Z";
    let batchCalls = 0;
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
          runningScans: batchCalls ? [] : [{ symbol: "MSFT", startedAt: "2026-08-31T15:55:00.000Z" }],
          scanRevision: null,
        });
      }
      if (url === "/api/scans/status" && init?.method === "POST") return Response.json({ ok: true });
      if (url === "/api/scans/batch") {
        expect(JSON.parse(String(init?.body))).toEqual({ slotKey });
        batchCalls += 1;
        return Response.json({
          slotKey,
          total: symbols.length,
          counts: batchCalls === 1
            ? { completed: 19, alreadyCompleted: 0, alreadyRunning: 1, terminalFailed: 0, failed: 0 }
            : { completed: 1, alreadyCompleted: 19, alreadyRunning: 0, terminalFailed: 0, failed: 0 },
          results: symbols.map((symbol) => ({
            symbol,
            outcome: batchCalls === 1 && symbol === "MSFT"
              ? "already_running"
              : batchCalls === 1 ? "completed" : symbol === "MSFT" ? "completed" : "already_completed",
          })),
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SchedulerClient
        initialItems={symbols.map(item)}
        database={{ engine: "PGlite", status: "connected" }}
        budget={{ todayUsd: 0, monthUsd: 0, targetUsd: 1 }}
        demoMode={false}
      />,
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(batchCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(batchCalls).toBe(2);
    expect(sentryMocks.startNewTrace).toHaveBeenCalledTimes(2);
    expect(sentryMocks.suppressTracing).toHaveBeenCalledTimes(
      fetchMock.mock.calls.filter(([request]) => String(request) === "/api/scans/status").length,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(batchCalls).toBe(2);
  });

  it("starts independent traces for manual and Auto-setting actions", async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = String(request);
      if (url === "/api/scans/status" && !init?.method) {
        return Response.json({
          due: false,
          slotKey: null,
          nextScanAt: null,
          marketOpen: true,
          automaticSymbols: ["AAPL", "MSFT"],
          enabledCount: 2,
          configuredCount: 2,
          runningScans: [],
          scanRevision: null,
        });
      }
      if (url === "/api/scans/status" && init?.method === "POST") return Response.json({ ok: true });
      if (url === "/api/scans/AAPL") return Response.json({ status: "completed" });
      if (url === "/api/scans/manual-batch") {
        return Response.json({
          total: 1,
          counts: { completed: 1, reused: 0, alreadyRunning: 0, failed: 0 },
          results: [{ symbol: "AAPL", timeframe: "5m", outcome: "completed" }],
        });
      }
      if (url === "/api/settings/automatic-scans") {
        return Response.json({
          watchlist: [
            { symbol: "AAPL", automaticScanEnabled: false },
            { symbol: "MSFT", automaticScanEnabled: true },
          ],
          enabledCount: 1,
          updatedAt: "2026-09-04T13:00:00.000Z",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SchedulerClient
        initialItems={[item("AAPL"), item("MSFT")]}
        database={{ engine: "PGlite", status: "connected" }}
        budget={{ todayUsd: 0, monthUsd: 0, targetUsd: 1 }}
        demoMode={false}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/scans/status", { cache: "no-store" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Run now" })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/scans/AAPL",
      expect.objectContaining({ method: "POST" }),
    ));

    fireEvent.click(screen.getByRole("checkbox", { name: "Select AAPL" }));
    fireEvent.click(screen.getByRole("button", { name: "Run selected" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/scans/manual-batch",
      expect.objectContaining({ method: "POST" }),
    ));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Run selected" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select AAPL" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable auto" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/automatic-scans",
      expect.objectContaining({ method: "PATCH" }),
    ));

    expect(sentryMocks.startNewTrace).toHaveBeenCalledTimes(3);
    expect(sentryMocks.spans.map(({ options }) => options.op)).toEqual(expect.arrayContaining([
      "specialstock.scan.manual.request",
      "specialstock.scan.manual_batch.request",
      "ui.action.click",
    ]));
  });
});
