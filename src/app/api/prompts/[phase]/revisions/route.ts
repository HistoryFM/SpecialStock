import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createAndActivatePromptRevision, PromptRevisionConflictError } from "@/analysis/prompt-revisions";
import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";

const paramsSchema = z.object({ phase: z.enum(["compact", "full"]) });
const bodySchema = z.object({ instructions: z.string(), expectedActiveRevisionId: z.string().uuid() }).strict();
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, context: { params: Promise<{ phase: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  return Sentry.startSpan({
    name: "Create and activate prompt revision",
    op: "specialstock.prompt.revision.create",
    attributes: { "specialstock.telemetry.origin": "server" },
  }, async (span) => {
    try {
      const { phase } = paramsSchema.parse(await context.params);
      const body = bodySchema.parse(await request.json());
      span.setAttributes({
        "specialstock.prompt.phase": phase,
        "specialstock.prompt.expected_revision_id": body.expectedActiveRevisionId,
        "specialstock.prompt.instructions_length": body.instructions.length,
      });
      Sentry.logger.info("prompt.revision.server_requested", {
        "specialstock.telemetry.origin": "server",
        "specialstock.prompt.phase": phase,
        "specialstock.prompt.operation": "create",
        "specialstock.prompt.expected_revision_id": body.expectedActiveRevisionId,
        "specialstock.prompt.instructions_length": body.instructions.length,
      });
      const revision = await createAndActivatePromptRevision({ phase, ...body });
      span.setAttributes({
        "specialstock.prompt.revision_id": revision.id,
        "specialstock.prompt.instructions_hash": revision.instructionsHash,
        "specialstock.prompt.revision_number": revision.revisionNumber,
      });
      span.setStatus({ code: 1 });
      Sentry.logger.info("prompt.revision.server_created", {
        "specialstock.telemetry.origin": "server",
        "specialstock.prompt.phase": phase,
        "specialstock.prompt.revision_id": revision.id,
        "specialstock.prompt.instructions_hash": revision.instructionsHash,
        "specialstock.prompt.instructions_length": revision.instructions.length,
        "specialstock.prompt.revision_number": revision.revisionNumber,
      });
      revalidatePath("/settings");
      return Response.json({ revision }, { headers: HEADERS });
    } catch (error) {
      span.setAttribute("error.type", error instanceof Error ? error.constructor.name : "UnknownError");
      span.setStatus({ code: 2, message: "prompt_revision_create_failed" });
      Sentry.logger.warn("prompt.revision.server_failed", {
        "specialstock.telemetry.origin": "server",
        "specialstock.prompt.operation": "create",
        "error.type": error instanceof Error ? error.constructor.name : "UnknownError",
      });
      if (error instanceof PromptRevisionConflictError) return Response.json({ error: error.message }, { status: 409, headers: HEADERS });
      if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Invalid prompt." }, { status: 400, headers: HEADERS });
      throw error;
    }
  });
}
