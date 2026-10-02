import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { GEX_CATEGORIES, GexLiveError, runLiveGex, validRequestedExpiration } from "@/gex/live";
import { getActiveGexTemplate, getGexState, getGexUsageSummary, getRecentGexDatasetSummaries, saveGexDataset, saveGexModelUsage } from "@/gex/repository";
import { buildGexScriptExport } from "@/gex/script-export";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };
const requestSchema = z.object({ category: z.enum(GEX_CATEGORIES), selectedDate: z.string().optional() }).strict().refine(
  (value) => value.category === "manual" ? !!value.selectedDate && validRequestedExpiration(value.selectedDate) : value.selectedDate === undefined,
  { message: "Select a valid current or future date for manual GEX." },
);

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try {
    const input = requestSchema.parse(await request.json());
    const state = await getGexState();
    if (!state.symbols.length) return Response.json({ error: "Save at least one GEX symbol before calculating." }, { status: 422, headers: HEADERS });
    const result = await runLiveGex(state.symbols, input.category, fetch, input.selectedDate);
    if (!result.rows.length) return Response.json({ error: "No usable options chain was returned for the selected expiration or any later available date.", failures: result.failures }, { status: 422, headers: HEADERS });
    const { modelUsage, ...safeResult } = result;
    const saved = await saveGexDataset(input.category, result.rows);
    await saveGexModelUsage(modelUsage);
    return Response.json({
      ...safeResult,
      datasetId: saved.id,
      runAt: saved.runAt.toISOString(),
      datasets: await getRecentGexDatasetSummaries(),
      usage: await getGexUsageSummary(),
      engine: buildGexScriptExport("engine", result.rows, await getActiveGexTemplate("engine")),
      scanner: buildGexScriptExport("scanner", result.rows, await getActiveGexTemplate("scanner")),
    }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof GexLiveError) return Response.json({ error: error.message }, { status: error.kind === "not_configured" ? 503 : 502, headers: HEADERS });
    if (error instanceof z.ZodError) return Response.json({ error: "Choose daily, weekly, or manual GEX with a valid expiration date." }, { status: 400, headers: HEADERS });
    return Response.json({ error: "Live GEX could not complete. No new result was saved; review the server terminal for the local error category." }, { status: 500, headers: HEADERS });
  }
}
