import { COMPACT_INFERENCE_PROFILE } from "@/analysis/inference-profiles";

export type CompactProviderLease = {
  queueWaitMs: number;
  activeCount: number;
  release: () => void;
};

export class FifoLimiter {
  private active = 0;
  private readonly queue: Array<{
    queuedAt: number;
    resolve: (lease: CompactProviderLease) => void;
  }> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Limiter capacity must be positive.");
  }

  acquire(): Promise<CompactProviderLease> {
    const queuedAt = performance.now();
    return new Promise((resolve) => {
      this.queue.push({ queuedAt, resolve });
      this.admit();
    });
  }

  private admit() {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.active += 1;
      let released = false;
      next.resolve({
        queueWaitMs: Math.round(performance.now() - next.queuedAt),
        activeCount: this.active,
        release: () => {
          if (released) return;
          released = true;
          this.active -= 1;
          this.admit();
        },
      });
    }
  }
}

export const compactProviderLimiter = new FifoLimiter(
  COMPACT_INFERENCE_PROFILE.concurrencyLimit,
);
