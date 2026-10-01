import { describe, expect, it } from "vitest";

import { calculateGex, fetchSchwabChain } from "@/gex/live";

describe("live GEX calculation", () => {
  const chain = {
    underlyingPrice: 100,
    callExpDateMap: { "2026-09-25:0": { "95": [{ strikePrice: 95, gamma: 0.02, openInterest: 100, totalVolume: 1000 }], "105": [{ strikePrice: 105, gamma: 0.04, openInterest: 200, totalVolume: 10 }] } },
    putExpDateMap: { "2026-09-25:0": { "95": [{ strikePrice: 95, gamma: 0.03, openInterest: 300, totalVolume: 5 }], "105": [{ strikePrice: 105, gamma: 0.01, openInterest: 50, totalVolume: 900 }] } },
  };

  it("uses dollar GEX for walls while exposing separate open-interest-plus-volume activity walls", () => {
    const result = calculateGex(chain, "TEST", "daily", new Date("2026-09-25T14:00:00Z"));
    expect(result).toMatchObject({ symbol: "TEST", category: "daily", expiration: "2026-09-25", underlyingPrice: 100, callWall: 105, putWall: 95, activityCallWall: 95, activityPutWall: 105, gexFlip: 99.82758620689656, netGex: 500000 });
  });

  it("retries a temporary Schwab rate limit and returns the recovered chain", async () => {
    const previousToken = process.env.SCHWAB_ACCESS_TOKEN;
    process.env.SCHWAB_ACCESS_TOKEN = "test-token";
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 429 })
        : new Response(JSON.stringify(chain), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      await expect(fetchSchwabChain("SPY", fetcher as typeof fetch)).resolves.toMatchObject({ underlyingPrice: 100 });
      expect(calls).toBe(2);
    } finally {
      if (previousToken === undefined) delete process.env.SCHWAB_ACCESS_TOKEN;
      else process.env.SCHWAB_ACCESS_TOKEN = previousToken;
    }
  });
});
