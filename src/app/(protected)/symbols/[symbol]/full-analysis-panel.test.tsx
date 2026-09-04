// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FullAnalysisPanel } from "@/app/(protected)/symbols/[symbol]/full-analysis-panel";

const sentryMocks = vi.hoisted(() => ({
  startNewTrace: vi.fn((callback: () => unknown) => callback()),
  suppressTracing: vi.fn((callback: () => unknown) => callback()),
  spans: [] as Array<{ options: { op?: string } }>,
}));

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
});
