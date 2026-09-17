import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { cancelSwingRun } from "@/swing/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = z.object({ reason: z.enum(["user", "tab_closed"]).default("user") }).parse(await request.json().catch(() => ({})));
  const run = await cancelSwingRun((await context.params).id, body.reason);
  return run ? Response.json({ run }, { headers: { "Cache-Control": "private, no-store" } }) : Response.json({ error: "Swing run not found." }, { status: 404 });
}
