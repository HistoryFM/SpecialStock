import { describe, expect, it } from "vitest";

import { FifoLimiter } from "@/analysis/compact-limiter";

describe("FifoLimiter", () => {
  it("admits in FIFO order, caps concurrency, and releases after every outcome", async () => {
    const limiter = new FifoLimiter(2);
    const admitted: number[] = [];
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];

    const work = Array.from({ length: 5 }, (_, index) => limiter.acquire().then((lease) => {
      admitted.push(index);
      active += 1;
      peak = Math.max(peak, active);
      releases.push(() => {
        active -= 1;
        lease.release();
      });
    }));

    await Promise.resolve();
    expect(admitted).toEqual([0, 1]);
    releases.shift()?.();
    await Promise.resolve();
    expect(admitted).toEqual([0, 1, 2]);
    releases.shift()?.();
    releases.shift()?.();
    await Promise.resolve();
    expect(admitted).toEqual([0, 1, 2, 3, 4]);
    releases.splice(0).forEach((release) => release());
    await Promise.all(work);
    expect(peak).toBe(2);
  });
});
