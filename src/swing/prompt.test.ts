import { describe, expect, it } from "vitest";

import { sha256 } from "@/lib/hash";
import { buildSwingMacroPrompt, buildSwingStockPrompt, DEFAULT_SWING_INSTRUCTIONS, swingPromptPreview } from "@/swing/prompt";
import type { SwingMacroResult, SwingPromptRevisionSnapshot } from "@/swing/types";

const revision: SwingPromptRevisionSnapshot = {
  id: "00000000-0000-4000-8000-000000000001",
  revisionNumber: 1,
  instructions: DEFAULT_SWING_INSTRUCTIONS,
  instructionsHash: sha256(DEFAULT_SWING_INSTRUCTIONS),
  templateVersion: "swing-daily-v2",
};

const macro: SwingMacroResult = {
  regime: "CHOPPING_RANGE", long_bias: "NEUTRAL", short_bias: "NEUTRAL", high_beta_long_forbidden: false,
  summary: "Mixed visible daily structure.",
  anchors: Object.fromEntries(["SPY", "QQQ", "GLD", "TLT"].map((symbol) => [symbol, {
    stance: "NEUTRAL", observation: `${symbol} is readable.`, visual_quality: "CLEAR",
  }])) as SwingMacroResult["anchors"],
};

const chart = (symbol: string) => ({
  symbol, chartSymbol: `NASDAQ:${symbol}`, capturedAt: "2026-09-15T19:50:10.000Z",
  range: { from: "2025-03-15T19:50:10.000Z", to: "2026-09-15T19:50:10.000Z" },
  interval: "1D" as const, session: "regular" as const, barStatus: "open" as const,
  imageHash: `${symbol.toLowerCase()}-sha256`,
});

describe("Swing prompt assembly", () => {
  it("locks the exact seeded editable instructions", () => {
    expect(sha256(DEFAULT_SWING_INSTRUCTIONS)).toBe("d8f0fb041a4606659e01f20e245adc3224340c4b05860f551799f27ad524093e");
  });

  it("assembles macro metadata for exactly four labeled verified images", () => {
    const prompt = buildSwingMacroPrompt({ revision, charts: ["SPY", "QQQ", "GLD", "TLT"].map(chart) });
    for (const symbol of ["SPY", "QQQ", "GLD", "TLT"]) {
      expect(prompt).toContain(`${symbol}: NASDAQ:${symbol}`);
      expect(prompt).toContain(`${symbol.toLowerCase()}-sha256`);
    }
    expect(prompt).toContain("Execute Phase 1 only");
    expect(prompt).toContain("Do not browse, search, use tools");
    expect(prompt).not.toMatch(/\bOHLCV\b|\"close\"\s*:/i);
  });

  it("assembles one candidate image with locked macro JSON and server post-processing", () => {
    const prompt = buildSwingStockPrompt({ revision, chart: chart("AAPL"), macro });
    expect(prompt).toContain("aapl-sha256");
    expect(prompt).toContain(JSON.stringify(macro));
    expect(prompt).toContain("macro images are intentionally not resent");
    expect(prompt).toContain("Do not calculate risk-to-reward or proximity");
    expect(swingPromptPreview("x".repeat(100), "stock")).toContain("{chartSha256}");
  });
});
