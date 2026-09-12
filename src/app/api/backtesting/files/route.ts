import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { importPriceFile, listPriceFiles } from "@/backtesting/storage";
import { tickerSchema } from "@/backtesting/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  return Response.json({ files: await listPriceFiles() }, { headers });
}

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 10_000_000) throw new Error("Choose a CSV file under 10 MB.");
    const ticker = tickerSchema.parse(form.get("ticker"));
    const imported = await importPriceFile({ ticker, name: file.name, content: await file.text(), splitAdjustedConfirmed: form.get("splitAdjusted") === "true" });
    return Response.json({ file: imported }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not import CSV." }, { status: 400, headers });
  }
}
