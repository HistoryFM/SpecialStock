import ExcelJS from "exceljs";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getSwingDailyReport } from "@/swing/service";

const columns = [
  ["Symbol", "symbol"], ["Stock Name", "stockName"], ["Industry", "industry"], ["Market", "market"], ["Exchange", "exchange"],
  ["Direction", "displayDirection"], ["Observed", "observedPrice"], ["Entry Low", "entryZoneLow"], ["Entry High", "entryZoneHigh"],
  ["Stop", "stopLoss"], ["Target 1", "profitTarget1"], ["Target 2", "profitTarget2"], ["Conviction", "conviction"],
  ["Risk Reward", "riskReward"], ["Proximity %", "proximityPercent"], ["Quality", "visualQuality"], ["Decision Note", "rejectionReason"],
  ["Source Run", "sourceRunId"], ["Source List", "sourceListName"], ["Completed At", "completedAt"],
] as const;

function industrySort<T extends { industry: string; watchlistPosition: number }>(rows: T[], direction: "asc" | "desc" | "none") {
  if (direction === "none") return rows;
  return rows.toSorted((a, b) => {
    if (!a.industry && b.industry) return 1;
    if (a.industry && !b.industry) return -1;
    const compared = a.industry.localeCompare(b.industry, undefined, { sensitivity: "base" });
    return (direction === "asc" ? compared : -compared) || a.watchlistPosition - b.watchlistPosition;
  });
}

export async function GET(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const parsed = z.object({ market: z.enum(["US", "INDIA"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), recommendedSort: z.enum(["asc", "desc", "none"]).default("none"), noTradeSort: z.enum(["asc", "desc", "none"]).default("none") }).safeParse({
    market: url.searchParams.get("market"), date: url.searchParams.get("date"), recommendedSort: url.searchParams.get("recommendedSort") ?? "none", noTradeSort: url.searchParams.get("noTradeSort") ?? "none",
  });
  if (!parsed.success) return Response.json({ error: "Choose a valid market and report date." }, { status: 400 });
  const report = await getSwingDailyReport(parsed.data.market, parsed.data.date);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SpecialStock";
  const addSheet = (name: string, rows: typeof report.recommended) => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns.map(([header, key]) => ({ header, key, width: Math.max(12, header.length + 2) }));
    for (const row of rows) sheet.addRow({ ...row, market: parsed.data.market, displayDirection: row.originalDirection ?? row.direction });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: "A1", to: `T${Math.max(1, sheet.rowCount)}` };
  };
  addSheet("Recommended", industrySort(report.recommended, parsed.data.recommendedSort));
  addSheet("Directional No-Trade", industrySort(report.directionalNoTrade, parsed.data.noTradeSort) as typeof report.recommended);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="swing-${parsed.data.market.toLowerCase()}-${parsed.data.date}.xlsx"`,
    "Cache-Control": "private, no-store",
  } });
}
