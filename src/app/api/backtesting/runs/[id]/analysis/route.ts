import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { analyzePlannedRun, analyzeRun } from "@/backtesting/ai";
import { isPlannedRun } from "@/backtesting/plan";
import { getRun, saveRun } from "@/backtesting/storage";
import { modelSchema } from "@/backtesting/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const run = await getRun((await context.params).id);
  if (!run) return Response.json({ error: "Run not found." }, { status: 404, headers });
  try {
    const model = modelSchema.parse((await request.json() as { model?: unknown }).model);
    if (isPlannedRun(run)) run.commentaries.push(await analyzePlannedRun({ model, prompt: run.input.prompt, plan: run.plan, result: run.result }));
    else run.commentaries.push(await analyzeRun({ model, prompt: run.input.prompt, strategy: run.input.strategy, result: run.result }));
    await saveRun(run);
    return Response.json({ run }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: error instanceof z.ZodError ? 400 : 502, headers });
  }
}
