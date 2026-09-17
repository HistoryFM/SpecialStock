import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getSwingDailyReport } from "@/swing/service";

export async function GET(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const parsed = z.object({ market: z.enum(["US", "INDIA"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse({ market: url.searchParams.get("market"), date: url.searchParams.get("date") });
  if (!parsed.success) return Response.json({ error: "Choose a valid market and report date." }, { status: 400 });
  return Response.json({ report: await getSwingDailyReport(parsed.data.market, parsed.data.date) }, { headers: { "Cache-Control": "private, no-store" } });
}
