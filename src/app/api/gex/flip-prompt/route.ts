import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { DEFAULT_GEX_FLIP_PROMPT } from "@/gex/gex-flip-reader";
import { getActiveGexTemplate, saveGexTemplate } from "@/gex/repository";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ prompt: z.string().min(100).max(30_000) }).strict();

export async function GET() {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  return Response.json({ prompt: await getActiveGexTemplate("flip_prompt") ?? DEFAULT_GEX_FLIP_PROMPT }, { headers });
}

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Enter a GEX flip prompt between 100 and 30,000 characters." }, { status: 400, headers });
  await saveGexTemplate("flip_prompt", parsed.data.prompt);
  return Response.json({ prompt: parsed.data.prompt }, { headers });
}
