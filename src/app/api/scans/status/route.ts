import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { isDemoMode } from "@/config/env";
import { getDatabase } from "@/db/client";
import { appSettings, scanSlots, schedulerHeartbeats } from "@/db/schema";
import { createMarketDataProvider } from "@/market-data/factory";
import { canonicalScanSlot, marketDate, nextScanTime } from "@/market-data/time";
import { automaticScanSymbols } from "@/settings/automatic-scans";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";

export async function GET() {
  if (!isAuthorizedSession(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const provider = createMarketDataProvider();
  const session = await provider.getSession(now);
  const database = await getDatabase();
  await database.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  const slot = canonicalScanSlot(now, session);
  const enabledSymbols = settings ? automaticScanSymbols(settings.watchlist) : [];
  const configuredSymbols = settings?.watchlist.map((entry) => entry.symbol) ?? [];
  const [latestScan] = configuredSymbols.length
    ? await database
        .select({ updatedAt: scanSlots.updatedAt })
        .from(scanSlots)
        .where(inArray(scanSlots.symbol, configuredSymbols))
        .orderBy(desc(scanSlots.updatedAt))
        .limit(1)
    : [];
  const runningScans = configuredSymbols.length
    ? await database
        .select({ symbol: scanSlots.symbol, startedAt: scanSlots.startedAt })
        .from(scanSlots)
        .where(and(
          inArray(scanSlots.symbol, configuredSymbols),
          eq(scanSlots.status, "running"),
          gt(scanSlots.leaseExpiresAt, now),
        ))
    : [];
  return Response.json({
    now: now.toISOString(),
    marketDate: session.date,
    marketOpen: session.isRegularSession && now >= session.opensAt && now <= session.closesAt,
    due: Boolean(enabledSymbols.length && slot),
    slotKey: slot?.idempotencyPart ?? null,
    nextScanAt: nextScanTime(now, session)?.toISOString() ?? null,
    automaticSymbols: enabledSymbols,
    enabledCount: enabledSymbols.length,
    configuredCount: settings?.watchlist.length ?? 0,
    runningScans: runningScans.map((scan) => ({
      symbol: scan.symbol,
      startedAt: scan.startedAt?.toISOString() ?? null,
    })),
    scanRevision: latestScan?.updatedAt.toISOString() ?? null,
    provider: provider.id,
    demoMode: isDemoMode(),
  });
}

const heartbeatSchema = z.object({
  tabId: z.string().uuid(),
  isLeader: z.boolean(),
});

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid heartbeat" }, { status: 400 });
  const database = await getDatabase();
  await database.insert(schedulerHeartbeats).values({
    tabId: parsed.data.tabId,
    marketDate: marketDate(new Date()),
    isLeader: parsed.data.isLeader,
  });
  return Response.json({ ok: true });
}
