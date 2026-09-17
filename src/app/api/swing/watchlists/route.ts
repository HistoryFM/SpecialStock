import * as Sentry from "@sentry/nextjs";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { saveSwingWatchlist, SwingConflictError } from "@/swing/repository";
import { SWING_MARKETS, SWING_WATCHLIST_MAX_ENTRIES, type SwingMarket } from "@/swing/types";
import { parseSwingWatchlistCsvSource, parseSwingWatchlistXlsxSource, selectSwingWatchlistEntries, SWING_WATCHLIST_MAX_BYTES, SwingWatchlistValidationError } from "@/swing/watchlist";

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Sentry.startSpan({ name: "Import Swing watchlist", op: "specialstock.swing.watchlist.import" }, async (span) => {
    try {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "Choose a CSV or XLSX watchlist file." }, { status: 400 });
      span.setAttributes({ "specialstock.swing.upload_bytes": file.size, "specialstock.swing.upload_extension": file.name.split(".").at(-1)?.toLowerCase() ?? "unknown" });
      if (file.size > SWING_WATCHLIST_MAX_BYTES) return Response.json({ error: "Watchlist files must be 5 MB or smaller." }, { status: 413 });
      const extension = file.name.split(".").at(-1)?.toLowerCase();
      if (extension !== "csv" && extension !== "xlsx") return Response.json({ error: "Watchlist files must use .csv or .xlsx." }, { status: 415 });
      const requestedMarket = form.get("market");
      const market: SwingMarket = SWING_MARKETS.includes(requestedMarket as SwingMarket) ? requestedMarket as SwingMarket : "US";
      const listName = typeof form.get("listName") === "string" ? String(form.get("listName")) : file.name.replace(/\.(csv|xlsx)$/i, "");
      const sublistName = typeof form.get("sublistName") === "string" ? String(form.get("sublistName")) : undefined;
      const candidates = extension === "xlsx"
        ? await parseSwingWatchlistXlsxSource(Buffer.from(await file.arrayBuffer()), market)
        : parseSwingWatchlistCsvSource(await file.text(), market);
      const rawSelection = form.get("selectedSymbols");
      let selectedSymbols: string[] | undefined;
      if (typeof rawSelection === "string") {
        const parsed = JSON.parse(rawSelection) as unknown;
        if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
          throw new SwingWatchlistValidationError(["The selected stocks are invalid."]);
        }
        selectedSymbols = parsed;
      }
      const entries = selectSwingWatchlistEntries(candidates, selectedSymbols);
      const allEntries = candidates.length <= SWING_WATCHLIST_MAX_ENTRIES ? selectSwingWatchlistEntries(candidates) : entries;
      if (entries.length !== allEntries.length && !sublistName?.trim()) throw new SwingWatchlistValidationError(["Enter a name for the selected sublist."]);
      const saved = await saveSwingWatchlist({ entries, allEntries, filename: file.name, sourceType: extension, market, listName, sublistName });
      span.setAttributes({ "specialstock.swing.watchlist_version": saved.version.versionNumber, "specialstock.swing.watchlist_count": entries.length });
      span.setStatus({ code: 1 });
      Sentry.logger.info("swing.watchlist.imported", { "specialstock.swing.watchlist_version": saved.version.versionNumber, "specialstock.swing.watchlist_count": entries.length, "specialstock.swing.market": market });
      return Response.json({ saved }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      span.setStatus({ code: 2, message: "watchlist_import_failed" });
      if (error instanceof SwingWatchlistValidationError) return Response.json({ error: "Watchlist validation failed.", issues: error.issues }, { status: 400 });
      if (error instanceof SwingConflictError) return Response.json({ error: error.message }, { status: 409 });
      throw error;
    }
  });
}
