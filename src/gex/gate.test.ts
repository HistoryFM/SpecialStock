import { describe, expect, it } from "vitest";

import { evaluateGexGate } from "@/gex/gate";

const levels = { callWall: 110, putWall: 90, gexFlip: 100 };

describe("GEX scanner gate", () => {
  it.each([
    [{ price: 111, previousPrice: 109 }, "CALL BREAKOUT"],
    [{ price: 89, previousPrice: 91 }, "PUT BREAKDOWN"],
    [{ price: 109.8, previousPrice: 110.1 }, "CEILING FADE"],
    [{ price: 90.2, previousPrice: 89.9 }, "PUT WALL BOUNCE"],
    [{ price: 109.8, previousPrice: 109.6 }, "AT CALL GATE"],
    [{ price: 90.2, previousPrice: 90.4 }, "AT PUT FLOOR"],
    [{ price: 95, previousPrice: 94 }, "FLUSH ZONE"],
    [{ price: 105, previousPrice: 104 }, "NORMAL CORRIDOR"],
  ] as const)("matches ThinkScript priority for %o", (prices, expected) => {
    expect(evaluateGexGate({ ...levels, ...prices })).toBe(expected);
  });

  it("does not invent outcomes for unreadable chart values", () => {
    expect(evaluateGexGate({ ...levels, price: 109.8, previousPrice: null })).toBe("Previous close unavailable");
    expect(evaluateGexGate({ ...levels, price: null, previousPrice: 100 })).toBe("Price unavailable");
  });
});
