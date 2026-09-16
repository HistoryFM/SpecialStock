import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { activateSwingWatchlist, SwingNotFoundError } from "@/swing/repository";

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { versionId } = z.object({ versionId: z.string().uuid() }).strict().parse(await request.json());
    const version = await activateSwingWatchlist(versionId);
    return Response.json({ version }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SwingNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid watchlist version." }, { status: 400 });
    throw error;
  }
}
