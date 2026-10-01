import { describe, expect, it } from "vitest";

import { buildGexScriptExport } from "@/gex/script-export";

const rows = [{
  symbol: "AAPL", category: "daily" as const, expiration: "2026-09-30", underlyingPrice: 230,
  gexFlip: 228, callWall: 235, putWall: 225, activityCallWall: 235, activityPutWall: 225,
  netGex: 1, expectedMove: 4, calculatedAt: "2026-09-29T14:00:00.000Z",
  levels: { callEntry: 235, callTarget: 239, callStop: 232, putEntry: 225, putTarget: 221, putStop: 228 },
  chart: null,
}];

describe("GEX script export", () => {
  it("uses current rows and preserves every non-live line in an active template", () => {
    const output = buildGexScriptExport("engine", rows, "# My template\n# STEP 1\ndef val_FlipLine = Double.NaN;\ndef customStepOne = 7;\n# STEP 2: retained code\ndef preserved = 1;");
    expect(output).toContain('if GetSymbol() == "AAPL" then 228.0000');
    expect(output).toContain("# My template");
    expect(output).toContain("def customStepOne = 7;");
    expect(output).toContain("# STEP 2: retained code\ndef preserved = 1;");
  });

  it("builds a scanner script from the current rows", () => {
    expect(buildGexScriptExport("scanner", rows, null)).toContain('if GetSymbol() == "AAPL" then 235.0000');
  });

  it("uses the uploaded template ticker order for regenerated live values", () => {
    const later = { ...rows[0]!, symbol: "MSFT", gexFlip: 500, callWall: 505, putWall: 495 };
    const output = buildGexScriptExport("engine", [rows[0]!, later], '# STEP 1\ndef val_FlipLine = if GetSymbol() == "MSFT" then 1 else if GetSymbol() == "AAPL" then 1 else Double.NaN;\n# STEP 2\ndef retained = 1;');
    expect(output.indexOf('GetSymbol() == "MSFT"')).toBeLessThan(output.indexOf('GetSymbol() == "AAPL"'));
  });

  it("preserves template-only symbols when a live run has unavailable symbols", () => {
    const output = buildGexScriptExport(
      "engine",
      rows,
      '# STEP 1\ndef val_FlipLine = if GetSymbol() == "MSFT" then 500.0000 else if GetSymbol() == "AAPL" then 1.0000 else Double.NaN;\n# STEP 2\ndef retained = 1;',
    );
    expect(output).toContain('GetSymbol() == "MSFT" then 500.0000');
    expect(output).toContain('GetSymbol() == "AAPL" then 228.0000');
    expect(output.indexOf('GetSymbol() == "MSFT"')).toBeLessThan(output.indexOf('GetSymbol() == "AAPL"'));
  });
});
