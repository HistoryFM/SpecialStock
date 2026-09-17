import { z } from "zod";
import { after } from "next/server";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { createSwingRun, executeSwingRun, listSwingRuns, SwingRunConflictError, SwingRunUnavailableError } from "@/swing/service";

export async function GET() {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ runs: await listSwingRuns() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = z.object({ mode: z.enum(["manual", "automatic"]), requestId: z.string().uuid().optional(), market: z.enum(["US", "INDIA"]).default("US"), watchlistVersionId: z.string().uuid().optional() }).strict().parse(await request.json());
    const created = await createSwingRun(body);
    if (created.run.status === "scheduled") after(() => executeSwingRun(created.run.id));
    return Response.json({ runId: created.run.id, created: created.created }, { status: created.created ? 202 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SwingRunConflictError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof SwingRunUnavailableError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid Swing run request." }, { status: 400 });
    throw error;
  }
}
