import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getDatabase } from "@/db/client";
import { appSettings } from "@/db/schema";
import { updateAutomaticScanEntries } from "@/settings/automatic-scans";
import { tickerSchema } from "@/settings/schema";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
const updateSchema = z.object({
  symbols: z.array(tickerSchema).min(1).max(5).refine(
    (symbols) => new Set(symbols).size === symbols.length,
    "Symbols must be unique.",
  ),
  enabled: z.boolean(),
});

export async function PATCH(request: Request) {
  if (!isAuthorizedSession(await auth())) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid automatic-scan update." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const database = await getDatabase();
  const result = await database.transaction(async (transaction) => {
    await transaction.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
    const [settings] = await transaction
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1));
    if (!settings) throw new Error("Settings are unavailable.");
    const watchlist = updateAutomaticScanEntries(
      settings.watchlist,
      parsed.data.symbols,
      parsed.data.enabled,
    );
    if (!watchlist) return null;
    const [updated] = await transaction
      .update(appSettings)
      .set({ watchlist, updatedAt: new Date() })
      .where(eq(appSettings.id, 1))
      .returning({ watchlist: appSettings.watchlist });
    return updated?.watchlist ?? watchlist;
  });

  if (!result) {
    return Response.json(
      { error: "One or more symbols are not in the watchlist." },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }
  return Response.json({
    watchlist: result,
    enabledCount: result.filter((entry) => entry.automaticScanEnabled).length,
  }, { headers: PRIVATE_HEADERS });
}
