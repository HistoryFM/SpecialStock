import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { OpenRouterModelCatalogProvider } from "@/models/openrouter-catalog";

export async function GET() {
  if (!isAuthorizedSession(await auth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const availability = await new OpenRouterModelCatalogProvider().getAvailability();
  return NextResponse.json({
    models: availability.map(({ checkedAt, ...model }) => ({
      ...model,
      checkedAt: checkedAt.toISOString(),
    })),
  });
}
