import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { GEX_CATEGORIES } from "@/gex/live";
import { getGexDatasetById, getLatestGexDataset, getRecentGexDatasetSummaries } from "@/gex/repository";

export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const querySchema = z.object({ category: z.enum(GEX_CATEGORIES) }).strict();

export async function GET(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  if (!keys.length) return Response.json({ datasets: await getRecentGexDatasetSummaries() }, { headers: HEADERS });
  if (keys.length === 1 && keys[0] === "id") {
    const id = url.searchParams.get("id") ?? "";
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid saved result ID." }, { status: 400, headers: HEADERS });
    const dataset = await getGexDatasetById(id);
    if (!dataset) return Response.json({ error: "Saved GEX result not found." }, { status: 404, headers: HEADERS });
    return Response.json({ id: dataset.id, category: dataset.category, rows: dataset.rows, runAt: dataset.runAt.toISOString() }, { headers: HEADERS });
  }
  const parsed = querySchema.safeParse({ category: url.searchParams.get("category") });
  if (!parsed.success || keys.length !== 1 || keys[0] !== "category") {
    return Response.json({ error: "Choose daily, weekly, monthly, or manual GEX." }, { status: 400, headers: HEADERS });
  }
  const dataset = await getLatestGexDataset(parsed.data.category);
  if (!dataset) return Response.json({ error: "No saved live GEX result exists for this expiry category." }, { status: 404, headers: HEADERS });
  return Response.json({ id: dataset.id, rows: dataset.rows, runAt: dataset.runAt.toISOString() }, { headers: HEADERS });
}
