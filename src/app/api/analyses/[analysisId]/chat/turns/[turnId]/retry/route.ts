import { ChatBusyError, ChatTurnNotFoundError, retryAnalysisChat } from "@/analysis/chat-service";
import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";

export const maxDuration = 120;
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(_request: Request, context: { params: Promise<{ analysisId: string; turnId: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  const params = await context.params;
  try { return Response.json(await retryAnalysisChat(params), { headers: HEADERS }); }
  catch (error) {
    if (error instanceof ChatTurnNotFoundError) return Response.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof ChatBusyError) return Response.json({ error: error.message }, { status: 409, headers: HEADERS });
    return Response.json({ error: error instanceof Error ? error.message : "Chat retry failed." }, { status: 502, headers: HEADERS });
  }
}
