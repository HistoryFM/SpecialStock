import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { createSwingSublist, SwingConflictError } from "@/swing/repository";

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = z.object({
      sourceVersionId: z.string().uuid(),
      market: z.enum(["US", "INDIA"]),
      name: z.string().trim().min(1).max(100),
      symbols: z.array(z.string().min(1)).min(1).max(100),
      expectedActiveVersionId: z.string().uuid().nullable(),
    }).strict().parse(await request.json());
    return Response.json({ saved: await createSwingSublist(body) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SwingConflictError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof z.ZodError) return Response.json({ error: "Choose a valid name and 1–100 stocks." }, { status: 400 });
    throw error;
  }
}
