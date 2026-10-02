import { describe, expect, it } from "vitest";

import { calculateGex, fetchSchwabChain, validRequestedExpiration } from "@/gex/live";

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

  it("uses the selected manual expiry, then the nearest later usable expiry", () => {
    const multiple = {
      ...chain,
      callExpDateMap: {
        ...chain.callExpDateMap,
        "2026-09-30:5": chain.callExpDateMap["2026-09-25:0"],
        "2026-10-02:7": chain.callExpDateMap["2026-09-25:0"],
      },
      putExpDateMap: {
        ...chain.putExpDateMap,
        "2026-09-30:5": chain.putExpDateMap["2026-09-25:0"],
        "2026-10-02:7": chain.putExpDateMap["2026-09-25:0"],
      },
    };
    const now = new Date("2026-09-25T14:00:00Z");
    expect(calculateGex(multiple, "TEST", "manual", now, "2026-09-30")).toMatchObject({ expiration: "2026-09-30", requestedExpiration: "2026-09-30" });
    expect(calculateGex(multiple, "TEST", "manual", now, "2026-09-29")).toMatchObject({ expiration: "2026-09-30", requestedExpiration: "2026-09-29" });
    expect(calculateGex(multiple, "TEST", "manual", now, "2026-10-01")).toMatchObject({ expiration: "2026-10-02", requestedExpiration: "2026-10-01" });
    expect(() => calculateGex(multiple, "TEST", "manual", now, "2026-10-03")).toThrow("no expiration on or after");
    expect(() => calculateGex(multiple, "TEST", "manual", now, "2026-09-24")).toThrow("valid current or future");
  });

  it("requires a real current or future manual date in New York time", () => {
    const now = new Date("2026-10-02T01:00:00Z");
    expect(validRequestedExpiration("2026-10-01", now)).toBe(true);
    expect(validRequestedExpiration("2026-09-30", now)).toBe(false);
    expect(validRequestedExpiration("2026-02-30", now)).toBe(false);
  });

  it("moves Weekly to the next Friday at 4 PM Eastern on Friday", () => {
    const calls = chain.callExpDateMap["2026-09-25:0"];
    const puts = chain.putExpDateMap["2026-09-25:0"];
    const expiries = { ...chain, callExpDateMap: { "2026-10-02:0": calls, "2026-10-09:7": calls }, putExpDateMap: { "2026-10-02:0": puts, "2026-10-09:7": puts } };
    expect(calculateGex(expiries, "TEST", "weekly", new Date("2026-10-02T19:59:59Z")).expiration).toBe("2026-10-02");
    expect(calculateGex(expiries, "TEST", "weekly", new Date("2026-10-02T20:00:00Z")).expiration).toBe("2026-10-09");
    expect(() => calculateGex({ ...expiries, callExpDateMap: { "2026-10-02:0": calls }, putExpDateMap: { "2026-10-02:0": puts } }, "TEST", "weekly", new Date("2026-10-02T20:00:00Z"))).toThrow();
  });

  it("moves Daily to the next available expiry at 4 PM Eastern", () => {
    const calls = chain.callExpDateMap["2026-09-25:0"];
    const puts = chain.putExpDateMap["2026-09-25:0"];
    const expiries = { ...chain, callExpDateMap: { "2026-10-02:0": calls, "2026-10-05:3": calls }, putExpDateMap: { "2026-10-02:0": puts, "2026-10-05:3": puts } };
    expect(calculateGex(expiries, "TEST", "daily", new Date("2026-10-02T19:59:59Z")).expiration).toBe("2026-10-02");
    expect(calculateGex(expiries, "TEST", "daily", new Date("2026-10-02T20:00:00Z")).expiration).toBe("2026-10-05");
    expect(() => calculateGex({ ...expiries, callExpDateMap: { "2026-10-02:0": calls }, putExpDateMap: { "2026-10-02:0": puts } }, "TEST", "daily", new Date("2026-10-02T20:00:00Z"))).toThrow("usable future expiration");
  });

  it("uses the exact third Friday and rolls Monthly to the following month at 4 PM Eastern", () => {
    const calls = chain.callExpDateMap["2026-09-25:0"];
    const puts = chain.putExpDateMap["2026-09-25:0"];
    const expiries = { ...chain, callExpDateMap: { "2026-10-16:14": calls, "2026-10-23:21": calls, "2026-11-20:49": calls }, putExpDateMap: { "2026-10-16:14": puts, "2026-10-23:21": puts, "2026-11-20:49": puts } };
    expect(calculateGex(expiries, "TEST", "monthly", new Date("2026-10-02T20:00:00Z")).expiration).toBe("2026-10-16");
    expect(calculateGex(expiries, "TEST", "monthly", new Date("2026-10-16T19:59:59Z")).expiration).toBe("2026-10-16");
    expect(calculateGex(expiries, "TEST", "monthly", new Date("2026-10-16T20:00:00Z")).expiration).toBe("2026-11-20");
    expect(calculateGex(expiries, "TEST", "monthly", new Date("2026-10-23T18:00:00Z")).expiration).toBe("2026-11-20");
    expect(() => calculateGex({ ...expiries, callExpDateMap: { "2026-10-23:21": calls }, putExpDateMap: { "2026-10-23:21": puts } }, "TEST", "monthly", new Date("2026-10-02T20:00:00Z"))).toThrow("monthly third-Friday expiration 2026-10-16");
    const yearEnd = { ...chain, callExpDateMap: { "2026-12-18:0": calls, "2027-01-15:28": calls }, putExpDateMap: { "2026-12-18:0": puts, "2027-01-15:28": puts } };
    expect(calculateGex(yearEnd, "TEST", "monthly", new Date("2026-12-18T20:59:59Z")).expiration).toBe("2026-12-18");
    expect(calculateGex(yearEnd, "TEST", "monthly", new Date("2026-12-18T21:00:00Z")).expiration).toBe("2027-01-15");
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
