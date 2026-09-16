import { randomUUID } from "node:crypto";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { chatAboutPlannedRun } from "@/backtesting/ai";
import { isPlannedRun } from "@/backtesting/plan";
import { getRun, saveRun } from "@/backtesting/storage";
import { modelSchema } from "@/backtesting/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ model: modelSchema, requestId: z.string().uuid(), message: z.string().trim().min(1).max(2000) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const run = await getRun((await context.params).id);
  if (!run || !isPlannedRun(run)) return Response.json({ error: "Saved planned run not found." }, { status: 404, headers });
  try {
    const input = schema.parse(await request.json());
    const existing = (run.resultConversation ?? []).find((turn) => turn.id === input.requestId);
    if (existing) return Response.json({ run }, { headers });
    const user = { id: input.requestId, role: "user" as const, content: input.message, at: new Date().toISOString() };
    const turns = [...(run.resultConversation ?? []), user];
    const answer = await chatAboutPlannedRun({ model: input.model, prompt: run.input.prompt, plan: run.plan, result: run.result, turns });
    run.resultConversation = [...turns, { id: randomUUID(), role: "assistant", content: answer.value.answer, at: new Date().toISOString(), usage: answer.usage }];
    await saveRun(run);
    return Response.json({ run }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The selected model could not answer." }, { status: error instanceof z.ZodError ? 400 : 502, headers });
  }
}
