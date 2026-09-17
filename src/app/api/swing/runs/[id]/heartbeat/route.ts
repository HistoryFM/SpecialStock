import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { heartbeatSwingRun } from "@/swing/service";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const run = await heartbeatSwingRun((await context.params).id);
  return run ? Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } }) : Response.json({ error: "Active Swing run not found." }, { status: 404 });
}
