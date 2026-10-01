import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { activateGexList, deleteGexSublist, GexListConflictError, saveGexSublist, saveGexSymbols } from "@/gex/repository";
import { GEX_MAX_UPLOAD_BYTES, GexWatchlistError, parseGexWatchlistFile } from "@/gex/watchlist";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };
const sublistRequest = z.object({ source: z.literal("sublist"), name: z.string().trim().min(1).max(100), symbols: z.array(z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/)).min(1).max(100), expectedRevision: z.number().int().nonnegative() }).strict();

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try {
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const input = sublistRequest.parse(await request.json());
      const state = await saveGexSublist(input);
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

const activationRequest = z.object({ id: z.string().uuid(), expectedRevision: z.number().int().nonnegative() }).strict();
export async function PATCH(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try { return Response.json({ state: await activateGexList(activationRequest.parse(await request.json())) }, { headers: HEADERS }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "GEX list could not be activated." }, { status: error instanceof GexListConflictError ? 409 : 400, headers: HEADERS }); }
}
export async function DELETE(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try { return Response.json({ state: await deleteGexSublist(activationRequest.parse(await request.json())) }, { headers: HEADERS }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "GEX sublist could not be deleted." }, { status: error instanceof GexListConflictError ? 409 : 400, headers: HEADERS }); }
}
