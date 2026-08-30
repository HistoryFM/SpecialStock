import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getDatabase } from "@/db/client";
import { analyses, appSettings, modelRuns, scanSlots } from "@/db/schema";
import {
  runScan,
  ScanNotAvailableError,
  AutomaticScansDisabledError,
  UnknownWatchlistSymbolError,
} from "@/scans/service";
import { tickerSchema } from "@/settings/schema";

export const maxDuration = 60;

const bodySchema = z.object({
  mode: z.enum(["scheduled", "manual"]).default("scheduled"),
  slotKey: z.string().max(80).optional(),
}).superRefine((value, context) => {
  if (value.mode === "manual" && value.slotKey) {
    context.addIssue({ code: "custom", message: "Manual scans cannot select a scheduled slot." });
  }
});
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(
  _request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  if (!isAuthorizedSession(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }
  const parsed = tickerSchema.safeParse((await context.params).symbol);
  if (!parsed.success) {
    return Response.json({ error: "Invalid scan request." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const database = await getDatabase();
  const [settings] = await database.select().from(appSettings).where(eq(appSettings.id, 1));
  if (!settings?.watchlist.some((entry) => entry.symbol === parsed.data)) {
    return Response.json({ error: "Symbol is not in the watchlist." }, { status: 404, headers: PRIVATE_HEADERS });
  }
  const [slot] = await database
    .select()
    .from(scanSlots)
    .where(eq(scanSlots.symbol, parsed.data))
    .orderBy(desc(scanSlots.scheduledFor))
    .limit(1);
  if (!slot) {
    return Response.json({
      symbol: parsed.data,
      status: "none",
      slotId: null,
      analysisId: null,
      startedAt: null,
      completedAt: null,
      error: null,
    }, { headers: PRIVATE_HEADERS });
  }
  const [result] = await database
    .select({ analysisId: analyses.id })
    .from(modelRuns)
    .innerJoin(analyses, eq(analyses.modelRunId, modelRuns.id))
    .where(and(
      eq(modelRuns.scanSlotId, slot.id),
      eq(modelRuns.status, "valid"),
      inArray(modelRuns.runRole, ["primary", "fallback"]),
    ))
    .orderBy(desc(modelRuns.completedAt))
    .limit(1);
  return Response.json({
    symbol: parsed.data,
    status: slot.status,
    slotId: slot.id,
    analysisId: result?.analysisId ?? null,
    startedAt: slot.startedAt?.toISOString() ?? null,
    completedAt: slot.completedAt?.toISOString() ?? null,
    error: slot.errorCode,
  }, { headers: PRIVATE_HEADERS });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  if (!isAuthorizedSession(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { symbol: rawSymbol } = await context.params;
    const symbol = tickerSchema.parse(rawSymbol);
    const rawBody = await request.json().catch(() => ({}));
    const { mode, slotKey } = bodySchema.parse(rawBody);
    return Response.json(await runScan({ symbol, mode, requestedSlotKey: slotKey }));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof UnknownWatchlistSymbolError) {
      return Response.json({ error: "Invalid scan request." }, { status: 400 });
    }
    if (error instanceof ScanNotAvailableError || error instanceof AutomaticScansDisabledError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    Sentry.captureException(error, {
      tags: {
        route: "api.scans.symbol",
      },
    });
    return Response.json(
      { error: error instanceof Error ? error.message : "The scan failed." },
      { status: 502 },
    );
  }
}
