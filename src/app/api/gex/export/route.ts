import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { buildGexDemoWorkbook } from "@/gex/export";
import { getGexState } from "@/gex/repository";
import { buildGexChartScript, buildGexWatchlistScript } from "@/gex/thinkscript";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const querySchema = z.object({ format: z.enum(["xlsx", "chart", "watchlist"]), revision: z.coerce.number().int().nonnegative() }).strict();

export async function GET(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ format: url.searchParams.get("format"), revision: url.searchParams.get("revision") });
  if (!parsed.success) return Response.json({ error: "Choose a valid export format and list revision." }, { status: 400, headers: HEADERS });
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
