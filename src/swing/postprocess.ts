import type { SwingCandidateResult } from "@/swing/types";

export type ProcessedSwingCandidate = SwingCandidateResult & {
  riskReward: number | null;
  proximityPercent: number | null;
  originalDirection: SwingCandidateResult["direction"];
  rejectionReason: string | null;
  watchlistPosition: number;
};

const rounded = (value: number) => Math.round(value * 100) / 100;

export function postProcessSwingCandidate(result: SwingCandidateResult, watchlistPosition: number): ProcessedSwingCandidate {
  let riskReward: number | null = null;
  let proximityPercent: number | null = null;
  let direction = result.direction;
  let rejectionReason: string | null = null;
  if (direction !== "NO_TRADE") {
    const risk = direction === "LONG"
      ? result.entry_zone_high! - result.stop_loss!
      : result.stop_loss! - result.entry_zone_low!;
    const reward = direction === "LONG"
      ? result.profit_target_1! - result.entry_zone_high!
      : result.entry_zone_low! - result.profit_target_1!;
    if (risk <= 0 || reward <= 0) throw new Error("Directional result has non-positive risk or reward.");
    riskReward = rounded(reward / risk);
    if (result.observed_price !== null) {
      const distance = result.observed_price < result.entry_zone_low!
        ? result.entry_zone_low! - result.observed_price
        : result.observed_price > result.entry_zone_high!
          ? result.observed_price - result.entry_zone_high!
          : 0;
      proximityPercent = rounded(distance / result.observed_price * 100);
    }
    if (riskReward < 1.5) {
      direction = "NO_TRADE";
      rejectionReason = `Server downgrade: conservative risk-to-reward ${riskReward.toFixed(2)} is below 1.50.`;
    } else if (proximityPercent === null) {
      direction = "NO_TRADE";
      rejectionReason = "Server downgrade: observed price is unavailable, so entry proximity cannot be calculated.";
    }
  }
  return { ...result, direction, originalDirection: result.direction, riskReward, proximityPercent, rejectionReason, watchlistPosition };
}

const convictionOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
const qualityOrder = { CLEAR: 0, PARTIAL: 1, UNREADABLE: 2 } as const;

export function sortActionableSwingCandidates<T extends Pick<ProcessedSwingCandidate, "direction" | "proximityPercent" | "conviction_level" | "riskReward" | "visual_quality" | "watchlistPosition">>(items: T[]): T[] {
  return items.filter((item) => item.direction !== "NO_TRADE").toSorted((left, right) =>
    (left.proximityPercent ?? Number.POSITIVE_INFINITY) - (right.proximityPercent ?? Number.POSITIVE_INFINITY)
    || convictionOrder[left.conviction_level] - convictionOrder[right.conviction_level]
    || (right.riskReward ?? 0) - (left.riskReward ?? 0)
    || qualityOrder[left.visual_quality] - qualityOrder[right.visual_quality]
    || left.watchlistPosition - right.watchlistPosition,
  );
}
