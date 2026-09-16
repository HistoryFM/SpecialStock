import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { createSwingPromptRevision, SwingConflictError } from "@/swing/repository";

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = z.object({ instructions: z.string(), expectedActiveRevisionId: z.string().uuid() }).strict().parse(await request.json());
    const revision = await createSwingPromptRevision(body);
    Sentry.logger.info("swing.prompt.revision.created", { "specialstock.swing.prompt_revision": revision.id, "specialstock.swing.instructions_hash": revision.instructionsHash, "specialstock.swing.instructions_length": revision.instructions.length });
    return Response.json({ revision }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SwingConflictError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof z.ZodError || error instanceof Error && error.message.includes("100–20,000")) return Response.json({ error: error instanceof Error ? error.message : "Invalid prompt." }, { status: 400 });
    throw error;
  }
}
