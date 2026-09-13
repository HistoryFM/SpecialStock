import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getRun, loadPriceFilesById } from "@/backtesting/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const run = await getRun((await context.params).id);
  if (!run) return Response.json({ error: "Run not found." }, { status: 404, headers });
  if (run.result.trades.some((trade) => !trade.closePrices)) {
    try {
      const files = await loadPriceFilesById(run.result.fileIds);
      const prices = Object.fromEntries(Object.entries(files).map(([ticker, file]) => [ticker, new Map(file.rows.map((row) => [row.date, row.close]))]));
      return Response.json({ run: { ...run, result: { ...run.result, trades: run.result.trades.map((trade) => ({ ...trade,
        closePrices: Object.fromEntries(Object.entries(prices).flatMap(([ticker, byDate]) => {
          const price = byDate.get(trade.date); return price === undefined ? [] : [[ticker, price]];
        })) })) } } }, { headers });
    } catch { /* Historical reports remain readable if a local CSV version is unavailable. */ }
  }
  return Response.json({ run }, { headers });
}
