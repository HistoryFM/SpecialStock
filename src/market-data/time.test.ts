import { describe, expect, it } from "vitest";

import {
  canonicalScanSlot,
  dateFromMarketParts,
  nextScanTime,
  requestedScanSlot,
} from "@/market-data/time";

describe("market time", () => {
  it("converts New York times correctly across DST", () => {
    expect(dateFromMarketParts("2026-03-09", 9, 30).toISOString()).toBe("2026-03-09T13:30:00.000Z");
    expect(dateFromMarketParts("2026-11-02", 9, 30).toISOString()).toBe("2026-11-02T14:30:00.000Z");
  });

  it("runs the first slot at 9:35:10 and keeps it stable for the five-minute window", () => {
    const session = { opensAt: new Date("2026-08-28T13:30:00Z"), closesAt: new Date("2026-08-28T20:00:00Z"), isRegularSession: true };
    expect(canonicalScanSlot(new Date("2026-08-28T13:30:00Z"), session)).toBeNull();
    expect(canonicalScanSlot(new Date("2026-08-28T13:35:09Z"), session)).toBeNull();
    const first = canonicalScanSlot(new Date("2026-08-28T13:35:10Z"), session);
    expect(first).toMatchObject({
      kind: "postclose",
      idempotencyPart: "postclose:2026-08-28T13:30:00.000Z",
    });
    expect(canonicalScanSlot(new Date("2026-08-28T13:39:59Z"), session)?.idempotencyPart)
      .toBe(first?.idempotencyPart);
    expect(canonicalScanSlot(new Date("2026-08-28T13:40:10Z"), session)?.idempotencyPart)
      .toBe("postclose:2026-08-28T13:35:00.000Z");
  });

  it("runs the final normal-session slot at 3:55:10 and never starts a 4 PM slot", () => {
    const session = { opensAt: new Date("2026-08-28T13:30:00Z"), closesAt: new Date("2026-08-28T20:00:00Z"), isRegularSession: true };
    expect(canonicalScanSlot(new Date("2026-08-28T19:55:10Z"), session)?.idempotencyPart)
      .toBe("postclose:2026-08-28T19:50:00.000Z");
    expect(canonicalScanSlot(new Date("2026-08-28T19:59:59Z"), session)?.idempotencyPart)
      .toBe("postclose:2026-08-28T19:50:00.000Z");
    expect(canonicalScanSlot(new Date("2026-08-28T20:00:00Z"), session)).toBeNull();
    expect(nextScanTime(new Date("2026-08-28T19:55:10Z"), session)).toBeNull();
  });

  it("honors an early close supplied by the exchange calendar", () => {
    const session = { opensAt: new Date("2026-11-27T14:30:00Z"), closesAt: new Date("2026-11-27T18:00:00Z"), isRegularSession: true };
    expect(canonicalScanSlot(new Date("2026-11-27T17:55:10Z"), session)?.idempotencyPart)
      .toBe("postclose:2026-11-27T17:50:00.000Z");
    expect(canonicalScanSlot(new Date("2026-11-27T18:00:00Z"), session)).toBeNull();
  });

  it("rejects holidays and validates a stable requested slot for a slow sequential batch", () => {
    const closedSession = { opensAt: new Date("2026-09-07T13:30:00Z"), closesAt: new Date("2026-09-07T20:00:00Z"), isRegularSession: false };
    expect(canonicalScanSlot(new Date("2026-09-07T14:00:00Z"), closedSession)).toBeNull();

    const session = { opensAt: new Date("2026-08-28T13:30:00Z"), closesAt: new Date("2026-08-28T20:00:00Z"), isRegularSession: true };
    const key = "postclose:2026-08-28T13:30:00.000Z";
    expect(requestedScanSlot(key, new Date("2026-08-28T13:41:00Z"), session)?.idempotencyPart)
      .toBe(key);
    expect(requestedScanSlot(key, new Date("2026-08-28T13:45:11Z"), session)).toBeNull();
    expect(requestedScanSlot("postclose:not-a-date", new Date("2026-08-28T13:36:00Z"), session)).toBeNull();
  });
});
