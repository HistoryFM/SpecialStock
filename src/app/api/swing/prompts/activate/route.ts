import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { activateSwingPromptRevision, SwingConflictError, SwingNotFoundError } from "@/swing/repository";

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = z.object({ revisionId: z.string().uuid(), expectedActiveRevisionId: z.string().uuid() }).strict().parse(await request.json());
    const revision = await activateSwingPromptRevision(body);
    Sentry.logger.info("swing.prompt.revision.activated", { "specialstock.swing.prompt_revision": revision.id, "specialstock.swing.instructions_hash": revision.instructionsHash });
    return Response.json({ revision }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SwingConflictError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof SwingNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid prompt revision." }, { status: 400 });
    throw error;
  }
}
