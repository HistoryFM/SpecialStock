import { randomUUID } from "node:crypto";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { runBacktest } from "@/backtesting/engine";
import { getRun, listRunSummaries, loadLatestPriceFiles, loadPriceFilesById, saveRun } from "@/backtesting/storage";
import { runInputSchema, type ModelUsage, type SavedRun } from "@/backtesting/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const bodySchema = z.object({ input: runInputSchema, interpretationUsage: z.unknown().optional() }).strict();

export async function GET() {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  return Response.json({ runs: await listRunSummaries() }, { headers });
}

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const body = bodySchema.parse(await request.json());
    const input = body.input;
    const parent = input.parentRunId ? await getRun(input.parentRunId) : null;
    if (input.parentRunId && !parent) throw new Error("Original run was not found.");
    if (parent && (input.longTicker !== parent.input.longTicker || input.mode !== parent.input.mode || input.inverseTicker !== parent.input.inverseTicker ||
      JSON.stringify(input.comparisons) !== JSON.stringify(parent.input.comparisons) || input.startingCapital !== parent.input.startingCapital ||
      input.cashRate !== parent.input.cashRate || input.slippage !== parent.input.slippage || input.fee !== parent.input.fee)) throw new Error("A suggestion must use the original assets, capital, and costs.");
    const tickers = [...new Set([input.longTicker, input.mode === "inverse" ? input.inverseTicker : undefined, "SPY", "QQQ", ...input.comparisons].filter((value): value is string => Boolean(value)))];
    const files = parent ? await loadPriceFilesById(parent.result.fileIds) : await loadLatestPriceFiles(tickers);
    let result = runBacktest(input, files);
    let comparison: SavedRun["comparison"];
    if (parent) {
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
    const run: SavedRun = { id: randomUUID(), createdAt: new Date().toISOString(), input, result, comparison, commentaries: [],
      interpretationUsage: body.interpretationUsage as ModelUsage | undefined };
    await saveRun(run);
    return Response.json({ run }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Backtest failed." }, { status: 400, headers });
  }
}
