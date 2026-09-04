// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ManualBatchRun,
  type ManualBatchSelectionResult,
  parseManualTimeframes,
  WatchlistTable,
} from "@/app/(protected)/dashboard/watchlist-table";
import type { SymbolDashboardItem } from "@/dashboard/data";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(cleanup);

function item(index: number, overrides: Partial<SymbolDashboardItem> = {}): SymbolDashboardItem {
  const symbol = `S${String(index).padStart(2, "0")}`;
  return {
    symbol,
    exchange: "NASDAQ",
    automaticScanEnabled: false,
    slotId: `slot-${index}`,
    analysisId: `analysis-${index}`,
    artifactId: `artifact-${index}`,
    status: "completed",
    slotKind: "manual",
    scannedAt: "2026-08-28T14:00:00.000Z",
    attemptStartedAt: "2026-08-28T13:59:50.000Z",
    attemptCompletedAt: "2026-08-28T14:00:00.000Z",
    attemptIsRunning: false,
    resultCompletedAt: "2026-08-28T14:00:00.000Z",
    sourceAt: "2026-08-28T13:55:00.000Z",
    freshnessSeconds: 30,
    source: "Alpaca IEX",
    latestPrice: 100 + index,
    verdict: index % 3 === 0 ? "no_trade" : index % 2 === 0 ? "bullish" : "bearish",
    conviction: "medium",
    summary: `A deliberately long setup summary for ${symbol} that must stay dense without changing the row height or hiding the action.`,
    target: 110 + index,
    invalidation: 90 + index,
    model: "openai/a-deliberately-long-model-identifier-for-layout-testing",
    latencyMs: 1200,
    costUsd: 0.001,
    error: null,
    resultIsCurrent: true,
    ...overrides,
  };
}

describe("WatchlistTable", () => {
  beforeEach(() => {
    push.mockClear();
    localStorage.clear();
  });

  const renderTable = (
    items: SymbolDashboardItem[],
    options: {
      busySymbols?: Set<string>;
      onRun?: (symbol: string, timeframe: "1m" | "5m" | "10m") => void;
      onRunSelected?: (runs: ManualBatchRun[]) => Promise<ManualBatchSelectionResult | null>;
      onAutomaticScanChange?: (symbols: string[], enabled: boolean) => Promise<boolean>;
    } = {},
  ) => render(
    <WatchlistTable
      items={items}
      busySymbols={options.busySymbols ?? new Set()}
      onAutomaticScanChange={options.onAutomaticScanChange ?? vi.fn(async () => true)}
      onRun={options.onRun ?? vi.fn()}
      onRunSelected={options.onRunSelected ?? vi.fn(async () => ({ results: [] }))}
    />,
  );

  it.each([0, 5, 10, 15])("renders %i dense rows", (count) => {
    renderTable(Array.from({ length: count }, (_, index) => item(index)));
    expect(screen.getAllByRole("row")).toHaveLength(count + 1);
    if (count === 0) expect(screen.getByText("No symbols match this filter.")).toBeVisible();
  });

  it("provides only direction filters", () => {
    const rows = [
      item(0),
      item(1, { status: "failed", error: "provider_timeout", resultIsCurrent: false }),
      item(2, { freshnessSeconds: 2_000 }),
      item(3, { analysisId: null, artifactId: null, verdict: null, conviction: null }),
    ];
    renderTable(rows);
    fireEvent.click(screen.getByRole("button", { name: "Bullish" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Bearish" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Needs attention" })).not.toBeInTheDocument();
  });

  it("navigates from a row while isolating Run now", () => {
    const onRun = vi.fn();
    renderTable([item(1)], { onRun });
    const row = screen.getByRole("row", { name: "Open S01 analysis" });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/symbols/S01");

    fireEvent.click(within(row).getByRole("button", { name: "Run now" }));
    expect(onRun).toHaveBeenCalledWith("S01", "5m");
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("shows running feedback and disables only the same stock", () => {
    renderTable([item(1), item(2)], { busySymbols: new Set(["S01"]) });
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
    expect(screen.getByLabelText("Manual timeframe for S01")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run now" })).toBeEnabled();
    expect(screen.getByLabelText("Manual timeframe for S02")).toBeEnabled();
    expect(screen.getAllByText(/New analysis running · showing previous/)[0]).toBeVisible();
  });

  it("makes conviction prominent and distinguishes current, failed, and empty results", () => {
    renderTable([
      item(1, { conviction: "high" }),
      item(2, { status: "failed", error: "chart_timeout", resultIsCurrent: false }),
      item(3, {
        slotId: null,
        analysisId: null,
        artifactId: null,
        status: "awaiting_scan",
        conviction: null,
        verdict: null,
        resultCompletedAt: null,
        resultIsCurrent: false,
      }),
    ]);
    expect(screen.getByText("High conviction")).toBeVisible();
    expect(screen.getAllByText(/Latest completed run/)[0]).toBeVisible();
    expect(screen.getAllByText(/Latest run failed · showing last valid/)[0]).toBeVisible();
    expect(screen.getAllByText("No completed analysis")[0]).toBeVisible();
  });

  it("uses server-observed running state even when this tab did not launch the scan", () => {
    renderTable([item(1, { status: "running", attemptIsRunning: true, resultIsCurrent: false })]);
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
    expect(screen.getAllByText(/New analysis running · showing previous/)[0]).toBeVisible();
  });

  it("bulk-enables automatic scanning for selected stocks", async () => {
    const onAutomaticScanChange = vi.fn(async () => true);
    renderTable([item(1), item(2)], { onAutomaticScanChange });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select S01" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select S02" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable auto" }));
    await waitFor(() => expect(onAutomaticScanChange).toHaveBeenCalledWith(["S01", "S02"], true));
  });

  it("sorts conviction high to low with missing last and configured ties", () => {
    renderTable([
      item(1, { conviction: "medium" }),
      item(2, { conviction: "high" }),
      item(3, { conviction: "high" }),
      item(4, { conviction: "low" }),
      item(5, { conviction: null }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Conviction" }));
    const symbols = screen.getAllByRole("row").slice(1).map((row) => within(row).getByRole("link").textContent?.slice(0, 3));
    expect(symbols).toEqual(["S02", "S03", "S01", "S04", "S05"]);
  });

  it("remembers independent row timeframes and uses them for row and selected runs", async () => {
    const onRun = vi.fn();
    const onRunSelected = vi.fn(async () => ({
      results: [
        { symbol: "S01", timeframe: "1m" as const, outcome: "completed" as const },
        { symbol: "S02", timeframe: "10m" as const, outcome: "failed" as const },
      ],
    }));
    renderTable([item(1), item(2)], { onRun, onRunSelected });
    expect(screen.getByLabelText("Manual timeframe for S01")).toHaveValue("5m");
    expect(screen.getByLabelText("Manual timeframe for S02")).toHaveValue("5m");
    fireEvent.change(screen.getByLabelText("Manual timeframe for S01"), { target: { value: "1m" } });
    fireEvent.change(screen.getByLabelText("Manual timeframe for S02"), { target: { value: "10m" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Run now" })[0]!);
    expect(onRun).toHaveBeenCalledWith("S01", "1m");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible stocks" }));
    fireEvent.click(screen.getByRole("button", { name: "Run selected" }));
    await waitFor(() => expect(onRunSelected).toHaveBeenCalledWith([
      { symbol: "S01", timeframe: "1m" },
      { symbol: "S02", timeframe: "10m" },
    ]));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select S01" })).not.toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Select S02" })).toBeChecked();
    expect(JSON.parse(localStorage.getItem("specialstock-manual-timeframes-v1")!)).toEqual({ S01: "1m", S02: "10m" });
  });

  it("restores valid per-stock preferences and rejects invalid stored values", async () => {
    localStorage.setItem("specialstock-manual-timeframe", "10m");
    localStorage.setItem("specialstock-manual-timeframes-v1", JSON.stringify({ S01: "1m", S02: "15m" }));
    renderTable([item(1), item(2)]);
    await waitFor(() => expect(screen.getByLabelText("Manual timeframe for S01")).toHaveValue("1m"));
    expect(screen.getByLabelText("Manual timeframe for S02")).toHaveValue("5m");
    expect(parseManualTimeframes("not-json")).toEqual({});
  });
});
