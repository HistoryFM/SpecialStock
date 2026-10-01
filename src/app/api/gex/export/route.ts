import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { buildGexDemoWorkbook, buildGexLiveWorkbook } from "@/gex/export";
import { getActiveGexTemplateWithVersion, getGexState, getLatestGexDataset } from "@/gex/repository";
import { buildGexScriptExport } from "@/gex/script-export";
import { GEX_CATEGORIES } from "@/gex/live";
import { buildGexChartScript, buildGexWatchlistScript } from "@/gex/thinkscript";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const querySchema = z.object({ format: z.enum(["xlsx", "chart", "watchlist"]), revision: z.coerce.number().int().nonnegative().optional(), category: z.enum(GEX_CATEGORIES).optional(), templateVersion: z.coerce.number().int().nonnegative().optional() }).strict();

export async function GET(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ format: url.searchParams.get("format"), revision: url.searchParams.get("revision") ?? undefined, category: url.searchParams.get("category") ?? undefined, templateVersion: url.searchParams.get("templateVersion") ?? undefined });
  if (!parsed.success) return Response.json({ error: "Choose a valid export format and list revision." }, { status: 400, headers: HEADERS });
  if (parsed.data.format === "xlsx" && parsed.data.category) {
    const dataset = await getLatestGexDataset(parsed.data.category);
    if (!dataset) return Response.json({ error: "Run live GEX for this expiry category before downloading its workbook." }, { status: 422, headers: HEADERS });
    const buffer = await buildGexLiveWorkbook(dataset.rows, parsed.data.category, dataset.runAt);
    return new Response(new Uint8Array(buffer), { headers: {
      ...HEADERS,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Gex Analysis file.xlsx"',
    } });
  }
  if ((parsed.data.format === "chart" || parsed.data.format === "watchlist") && parsed.data.category) {
    const dataset = await getLatestGexDataset(parsed.data.category);
    if (!dataset) return Response.json({ error: "Run live GEX for this expiry category before downloading its script." }, { status: 422, headers: HEADERS });
    const kind = parsed.data.format === "chart" ? "engine" : "scanner";
    const template = await getActiveGexTemplateWithVersion(kind);
    const body = buildGexScriptExport(kind, dataset.rows, template?.content ?? null);
    const runStamp = dataset.runAt.toISOString().replace(/[:.]/g, "-");
    const filename = `${kind === "engine" ? "GEX_Master_Engine" : "Gex_Scanner"}_${parsed.data.category}_template-v${template?.version ?? 0}_${runStamp}.txt`;
    return new Response(body, { headers: {
      ...HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    } });
  }
  if (parsed.data.revision === undefined) return Response.json({ error: "Choose a valid export format and list revision." }, { status: 400, headers: HEADERS });
  const state = await getGexState();
  if (state.revision !== parsed.data.revision) return Response.json({ error: "The GEX list changed. Refresh before downloading." }, { status: 409, headers: HEADERS });
  if (!state.rows.length) return Response.json({ error: "No uploaded symbols have sample data available." }, { status: 422, headers: HEADERS });
  if (parsed.data.format === "xlsx") {
    const buffer = await buildGexDemoWorkbook(state.rows);
    return new Response(new Uint8Array(buffer), { headers: {
      ...HEADERS,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="GEX_Sample_Analysis.xlsx"',
    } });
  }
  const chart = parsed.data.format === "chart";
  const body = chart ? buildGexChartScript(state.rows) : buildGexWatchlistScript(state.rows);
  return new Response(body, { headers: {
    ...HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="${chart ? "GEX_Master_Charts.ts" : "GEX_Watchlist_Column.ts"}"`,
  } });
}
