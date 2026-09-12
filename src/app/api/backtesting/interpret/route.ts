import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { interpretStrategy } from "@/backtesting/ai";
import { modelSchema } from "@/backtesting/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ prompt: z.string().trim().min(3).max(4000), model: modelSchema }).strict();

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const input = schema.parse(await request.json());
    return Response.json(await interpretStrategy(input.prompt, input.model), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not interpret strategy." }, { status: error instanceof z.ZodError ? 400 : 502, headers });
  }
}
