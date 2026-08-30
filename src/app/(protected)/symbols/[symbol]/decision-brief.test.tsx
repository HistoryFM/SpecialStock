// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DecisionBrief } from "@/app/(protected)/symbols/[symbol]/decision-brief";

afterEach(cleanup);

const directional = {
  verdict: "bullish" as const,
  conviction: "high" as const,
  setupType: "VWAP reclaim",
  summary: "Momentum and structure align.",
  immediateBias: "Continuation is favored.",
  primaryTarget: "105",
  invalidationLevel: "98",
  supportLevels: [98],
  resistanceLevels: [105],
  supportingEvidence: ["One", "Two", "Three", "Four"],
  conflictingEvidence: ["Countertrend daily bar"],
  deeperScenario: "Failure below VWAP negates the setup.",
  broaderTrend: "Daily structure remains constructive.",
};

describe("DecisionBrief", () => {
  it("prioritizes the directional thesis, three signals, and level distances", () => {
    render(<DecisionBrief analysis={directional} snapshotPrice={100} />);
    expect(screen.getByRole("heading", { name: "bullish" })).toBeVisible();
    expect(screen.getByText("+5.00% from analysis price")).toBeVisible();
    expect(screen.getByText("-2.00% from analysis price")).toBeVisible();
    expect(screen.getByText("Three")).toBeVisible();
    expect(screen.queryByText("Four")).not.toBeInTheDocument();
  });

  it("replaces empty levels with an explicit no-trade explanation", () => {
    render(<DecisionBrief analysis={{ ...directional, verdict: "no_trade", primaryTarget: null, invalidationLevel: null }} snapshotPrice={100} />);
    expect(screen.getByRole("heading", { name: "no trade" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Why no trade" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "What would need to change" })).toBeVisible();
    expect(screen.queryByText("Primary target")).not.toBeInTheDocument();
  });
});
