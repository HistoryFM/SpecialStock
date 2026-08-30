import { describe, expect, it } from "vitest";

import {
  automaticScanSymbols,
  updateAutomaticScanEntries,
} from "@/settings/automatic-scans";
import type { WatchlistEntry } from "@/settings/types";

const watchlist: WatchlistEntry[] = [
  { symbol: "AAPL", exchange: "NASDAQ", automaticScanEnabled: true },
  { symbol: "IBM", exchange: "NYSE", automaticScanEnabled: false },
  { symbol: "SPY", exchange: "AMEX", automaticScanEnabled: true },
];

describe("per-symbol automatic scans", () => {
  it("returns only enabled symbols in configured order", () => {
    expect(automaticScanSymbols(watchlist)).toEqual(["AAPL", "SPY"]);
  });

  it("updates selected entries without changing other watchlist data", () => {
    expect(updateAutomaticScanEntries(watchlist, ["IBM", "SPY"], true)).toEqual([
      watchlist[0],
      { ...watchlist[1], automaticScanEnabled: true },
      watchlist[2],
    ]);
  });

  it("rejects an update containing an unconfigured symbol", () => {
    expect(updateAutomaticScanEntries(watchlist, ["TSLA"], true)).toBeNull();
  });
});
