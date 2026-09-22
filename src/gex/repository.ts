import "server-only";

import { and, eq } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import { gexSettings } from "@/db/schema";
import { GEX_DEMO_SYMBOLS, gexDemoSelection } from "@/gex/demo";

export class GexListConflictError extends Error {}

export async function getGexState() {
  const database = await getDatabase();
  await database.insert(gexSettings).values({ id: 1 }).onConflictDoNothing();
  const [settings] = await database.select().from(gexSettings).where(eq(gexSettings.id, 1)).limit(1);
  if (!settings) throw new Error("GEX settings could not be loaded.");
  return {
    symbols: settings.symbols,
    revision: settings.revision,
    sourceFilename: settings.sourceFilename,
    updatedAt: settings.updatedAt.toISOString(),
    sampleSymbols: GEX_DEMO_SYMBOLS,
    ...gexDemoSelection(settings.symbols),
  };
}

export async function saveGexSymbols(input: { symbols: string[]; sourceFilename: string; expectedRevision: number }) {
  const database = await getDatabase();
  await database.insert(gexSettings).values({ id: 1 }).onConflictDoNothing();
  const [updated] = await database.update(gexSettings).set({
    symbols: input.symbols,
    sourceFilename: input.sourceFilename.slice(0, 255),
    revision: input.expectedRevision + 1,
    updatedAt: new Date(),
  }).where(and(eq(gexSettings.id, 1), eq(gexSettings.revision, input.expectedRevision))).returning();
  if (!updated) throw new GexListConflictError("The GEX list changed in another tab. Refresh and try again.");
  return getGexState();
}
