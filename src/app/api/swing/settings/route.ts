import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { setSwingAutomaticEnabled, SwingConflictError } from "@/swing/repository";

export async function PATCH(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = z.object({ automaticEnabled: z.boolean() }).strict().parse(await request.json());
    const settings = await setSwingAutomaticEnabled(body.automaticEnabled);
    return Response.json({ automaticEnabled: settings.automaticEnabled }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SwingConflictError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid Swing settings." }, { status: 400 });
    throw error;
  }
}
