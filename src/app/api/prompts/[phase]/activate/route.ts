import { revalidatePath } from "next/cache";
import { z } from "zod";

import { activatePromptRevision, PromptRevisionConflictError, PromptRevisionNotFoundError } from "@/analysis/prompt-revisions";
import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";

const paramsSchema = z.object({ phase: z.enum(["compact", "full"]) });
const bodySchema = z.object({ revisionId: z.string().uuid(), expectedActiveRevisionId: z.string().uuid() }).strict();
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, context: { params: Promise<{ phase: string }> }) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  try {
    const { phase } = paramsSchema.parse(await context.params);
    const body = bodySchema.parse(await request.json());
    const revision = await activatePromptRevision({ phase, ...body });
    revalidatePath("/settings");
    return Response.json({ revision }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof PromptRevisionConflictError) return Response.json({ error: error.message }, { status: 409, headers: HEADERS });
    if (error instanceof PromptRevisionNotFoundError) return Response.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid prompt revision." }, { status: 400, headers: HEADERS });
    throw error;
  }
}
