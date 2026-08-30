export type ScanMode = "scheduled" | "manual";

export const MANUAL_SMOKE_SLOT_KIND = "manual_smoke";

export type ScanExecutionPolicy = {
  modelAttempts: 1 | 2;
  allowFallback: boolean;
  allowComparison: boolean;
  includeInEvaluation: boolean;
  createThesis: boolean;
};

export function getScanExecutionPolicy(mode: ScanMode): ScanExecutionPolicy {
  if (mode === "manual") {
    return {
      modelAttempts: 1,
      allowFallback: false,
      allowComparison: false,
      includeInEvaluation: false,
      createThesis: false,
    };
  }

  return {
    modelAttempts: 2,
    allowFallback: false,
    allowComparison: false,
    includeInEvaluation: true,
    createThesis: true,
  };
}

export function isEvaluationEligibleSlotKind(slotKind: string): boolean {
  return slotKind !== MANUAL_SMOKE_SLOT_KIND;
}
