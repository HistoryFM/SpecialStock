// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FullAnalysisPanel } from "@/app/(protected)/symbols/[symbol]/full-analysis-panel";

const sentryMocks = vi.hoisted(() => ({
  startNewTrace: vi.fn((callback: () => unknown) => callback()),
  suppressTracing: vi.fn((callback: () => unknown) => callback()),
  spans: [] as Array<{ options: { op?: string } }>,
}));
const routerMocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));

vi.mock("@sentry/nextjs", () => ({
  startNewTrace: sentryMocks.startNewTrace,
  suppressTracing: sentryMocks.suppressTracing,
  startSpan: vi.fn(async (options, callback) => {
    sentryMocks.spans.push({ options });
    return callback({ setAttribute: vi.fn(), setAttributes: vi.fn(), setStatus: vi.fn() });
  }),
}));

const base = {
  analysisId: "11111111-1111-4111-8111-111111111111",
  error: null,
  full: null,
} as const;

describe("full analysis tracing", () => {
  beforeEach(() => {
    sentryMocks.startNewTrace.mockClear();
    sentryMocks.suppressTracing.mockClear();
    sentryMocks.spans.length = 0;
    routerMocks.refresh.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts an independent trace for the full-analysis request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, state: "available", full: {
      setupType: "Breakout", immediateBias: "Up", broaderTrend: "Up",
      candlestickAnalysis: "Visible", vwapKeltnerAnalysis: "Above", cciAnalysis: "Firm",
      supportingEvidence: [], conflictingEvidence: [], deeperScenario: "Hold", summary: "Bullish",
    } })));

    render(<FullAnalysisPanel initial={{ ...base, state: "not_requested" }} />);

    await waitFor(() => expect(sentryMocks.startNewTrace).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(routerMocks.refresh).toHaveBeenCalledTimes(1));
    expect(sentryMocks.spans).toContainEqual({
      options: expect.objectContaining({ op: "specialstock.analysis.full.request", forceTransaction: true }),
    });
  });

  it("suppresses tracing for status polling", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, state: "running" })));

    render(<FullAnalysisPanel initial={{ ...base, state: "running" }} />);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(sentryMocks.suppressTracing).toHaveBeenCalledTimes(1);
    expect(sentryMocks.startNewTrace).not.toHaveBeenCalled();
  });

  it("shows all four phases and keeps the conflict resolution prominent", () => {
    render(<FullAnalysisPanel initial={{ ...base, state: "available", full: {
      setupType: null, immediateBias: null, broaderTrend: null, candlestickAnalysis: null,
      vwapKeltnerAnalysis: null, cciAnalysis: null, supportingEvidence: null,
      conflictingEvidence: null, deeperScenario: null, summary: "Stand aside.",
      report: {
        version: 1,
        phase1: "Visible downtrend near lower Keltner line.",
        phase2: "ADX rising; RSI below midline; MACD negative; CCI below zero; CMF negative.",
        phase3: "Three red candles with stable volume near the lower band.",
        phase4: "Trend aligns, but price is extended. No trade at the lower band. Watch for a clear break on a fresh scan.",
      },
    } }} />);
    expect(screen.getByTestId("four-phase-report")).toHaveTextContent("01 · Broad structural architecture");
    expect(screen.getByTestId("four-phase-report")).toHaveTextContent("02 · Lower technical indicators");
    expect(screen.getByTestId("four-phase-report")).toHaveTextContent("03 · Three-candle micro-audit");
    expect(screen.getByTestId("four-phase-report")).toHaveTextContent("04 · Conflict resolution and hierarchy");
    expect(screen.getByText(/Trend aligns, but price is extended/)).toBeVisible();
  });

  it("keeps old reports readable and does not request detail without a retained chart", () => {
    const { rerender } = render(<FullAnalysisPanel initial={{ ...base, state: "available", full: {
      setupType: "Legacy setup", immediateBias: "Legacy read", broaderTrend: "Older trend",
      candlestickAnalysis: "Older candles", vwapKeltnerAnalysis: "Older lines", cciAnalysis: "Older CCI",
      supportingEvidence: [], conflictingEvidence: [], deeperScenario: "Older risk", summary: "Older summary",
    } }} />);
    expect(screen.getByTestId("legacy-report")).toHaveTextContent("Legacy read");
    expect(screen.getByRole("heading", { name: "Legacy setup" })).toBeVisible();
    rerender(<FullAnalysisPanel initial={{ ...base, state: "not_requested" }} chartAvailable={false} />);
    expect(screen.getByText(/no retained chart/)).toBeVisible();
    expect(sentryMocks.startNewTrace).not.toHaveBeenCalled();
  });
});
