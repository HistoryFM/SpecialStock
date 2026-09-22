import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getGexState } from "@/gex/repository";

export const runtime = "nodejs";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  return Response.json({ state: await getGexState() }, { headers });
}
