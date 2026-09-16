import * as Sentry from "@sentry/nextjs";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { saveSwingWatchlist } from "@/swing/repository";
import { parseSwingWatchlistCsv, parseSwingWatchlistXlsx, SWING_WATCHLIST_MAX_BYTES, SwingWatchlistValidationError } from "@/swing/watchlist";

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
      const entries = extension === "xlsx"
        ? await parseSwingWatchlistXlsx(Buffer.from(await file.arrayBuffer()))
        : parseSwingWatchlistCsv(await file.text());
      const version = await saveSwingWatchlist({ entries, filename: file.name, sourceType: extension });
      span.setAttributes({ "specialstock.swing.watchlist_version": version.versionNumber, "specialstock.swing.watchlist_count": entries.length });
      span.setStatus({ code: 1 });
      Sentry.logger.info("swing.watchlist.imported", { "specialstock.swing.watchlist_version": version.versionNumber, "specialstock.swing.watchlist_count": entries.length });
      return Response.json({ version }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      span.setStatus({ code: 2, message: "watchlist_import_failed" });
      if (error instanceof SwingWatchlistValidationError) return Response.json({ error: "Watchlist validation failed.", issues: error.issues }, { status: 400 });
      throw error;
    }
  });
}
