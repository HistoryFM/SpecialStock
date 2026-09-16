import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getSwingRun } from "@/swing/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const run = await getSwingRun((await context.params).id);
  if (!run) return Response.json({ error: "Swing run not found." }, { status: 404 });
  return Response.json({ run }, { headers: { "Cache-Control": "private, no-store" } });
}
