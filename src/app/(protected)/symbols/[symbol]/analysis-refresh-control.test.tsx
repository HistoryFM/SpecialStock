// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisRefreshControl } from "@/app/(protected)/symbols/[symbol]/analysis-refresh-control";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
afterEach(cleanup);

describe("AnalysisRefreshControl", () => {
  it("offers a contextual refresh after failure while retaining the valid analysis", () => {
    render(<AnalysisRefreshControl currentAnalysisId="valid" initialFreshness="failed" preserveSelection={false} symbol="AAPL" />);
    expect(screen.getByText(/last valid analysis retained/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Run fresh analysis" })).toBeVisible();
  });

  it("does not offer a paid action for a preserved historical selection", () => {
    render(<AnalysisRefreshControl currentAnalysisId="historical" initialFreshness="stale" preserveSelection symbol="AAPL" />);
    expect(screen.queryByRole("button", { name: "Run fresh analysis" })).not.toBeInTheDocument();
  });

  it("labels a closed session without presenting live freshness", () => {
    render(<AnalysisRefreshControl currentAnalysisId="valid" initialFreshness="market_closed" preserveSelection={false} symbol="AAPL" />);
    expect(screen.getByText(/market closed/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run fresh analysis" })).not.toBeInTheDocument();
  });

  it("clears running state when the completed analysis becomes current", () => {
    const { rerender } = render(
      <AnalysisRefreshControl currentAnalysisId="old" initialFreshness="running" key="old" preserveSelection={false} symbol="AAPL" />,
    );

    rerender(
      <AnalysisRefreshControl currentAnalysisId="new" initialFreshness="fresh" key="new" preserveSelection={false} symbol="AAPL" />,
    );

    expect(screen.getByText("Analysis is current")).toBeVisible();
    expect(screen.queryByText("Fresh analysis running")).not.toBeInTheDocument();
  });
});
