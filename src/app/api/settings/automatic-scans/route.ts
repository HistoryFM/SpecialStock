import * as Sentry from "@sentry/nextjs";
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
  symbols: z.array(tickerSchema).min(1).max(20).refine(
    (symbols) => new Set(symbols).size === symbols.length,
    "Symbols must be unique.",
  ),
  enabled: z.boolean(),
});

export async function PATCH(request: Request) {
  if (!isAuthorizedSession(await auth())) {
    Sentry.logger.warn("settings.auto.rejected", {
      "specialstock.settings.operation": "automatic_scan_update",
      "specialstock.settings.rejection": "unauthorized",
    });
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    Sentry.logger.warn("settings.auto.rejected", {
      "specialstock.settings.operation": "automatic_scan_update",
      "specialstock.settings.rejection": "invalid_request",
    });
    return Response.json(
      { error: "Invalid automatic-scan update." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  return Sentry.startSpan(
    {
      name: "Update automatic scan settings",
      op: "specialstock.settings.auto_toggle",
      attributes: {
        "specialstock.settings.requested_symbols": parsed.data.symbols.join(","),
        "specialstock.settings.requested_count": parsed.data.symbols.length,
        "specialstock.settings.requested_enabled": parsed.data.enabled,
      },
    },
    async (span) => {
      const started = performance.now();
      try {
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
          const updatedAt = new Date();
          const [updated] = await transaction
            .update(appSettings)
            .set({ watchlist, updatedAt })
            .where(eq(appSettings.id, 1))
            .returning({ watchlist: appSettings.watchlist, updatedAt: appSettings.updatedAt });
          const updatedWatchlist = updated?.watchlist ?? watchlist;
          return {
            watchlist: updatedWatchlist,
            previousEnabledCount: settings.watchlist.filter((entry) => entry.automaticScanEnabled).length,
            enabledCount: updatedWatchlist.filter((entry) => entry.automaticScanEnabled).length,
            changedCount: settings.watchlist.filter((entry, index) =>
              entry.automaticScanEnabled !== updatedWatchlist[index]?.automaticScanEnabled
            ).length,
            previousVersion: settings.updatedAt.toISOString(),
            updatedVersion: (updated?.updatedAt ?? updatedAt).toISOString(),
          };
        });

        if (!result) {
          span.setAttributes({
            "specialstock.settings.outcome": "rejected",
            "specialstock.settings.rejection": "unknown_symbol",
          });
          span.setStatus({ code: 2, message: "unknown_symbol" });
          Sentry.logger.warn("settings.auto.rejected", {
            "specialstock.settings.operation": "automatic_scan_update",
            "specialstock.settings.rejection": "unknown_symbol",
            "specialstock.settings.requested_symbols": parsed.data.symbols.join(","),
          });
          return Response.json(
            { error: "One or more symbols are not in the watchlist." },
            { status: 404, headers: PRIVATE_HEADERS },
          );
        }

        const durationMs = Math.round(performance.now() - started);
        span.setAttributes({
          "specialstock.settings.outcome": "updated",
          "specialstock.settings.previous_enabled_count": result.previousEnabledCount,
          "specialstock.settings.enabled_count": result.enabledCount,
          "specialstock.settings.changed_count": result.changedCount,
          "specialstock.settings.previous_version": result.previousVersion,
          "specialstock.settings.updated_version": result.updatedVersion,
          "specialstock.settings.duration_ms": durationMs,
        });
        span.setStatus({ code: 1 });
        Sentry.logger.info("settings.auto.updated", {
          "specialstock.settings.operation": "automatic_scan_update",
          "specialstock.settings.requested_symbols": parsed.data.symbols.join(","),
          "specialstock.settings.requested_enabled": parsed.data.enabled,
          "specialstock.settings.previous_enabled_count": result.previousEnabledCount,
          "specialstock.settings.enabled_count": result.enabledCount,
          "specialstock.settings.changed_count": result.changedCount,
          "specialstock.settings.previous_version": result.previousVersion,
          "specialstock.settings.updated_version": result.updatedVersion,
          "specialstock.settings.duration_ms": durationMs,
        });
        return Response.json({
          watchlist: result.watchlist,
          enabledCount: result.enabledCount,
          updatedAt: result.updatedVersion,
        }, { headers: PRIVATE_HEADERS });
      } catch (error) {
        const durationMs = Math.round(performance.now() - started);
        const errorType = error instanceof Error ? error.constructor.name : "UnknownError";
        const message = error instanceof Error ? error.message : "Automatic-scan settings could not be updated.";
        span.setAttributes({
          "specialstock.settings.outcome": "failed",
          "specialstock.settings.duration_ms": durationMs,
          "error.type": errorType,
        });
        span.setStatus({ code: 2, message: message.slice(0, 200) });
        Sentry.logger.error("settings.auto.failed", {
          "specialstock.settings.operation": "automatic_scan_update",
          "specialstock.settings.requested_symbols": parsed.data.symbols.join(","),
          "specialstock.settings.requested_enabled": parsed.data.enabled,
          "specialstock.settings.duration_ms": durationMs,
          "error.type": errorType,
          "error.message": message.slice(0, 500),
        });
        Sentry.captureException(error, {
          tags: { route: "api.settings.automatic_scans" },
          extra: {
            symbols: parsed.data.symbols,
            enabled: parsed.data.enabled,
          },
        });
        return Response.json(
          { error: "Automatic-scan settings could not be updated." },
          { status: 500, headers: PRIVATE_HEADERS },
        );
      }
    },
  );
}
