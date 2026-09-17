import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { activateSwingWatchlist, SwingConflictError, SwingNotFoundError } from "@/swing/repository";

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { versionId, market, expectedActiveVersionId } = z.object({ versionId: z.string().uuid(), market: z.enum(["US", "INDIA"]), expectedActiveVersionId: z.string().uuid().nullable() }).strict().parse(await request.json());
    const activated = await activateSwingWatchlist(versionId, { market, expectedActiveVersionId });
    return Response.json({ activated }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SwingNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof SwingConflictError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid watchlist version." }, { status: 400 });
    throw error;
  }
}
