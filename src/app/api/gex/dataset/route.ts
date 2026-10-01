import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { GEX_CATEGORIES } from "@/gex/live";
import { getLatestGexDataset } from "@/gex/repository";

export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const querySchema = z.object({ category: z.enum(GEX_CATEGORIES) }).strict();

export async function GET(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ category: url.searchParams.get("category") });
  if (!parsed.success || [...url.searchParams.keys()].some((key) => key !== "category")) {
    return Response.json({ error: "Choose daily, weekly, or monthly GEX." }, { status: 400, headers: HEADERS });
  }
  const dataset = await getLatestGexDataset(parsed.data.category);
  if (!dataset) return Response.json({ error: "No saved live GEX result exists for this expiry category." }, { status: 404, headers: HEADERS });
  return Response.json({ rows: dataset.rows, runAt: dataset.runAt.toISOString() }, { headers: HEADERS });
}
