import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { parseSwingWatchlistCsvSource, parseSwingWatchlistXlsxSource, SWING_WATCHLIST_MAX_BYTES, SwingWatchlistValidationError } from "@/swing/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a CSV or XLSX watchlist file." }, { status: 400, headers });
    if (file.size > SWING_WATCHLIST_MAX_BYTES) return Response.json({ error: "Watchlist files must be 5 MB or smaller." }, { status: 413, headers });
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (extension !== "csv" && extension !== "xlsx") return Response.json({ error: "Watchlist files must use .csv or .xlsx." }, { status: 415, headers });
    const candidates = extension === "xlsx"
      ? await parseSwingWatchlistXlsxSource(Buffer.from(await file.arrayBuffer()))
      : parseSwingWatchlistCsvSource(await file.text());
    return Response.json({ candidates, rowCount: candidates.length }, { headers });
  } catch (error) {
    if (error instanceof SwingWatchlistValidationError) return Response.json({ error: "Watchlist validation failed.", issues: error.issues }, { status: 400, headers });
    return Response.json({ error: error instanceof Error ? error.message : "Watchlist preview failed." }, { status: 400, headers });
  }
}
