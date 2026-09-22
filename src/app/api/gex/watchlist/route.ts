import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { GEX_DEMO_SYMBOLS } from "@/gex/demo";
import { GexListConflictError, saveGexSymbols } from "@/gex/repository";
import { GEX_MAX_UPLOAD_BYTES, GexWatchlistError, parseGexWatchlistFile } from "@/gex/watchlist";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };
const sampleRequest = z.object({ source: z.literal("sample"), expectedRevision: z.number().int().nonnegative() }).strict();

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try {
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const input = sampleRequest.parse(await request.json());
      const state = await saveGexSymbols({ symbols: GEX_DEMO_SYMBOLS, sourceFilename: "GEX analysis sample", expectedRevision: input.expectedRevision });
      return Response.json({ state, rejected: [], duplicates: 0 }, { headers: HEADERS });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a CSV, TXT, or XLSX file." }, { status: 400, headers: HEADERS });
    if (file.size > GEX_MAX_UPLOAD_BYTES) return Response.json({ error: "GEX list files must be 1 MB or smaller." }, { status: 413, headers: HEADERS });
    const expectedRevision = z.coerce.number().int().nonnegative().parse(form.get("expectedRevision"));
    const parsed = await parseGexWatchlistFile(file.name, Buffer.from(await file.arrayBuffer()));
    const state = await saveGexSymbols({ symbols: parsed.symbols, sourceFilename: file.name, expectedRevision });
    return Response.json({ state, rejected: parsed.rejected, duplicates: parsed.duplicates }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof GexListConflictError) return Response.json({ error: error.message }, { status: 409, headers: HEADERS });
    if (error instanceof GexWatchlistError) return Response.json({ error: error.message }, { status: 400, headers: HEADERS });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid GEX list request." }, { status: 400, headers: HEADERS });
    throw error;
  }
}
