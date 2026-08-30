import "server-only";

import { desc, eq } from "drizzle-orm";

import { requireAuthorizedUser } from "@/auth/require-user";
import { getDatabase } from "@/db/client";
import { analyses, notificationEvents, theses } from "@/db/schema";

export async function getAlertEvents() {
  await requireAuthorizedUser();
  const database = await getDatabase();
  return database
    .select({ event: notificationEvents, thesis: theses, analysis: analyses })
    .from(notificationEvents)
    .innerJoin(theses, eq(theses.id, notificationEvents.thesisId))
    .innerJoin(analyses, eq(analyses.id, theses.analysisId))
    .orderBy(desc(notificationEvents.createdAt))
    .limit(100);
}
