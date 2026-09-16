import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { deleteRun, getRun, loadPriceFilesById, renameRun } from "@/backtesting/storage";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const run = await getRun((await context.params).id);
  if (!run) return Response.json({ error: "Run not found." }, { status: 404, headers });
  if (!run.result.closeSeries || run.result.trades.some((trade) => !trade.closePrices)) {
    try {
      const files = await loadPriceFilesById(run.result.fileIds);
      const prices = Object.fromEntries(Object.entries(files).map(([ticker, file]) => [ticker, new Map(file.rows.map((row) => [row.date, row.close]))]));
      return Response.json({ run: { ...run, result: { ...run.result,
        closeSeries: Object.entries(prices).map(([ticker, byDate]) => ({ ticker, values: run.result.dates.map((date) => byDate.get(date)!).filter((value) => value !== undefined) })),
        trades: run.result.trades.map((trade) => ({ ...trade,
        closePrices: Object.fromEntries(Object.entries(prices).flatMap(([ticker, byDate]) => {
          const price = byDate.get(trade.date); return price === undefined ? [] : [[ticker, price]];
        })) })) } } }, { headers });
    } catch { /* Historical reports remain readable if a local CSV version is unavailable. */ }
  }
  return Response.json({ run }, { headers });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(await request.json());
    const run = await renameRun((await context.params).id, name);
    return run ? Response.json({ run }, { headers }) : Response.json({ error: "Run not found." }, { status: 404, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not rename run." }, { status: 400, headers });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  return await deleteRun((await context.params).id)
    ? new Response(null, { status: 204, headers })
    : Response.json({ error: "Run not found." }, { status: 404, headers });
}
