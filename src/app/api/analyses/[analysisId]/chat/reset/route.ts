import { ChatBusyError, resetAnalysisChat } from "@/analysis/chat-service";
import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";

const HEADERS = { "Cache-Control": "private, no-store" };
export async function POST(_request: Request, context: { params: Promise<{ analysisId: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try { return Response.json(await resetAnalysisChat((await context.params).analysisId), { headers: HEADERS }); }
  catch (error) {
    if (error instanceof ChatBusyError) return Response.json({ error: error.message }, { status: 409, headers: HEADERS });
    return Response.json({ error: error instanceof Error ? error.message : "Chat reset failed." }, { status: 502, headers: HEADERS });
  }
}
