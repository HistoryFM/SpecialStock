import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { GEX_CATEGORIES, GexLiveError, runLiveGex } from "@/gex/live";
import { getActiveGexTemplate, getGexState, getGexUsageSummary, saveGexDataset, saveGexModelUsage } from "@/gex/repository";
import { buildGexScriptExport } from "@/gex/script-export";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };
const requestSchema = z.object({ category: z.enum(GEX_CATEGORIES) }).strict();

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try {
    const input = requestSchema.parse(await request.json());
    const state = await getGexState();
    if (!state.symbols.length) return Response.json({ error: "Save at least one GEX symbol before calculating." }, { status: 422, headers: HEADERS });
    const result = await runLiveGex(state.symbols, input.category);
    const { modelUsage, ...safeResult } = result;
    const runAt = await saveGexDataset(input.category, result.rows);
    await saveGexModelUsage(modelUsage);
    return Response.json({
      ...safeResult,
      runAt: runAt.toISOString(),
      usage: await getGexUsageSummary(),
      engine: buildGexScriptExport("engine", result.rows, await getActiveGexTemplate("engine")),
      scanner: buildGexScriptExport("scanner", result.rows, await getActiveGexTemplate("scanner")),
    }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof GexLiveError) return Response.json({ error: error.message }, { status: error.kind === "not_configured" ? 503 : 502, headers: HEADERS });
    if (error instanceof z.ZodError) return Response.json({ error: "Choose daily, weekly, or monthly GEX." }, { status: 400, headers: HEADERS });
    return Response.json({ error: "Live GEX could not complete. No new result was saved; review the server terminal for the local error category." }, { status: 500, headers: HEADERS });
  }
}
