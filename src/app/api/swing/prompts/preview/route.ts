import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { swingPromptPreview } from "@/swing/prompt";

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = z.object({ instructions: z.string().min(100).max(20_000), phase: z.enum(["macro", "stock"]) }).strict().parse(await request.json());
    return Response.json({ preview: swingPromptPreview(body.instructions, body.phase) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Invalid prompt." }, { status: 400 });
    throw error;
  }
}
