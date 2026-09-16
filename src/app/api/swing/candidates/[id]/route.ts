import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getSwingCandidate } from "@/swing/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const candidate = await getSwingCandidate((await context.params).id);
  if (!candidate) return Response.json({ error: "Swing candidate not found." }, { status: 404 });
  return Response.json({ candidate }, { headers: { "Cache-Control": "private, no-store" } });
}
