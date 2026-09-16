import { z } from "zod";

import { tickerSchema, timeframeSchema, type BacktestModel, type ConversationTurn, type ModelUsage, type RunResult, type SavedRun } from "./types";

const relation = z.enum(["above", "below", "at_or_above", "at_or_below", "crosses_above", "crosses_below"]);
export const conditionAtomSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("price_sma"), ticker: tickerSchema, period: z.union([z.literal(50), z.literal(200)]), bandPct: z.number().min(-50).max(50).default(0), relation }).strict(),
  z.object({ kind: z.literal("rsi"), ticker: tickerSchema, period: z.number().int().min(2).max(100).default(14), threshold: z.number().min(0).max(100), relation }).strict(),
  z.object({ kind: z.literal("macd"), ticker: tickerSchema, fast: z.number().int().min(2).max(100).default(12), slow: z.number().int().min(3).max(200).default(26), signal: z.number().int().min(2).max(100).default(9), relation }).strict().refine((value) => value.fast < value.slow, "MACD fast period must be below slow period."),
]);
export type ConditionAtom = z.infer<typeof conditionAtomSchema>;
// An OR of AND groups; an event remains an event even when another filter fails.
export const conditionSchema = z.object({ any: z.array(z.array(conditionAtomSchema).min(1).max(6)).min(1).max(5) }).strict();
export type Condition = z.infer<typeof conditionSchema>;
export const allocationSchema = z.object({ ticker: tickerSchema, side: z.enum(["long", "short"]), percent: z.number().gt(0).max(100) }).strict();
export type Allocation = z.infer<typeof allocationSchema>;
export const settingsSchema = z.object({
  startingCapital: z.number().positive().max(1e9).default(1000), cashRate: z.number().min(0).max(100).default(0),
  borrowRate: z.number().min(0).max(100).default(0), slippage: z.number().min(0).max(20).default(0),
  fee: z.number().min(0).max(1e6).default(0),
  timeframe: timeframeSchema.default("daily"),
  startDate: z.union([z.literal("first_january"), z.iso.date()]).default("first_january"),
}).strict();
export const strategyPlanSchema = z.object({
  version: z.union([z.literal(2), z.literal(3)]), settings: settingsSchema.default(() => settingsSchema.parse({})),
  states: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), label: z.string().trim().min(1).max(120), allocations: z.array(allocationSchema).max(20) }).strict()).min(1).max(16),
  transitions: z.array(z.object({ from: z.string(), to: z.string(), when: conditionSchema }).strict()).min(1).max(32),
  stops: z.array(z.object({ ticker: tickerSchema, fixedPct: z.number().gt(0).lt(100).optional(), trailingPct: z.number().gt(0).lt(100).optional() }).strict().refine((stop) => stop.fixedPct !== undefined || stop.trailingPct !== undefined)).max(20).default([]),
  assumptions: z.array(z.string().trim().min(1).max(240)).max(12).default([]),
}).strict().superRefine((plan, ctx) => {
  const ids = new Set(["cash"]);
  for (const state of plan.states) {
    if (ids.has(state.id)) ctx.addIssue({ code: "custom", message: `Duplicate or reserved state ${state.id}.` });
    ids.add(state.id);
    if (new Set(state.allocations.map((item) => item.ticker)).size !== state.allocations.length) ctx.addIssue({ code: "custom", message: `Duplicate asset in ${state.id}.` });
    if (state.allocations.reduce((sum, item) => sum + item.percent, 0) > 100 + 1e-9) ctx.addIssue({ code: "custom", message: `Gross allocation exceeds 100% in ${state.id}.` });
  }
  for (const transition of plan.transitions) if (!ids.has(transition.from) || !ids.has(transition.to) || transition.from === transition.to) ctx.addIssue({ code: "custom", message: "Transition references an unknown state or itself." });
  if (new Set(plan.stops.map((stop) => stop.ticker)).size !== plan.stops.length) ctx.addIssue({ code: "custom", message: "Duplicate asset stop." });
});
export type StrategyPlan = z.infer<typeof strategyPlanSchema>;
export const reportConfigSchema = z.object({ visibleSeries: z.array(z.string().min(1).max(20)).max(42), sections: z.array(z.enum(["annual", "drawdown", "growth", "trades"])).min(1).max(4), closeTickers: z.array(tickerSchema).max(40), range: z.enum(["full", "last_month", "last_quarter", "last_year", "last_two_years", "custom"]), startDate: z.iso.date().optional(), endDate: z.iso.date().optional() }).strict().refine((value) => value.range !== "custom" || Boolean(value.startDate && value.endDate && value.startDate <= value.endDate), "Custom chart range requires valid start and end dates.");
export type ReportConfig = z.infer<typeof reportConfigSchema>;
export type PlannedCommentary = { model: BacktestModel; summary: string; riskNotes: string[]; suggestions: { title: string; reason: string; plan: StrategyPlan }[]; usage: ModelUsage };
export type PlannedInput = { plan: StrategyPlan; prompt: string; model: BacktestModel; parentRunId?: string; interpretationUsage?: ModelUsage; setupConversation?: ConversationTurn[] };
export type PlannedRun = Omit<SavedRun, "input" | "commentaries"> & { engineVersion: 2 | 3; input: PlannedInput; plan: StrategyPlan; reportConfig: ReportConfig; reportUsage: ModelUsage[]; commentaries: PlannedCommentary[] };
export type AnyRun = SavedRun | PlannedRun;
export function isPlannedRun(run: AnyRun): run is PlannedRun { return "engineVersion" in run && (run.engineVersion === 2 || run.engineVersion === 3) && "plan" in run; }
export function requiredTickers(plan: StrategyPlan): string[] {
  return [...new Set(["SPY", "QQQ", ...plan.states.flatMap((state) => state.allocations.map((allocation) => allocation.ticker)),
    ...plan.transitions.flatMap((transition) => transition.when.any.flatMap((group) => group.map((atom) => atom.ticker))), ...plan.stops.map((stop) => stop.ticker)])];
}
export function defaultReportConfig(result: RunResult): ReportConfig {
  return { visibleSeries: result.series.map((item) => item.ticker), sections: ["annual", "drawdown", "growth", "trades"], closeTickers: Object.keys(result.fileIds), range: "full" };
}
export function describeAtom(atom: ConditionAtom, timeframe: "daily" | "weekly" = "daily"): string {
  const verb = { above: "is above", below: "is below", at_or_above: "is at or above", at_or_below: "is at or below", crosses_above: "crosses above", crosses_below: "crosses below" }[atom.relation];
  const target = atom.kind === "price_sma" ? `${atom.period}-${timeframe === "weekly" ? "week" : "day"} SMA${atom.bandPct ? ` × (1 ${atom.bandPct < 0 ? "−" : "+"} ${Math.abs(atom.bandPct)}%)` : ""}` : atom.kind === "rsi" ? String(atom.threshold) : "MACD signal";
  return `${atom.ticker} ${atom.kind === "price_sma" ? "close" : atom.kind === "rsi" ? `RSI(${atom.period})` : "MACD line"} ${verb} ${target}`;
}
export function describeCondition(condition: Condition, timeframe: "daily" | "weekly" = "daily"): string { return condition.any.map((group) => group.map((atom) => describeAtom(atom, timeframe)).join(" AND ")).join(" OR "); }
export function describeAllocations(allocations: Allocation[]): string {
  return [...allocations.map((item) => `${item.percent}% ${item.side} ${item.ticker}`), `${Math.max(0, 100 - allocations.reduce((sum, item) => sum + item.percent, 0))}% cash`].join(" · ");
}
