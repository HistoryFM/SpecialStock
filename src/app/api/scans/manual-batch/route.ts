import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { tickerSchema } from "@/settings/schema";
import { InvalidManualBatchError, runManualBatch } from "@/scans/manual-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const bodySchema = z.object({
  runs: z.array(z.object({
    symbol: tickerSchema,
    timeframe: z.enum(["1m", "5m", "10m"]),
  }).strict()).min(1).max(20).refine(
    (runs) => new Set(runs.map(({ symbol }) => symbol)).size === runs.length,
    "Symbols must be unique.",
  ),
  requestId: z.string().uuid(),
}).strict();
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  try {
    const body = bodySchema.parse(await request.json());
    return Response.json(await runManualBatch(body), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof InvalidManualBatchError) {
      return Response.json({ error: "Invalid manual batch request." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    throw error;
  }
}
