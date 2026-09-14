import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getManualBatchProgress, getScheduledBatchProgress } from "@/scans/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("manual"), id: z.string().uuid() }),
  z.object({ mode: z.literal("scheduled"), id: z.string().regex(/^postclose:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/) }),
]);
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!isAuthorizedSession(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ mode: url.searchParams.get("mode"), id: url.searchParams.get("id") });
  if (!parsed.success) return Response.json({ error: "Invalid scan progress request." }, { status: 400, headers: PRIVATE_HEADERS });
  const items = parsed.data.mode === "manual"
    ? await getManualBatchProgress(parsed.data.id)
    : await getScheduledBatchProgress(parsed.data.id);
  return Response.json({ items }, { headers: PRIVATE_HEADERS });
}
