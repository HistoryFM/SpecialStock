// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WatchlistTable } from "@/app/(protected)/dashboard/watchlist-table";
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
  beforeEach(() => push.mockClear());

  const renderTable = (
    items: SymbolDashboardItem[],
    options: {
      busySymbols?: Set<string>;
      onRun?: (symbol: string) => void;
      onAutomaticScanChange?: (symbols: string[], enabled: boolean) => Promise<boolean>;
    } = {},
  ) => render(
    <WatchlistTable
      items={items}
      busySymbols={options.busySymbols ?? new Set()}
      onAutomaticScanChange={options.onAutomaticScanChange ?? vi.fn(async () => true)}
      onRun={options.onRun ?? vi.fn()}
    />,
  );

  it.each([0, 5, 10, 15])("renders %i dense rows", (count) => {
    renderTable(Array.from({ length: count }, (_, index) => item(index)));
    expect(screen.getAllByRole("row")).toHaveLength(count + 1);
    if (count === 0) expect(screen.getByText("No symbols match this filter.")).toBeVisible();
  });

  it("filters attention states and preserves last-valid failure detail", () => {
    const rows = [
      item(0),
      item(1, { status: "failed", error: "provider_timeout", resultIsCurrent: false }),
      item(2, { freshnessSeconds: 2_000 }),
      item(3, { analysisId: null, artifactId: null, verdict: null, conviction: null }),
    ];
    renderTable(rows);
    fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getAllByText(/Latest run failed · showing last valid/)[0]).toBeVisible();
    fireEvent.click(screen.getByText("Latest scan failed"));
    expect(screen.getByText("provider_timeout")).toBeVisible();
  });

  it("navigates from a row while isolating Run now", () => {
    const onRun = vi.fn();
    renderTable([item(1)], { onRun });
    const row = screen.getByRole("row", { name: "Open S01 analysis" });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/symbols/S01");

    fireEvent.click(within(row).getByRole("button", { name: "Run now" }));
    expect(onRun).toHaveBeenCalledWith("S01");
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("shows running feedback and disables only the same stock", () => {
    renderTable([item(1), item(2)], { busySymbols: new Set(["S01"]) });
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run now" })).toBeEnabled();
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
});
