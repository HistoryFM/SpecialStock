import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { runBacktest } from "@/backtesting/engine";
import { runPlannedBacktest } from "@/backtesting/plan-engine";
import { defaultReportConfig, isPlannedRun, requiredTickers, strategyPlanSchema, type PlannedRun } from "@/backtesting/plan";
import { getRun, listRunSummaries, loadLatestPriceFiles, loadPriceFilesById, resolveBacktestStrategyId, saveRun } from "@/backtesting/storage";
import { conversationTurnSchema, modelSchema, runInputSchema, type ModelUsage, type SavedRun } from "@/backtesting/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const bodySchema = z.object({ input: runInputSchema, strategyId: z.string().uuid().optional(), interpretationUsage: z.unknown().optional() }).strict();
const plannedBodySchema = z.object({ input: z.object({ plan: strategyPlanSchema, prompt: z.string().min(3).max(4000), model: modelSchema,
  parentRunId: z.string().uuid().optional(), interpretationUsage: z.unknown().optional(), setupConversation: z.array(conversationTurnSchema).max(40).optional() }).strict(),
  strategyId: z.string().uuid().optional() }).strict();

export async function GET() {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  return Response.json({ runs: await listRunSummaries() }, { headers });
}

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const raw = await request.json();
    if (raw?.input?.plan) {
      const { input, strategyId: requestedStrategyId } = plannedBodySchema.parse(raw);
      const parent = input.parentRunId ? await getRun(input.parentRunId) : null;
      if (input.parentRunId && (!parent || !isPlannedRun(parent))) throw new Error("Original version 2 run was not found.");
      const strategyId = parent?.strategyId ?? await resolveBacktestStrategyId(requestedStrategyId);
      if (parent && requestedStrategyId && requestedStrategyId !== strategyId) throw new Error("A suggested run must remain in its original strategy.");
      const inputSettings = { ...input.plan.settings, timeframe: input.plan.settings.timeframe ?? "daily" };
      const parentSettings = parent && isPlannedRun(parent) ? { ...parent.plan.settings, timeframe: parent.plan.settings.timeframe ?? "daily" } : null;
      if (parent && isPlannedRun(parent) && (JSON.stringify(inputSettings) !== JSON.stringify(parentSettings) ||
        requiredTickers(input.plan).some((ticker) => !parent.result.fileIds[ticker]))) throw new Error("A suggestion must use the original settings and uploaded assets.");
      const tickers = requiredTickers(input.plan);
      const files = parent ? await loadPriceFilesById(parent.result.fileIds) : await loadLatestPriceFiles(tickers, input.plan.settings.timeframe);
      let result = await Sentry.startSpan({ name: "Calculate confirmed backtest", op: "specialstock.backtesting.run", attributes: {
        "specialstock.telemetry.origin": "server", "specialstock.backtesting.engine_version": 3,
        "specialstock.backtesting.asset_count": tickers.length, "specialstock.backtesting.is_suggestion": Boolean(parent),
      } }, (span) => {
        const calculated = runPlannedBacktest(input.plan, files);
        span.setAttributes({ "specialstock.backtesting.daily_values": calculated.dates.length, "specialstock.backtesting.trade_legs": calculated.trades.length });
        return calculated;
      });
      let comparison: SavedRun["comparison"];
      if (parent && isPlannedRun(parent)) {
        const startDate = result.startDate > parent.result.startDate ? result.startDate : parent.result.startDate;
        const endDate = result.endDate < parent.result.endDate ? result.endDate : parent.result.endDate;
        if (startDate > endDate) throw new Error("Original and suggested strategies have no shared period.");
        const period = { startDate, endDate };
        result = runPlannedBacktest(input.plan, files, period);
        const baseline = runPlannedBacktest(parent.plan, files, period);
        comparison = { baselineRunId: parent.id, ...period,
          baseline: { annual: baseline.annual, drawdowns: baseline.drawdowns, finalBalance: baseline.series[0].values.at(-1)! },
          variant: { annual: result.annual, drawdowns: result.drawdowns, finalBalance: result.series[0].values.at(-1)! } };
      }
      const primary = input.plan.states.flatMap((state) => state.allocations.map((item) => item.ticker))[0] ?? "CASH";
      const normalizedPlan = { ...input.plan, version: 3 as const };
      const run: PlannedRun = { id: randomUUID(), createdAt: new Date().toISOString(), name: `${primary} ${input.plan.settings.timeframe} strategy`, strategyId, engineVersion: 3, plan: normalizedPlan,
        input: { ...input, plan: normalizedPlan, setupConversation: input.setupConversation as PlannedRun["setupConversation"], interpretationUsage: input.interpretationUsage as ModelUsage | undefined }, result, comparison,
        setupConversation: input.setupConversation as PlannedRun["setupConversation"], resultConversation: [],
        reportConfig: defaultReportConfig(result), reportUsage: [], commentaries: [] };
      await saveRun(run);
      Sentry.logger.info("backtesting.run.completed", { "specialstock.telemetry.origin": "server", "specialstock.backtesting.run_id": run.id,
        "specialstock.backtesting.engine_version": 3, "specialstock.backtesting.asset_count": tickers.length,
        "specialstock.backtesting.daily_values": result.dates.length, "specialstock.backtesting.trade_legs": result.trades.length,
        "specialstock.backtesting.is_suggestion": Boolean(parent) });
      return Response.json({ run }, { headers });
    }
    const body = bodySchema.parse(raw);
    const input = body.input;
    const parent = input.parentRunId ? await getRun(input.parentRunId) : null;
    if (input.parentRunId && !parent) throw new Error("Original run was not found.");
    const strategyId = parent?.strategyId ?? await resolveBacktestStrategyId(body.strategyId);
    if (parent && body.strategyId && body.strategyId !== strategyId) throw new Error("A suggested run must remain in its original strategy.");
    if (parent && (isPlannedRun(parent) || input.longTicker !== parent.input.longTicker || input.mode !== parent.input.mode || input.inverseTicker !== parent.input.inverseTicker ||
      JSON.stringify(input.comparisons) !== JSON.stringify(parent.input.comparisons) || input.startingCapital !== parent.input.startingCapital ||
      input.cashRate !== parent.input.cashRate || input.slippage !== parent.input.slippage || input.fee !== parent.input.fee)) throw new Error("A suggestion must use the original assets, capital, and costs.");
    const tickers = [...new Set([input.longTicker, input.mode === "inverse" ? input.inverseTicker : undefined, "SPY", "QQQ", ...input.comparisons].filter((value): value is string => Boolean(value)))];
    const files = parent ? await loadPriceFilesById(parent.result.fileIds) : await loadLatestPriceFiles(tickers, input.timeframe);
    let result = runBacktest(input, files);
    let comparison: SavedRun["comparison"];
    if (parent && !isPlannedRun(parent)) {
      const commonStart = result.startDate > parent.result.startDate ? result.startDate : parent.result.startDate;
      const commonEnd = result.endDate < parent.result.endDate ? result.endDate : parent.result.endDate;
      if (commonStart > commonEnd) throw new Error("Original and suggested strategies have no shared period.");
      const period = { startDate: commonStart, endDate: commonEnd };
      result = runBacktest(input, files, period);
      const baseline = runBacktest(parent.input, files, period);
      comparison = { baselineRunId: parent.id, ...period,
        baseline: { annual: baseline.annual, drawdowns: baseline.drawdowns, finalBalance: baseline.series[0].values.at(-1)! },
        variant: { annual: result.annual, drawdowns: result.drawdowns, finalBalance: result.series[0].values.at(-1)! } };
    }
    const run: SavedRun = { id: randomUUID(), createdAt: new Date().toISOString(), strategyId, input, result, comparison, commentaries: [],
      interpretationUsage: body.interpretationUsage as ModelUsage | undefined };
    await saveRun(run);
    Sentry.logger.info("backtesting.run.completed", { "specialstock.telemetry.origin": "server", "specialstock.backtesting.run_id": run.id,
      "specialstock.backtesting.engine_version": 1, "specialstock.backtesting.asset_count": tickers.length,
      "specialstock.backtesting.daily_values": result.dates.length, "specialstock.backtesting.trade_legs": result.trades.length,
      "specialstock.backtesting.is_suggestion": Boolean(parent) });
    return Response.json({ run }, { headers });
  } catch (error) {
    Sentry.logger.warn("backtesting.run.failed", { "specialstock.telemetry.origin": "server", "error.type": error instanceof Error ? error.constructor.name : "UnknownError" });
    return Response.json({ error: error instanceof Error ? error.message : "Backtest failed." }, { status: 400, headers });
  }
}
