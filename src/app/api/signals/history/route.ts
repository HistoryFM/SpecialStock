import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getEligibleSignalHistory } from "@/history/data";

export async function GET(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    return Response.json(await getEligibleSignalHistory(cursor), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Invalid history cursor." }, { status: 400 });
  }
}
