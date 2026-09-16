import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { createBacktestStrategy, listBacktestStrategies } from "@/backtesting/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  return Response.json(await listBacktestStrategies(), { headers });
}

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(await request.json());
    return Response.json({ strategy: await createBacktestStrategy(name) }, { status: 201, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create strategy." }, { status: 400, headers });
  }
}
