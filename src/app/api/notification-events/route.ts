import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getDatabase } from "@/db/client";
import { analyses, notificationEvents, theses } from "@/db/schema";

export async function GET() {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const database = await getDatabase();
  const events = await database
    .select({
      id: notificationEvents.id,
      reason: notificationEvents.reason,
      symbol: theses.symbol,
      analysisId: analyses.id,
      verdict: analyses.verdict,
      summary: analyses.summary,
    })
    .from(notificationEvents)
    .innerJoin(theses, eq(theses.id, notificationEvents.thesisId))
    .innerJoin(analyses, eq(analyses.id, theses.analysisId))
    .where(and(eq(notificationEvents.deliveryState, "pending")));
  return Response.json({
    events: events.map((event) => ({
      ...event,
      url: `/symbols/${encodeURIComponent(event.symbol)}?analysis=${encodeURIComponent(event.analysisId)}`,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

const deliverySchema = z.object({ id: z.string().uuid(), state: z.enum(["delivered", "failed"]) });

export async function PATCH(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = deliverySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid delivery update" }, { status: 400 });
  const database = await getDatabase();
  await database.update(notificationEvents).set({
    deliveryState: parsed.data.state,
    deliveredAt: parsed.data.state === "delivered" ? new Date() : null,
  }).where(eq(notificationEvents.id, parsed.data.id));
  return Response.json({ ok: true });
}
