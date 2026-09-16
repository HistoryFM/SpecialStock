import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getServerEnv } from "@/config/env";
import { createMarketDataProvider } from "@/market-data/factory";
import { getSwingConfiguration, getSwingPromptStudioState } from "@/swing/repository";
import { swingScheduledFor } from "@/swing/schedule";
import { listSwingRuns } from "@/swing/service";

const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  const now = new Date();
  const [configuration, prompt, runs, session] = await Promise.all([
    getSwingConfiguration(), getSwingPromptStudioState(), listSwingRuns(), createMarketDataProvider().getSession(now),
  ]);
  const env = getServerEnv();
  return Response.json({
    configuration, prompt, runs,
    availability: { chartImg: Boolean(env.CHART_IMG_API_KEY), openRouter: Boolean(env.OPENROUTER_API_KEY) },
    schedule: { nextEligibleAt: swingScheduledFor(session)?.toISOString() ?? null, sessionDate: session.date, regularSession: session.isRegularSession },
  }, { headers: HEADERS });
}
