import { z } from "zod";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { modelSchema } from "@/backtesting/types";
import { interpretPlan } from "@/backtesting/ai";
import { listPriceFiles } from "@/backtesting/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ prompt: z.string().trim().min(3).max(4000), model: modelSchema }).strict();

export async function POST(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const input = schema.parse(await request.json());
    const tickers = [...new Set((await listPriceFiles()).map((file) => file.ticker))];
    return Response.json(await interpretPlan(input.prompt, input.model, tickers), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not interpret strategy." }, { status: error instanceof z.ZodError ? 400 : 502, headers });
  }
}
