import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getRun } from "@/backtesting/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const run = await getRun((await context.params).id);
  return run ? Response.json({ run }, { headers }) : Response.json({ error: "Run not found." }, { status: 404, headers });
}
