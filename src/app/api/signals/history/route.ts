import { auth } from "@/auth";
import { isAuthorizedSession } from "@/auth/authorization";
import { getEligibleSignalHistory } from "@/history/data";

export async function GET(request: Request) {
  if (!isAuthorizedSession(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const search = new URL(request.url).searchParams;
    const filter = search.get("filter") ?? "all";
    const sort = search.get("sort") ?? "newest";
    const cursor = search.get("cursor") ?? undefined;
    if (!["all", "bullish", "bearish"].includes(filter) || !["newest", "conviction"].includes(sort)) {
      throw new Error("Invalid history options.");
    }
    return Response.json(await getEligibleSignalHistory({
      filter: filter as "all" | "bullish" | "bearish",
      sort: sort as "newest" | "conviction",
      cursor,
    }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Invalid history cursor." }, { status: 400 });
  }
}
