import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { customizeReport } from "@/backtesting/ai";
import { isPlannedRun, reportConfigSchema, type ReportConfig } from "@/backtesting/plan";
import { getRun, saveRun } from "@/backtesting/storage";
import { modelSchema } from "@/backtesting/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function allowed(config: ReportConfig, series: string[], tickers: string[]) {
  if (config.visibleSeries.some((ticker) => !series.includes(ticker)) || config.closeTickers.some((ticker) => !tickers.includes(ticker)))
    throw new Error("Report controls reference an unavailable asset.");
  if (new Set(config.visibleSeries).size !== config.visibleSeries.length || new Set(config.sections).size !== config.sections.length || new Set(config.closeTickers).size !== config.closeTickers.length)
    throw new Error("Report controls contain duplicates.");
  if (config.sections.includes("growth") && !config.visibleSeries.length) throw new Error("Select at least one growth series.");
}
async function change(request: Request, context: { params: Promise<{ id: string }> }, ai: boolean) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const run = await getRun((await context.params).id);
  if (!run || !isPlannedRun(run)) return Response.json({ error: "Version 2 run not found." }, { status: 404, headers });
  try {
    const body = await request.json();
    const series = run.result.series.map((item) => item.ticker), tickers = Object.keys(run.result.fileIds);
    const generated = ai ? await customizeReport({ ...z.object({ model: modelSchema, prompt: z.string().trim().min(3).max(1000) }).strict().parse(body), current: run.reportConfig, series, tickers }) : null;
    const config = generated ? generated.value : reportConfigSchema.parse(body);
    allowed(config, series, tickers);
    run.reportConfig = config;
    if (generated) (run.reportUsage ??= []).push(generated.usage);
    await saveRun(run);
    return Response.json({ run }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not customize report." }, { status: error instanceof z.ZodError ? 400 : 422, headers });
  }
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return change(request, context, false); }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return change(request, context, true); }
