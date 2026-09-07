import { z } from "zod";

import { ChatBusyError, ChatTurnNotFoundError, ChatUnavailableError, getAnalysisChat, submitAnalysisChat } from "@/analysis/chat-service";
import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";

export const maxDuration = 120;
const HEADERS = { "Cache-Control": "private, no-store" };
const bodySchema = z.object({ requestId: z.string().uuid(), question: z.string() }).strict();

export async function GET(_request: Request, context: { params: Promise<{ analysisId: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try { return Response.json(await getAnalysisChat((await context.params).analysisId), { headers: HEADERS }); }
  catch (error) {
    if (error instanceof ChatTurnNotFoundError) return Response.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof ChatUnavailableError) return Response.json({ error: error.message }, { status: 409, headers: HEADERS });
    throw error;
  }
}

export async function POST(request: Request, context: { params: Promise<{ analysisId: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try {
    const body = bodySchema.parse(await request.json());
    return Response.json(await submitAnalysisChat({ analysisId: (await context.params).analysisId, ...body }), { headers: HEADERS });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Invalid chat question." }, { status: 400, headers: HEADERS });
    if (error instanceof ChatBusyError || error instanceof ChatUnavailableError) return Response.json({ error: error.message }, { status: 409, headers: HEADERS });
    if (error instanceof ChatTurnNotFoundError) return Response.json({ error: error.message }, { status: 404, headers: HEADERS });
    return Response.json({ error: error instanceof Error ? error.message : "Chat failed." }, { status: 502, headers: HEADERS });
  }
}
