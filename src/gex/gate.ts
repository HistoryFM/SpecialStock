import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import { analyses, gexDatasets } from "@/db/schema";

export type GexGateInput = {
  price: number | null;
  previousPrice: number | null;
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
};

export type GexGate =
  | "CALL BREAKOUT" | "PUT BREAKDOWN" | "CEILING FADE" | "PUT WALL BOUNCE"
  | "AT CALL GATE" | "AT PUT FLOOR" | "FLUSH ZONE" | "NORMAL CORRIDOR"
  | "No daily GEX" | "Price unavailable" | "Previous close unavailable";

const nearGate = (price: number, wall: number) => Math.abs((price - wall) / wall) <= 0.004;

/** Server-side equivalent of the active Gex Scanner ThinkScript. */
export function evaluateGexGate(input: GexGateInput): GexGate {
  const { price, previousPrice, callWall, putWall, gexFlip } = input;
  if (!callWall || !putWall || !gexFlip) return "No daily GEX";
  if (price === null) return "Price unavailable";
  const nearCall = nearGate(price, callWall);
  const nearPut = nearGate(price, putWall);
  if (price >= callWall) return "CALL BREAKOUT";
  if (price <= putWall) return "PUT BREAKDOWN";
  if (previousPrice === null) return "Previous close unavailable";
  if (nearCall && price < previousPrice && price < callWall) return "CEILING FADE";
  if (nearPut && price > previousPrice && price > putWall) return "PUT WALL BOUNCE";
  if (nearCall) return "AT CALL GATE";
  if (nearPut) return "AT PUT FLOOR";
  if (price < gexFlip && price > putWall) return "FLUSH ZONE";
  return "NORMAL CORRIDOR";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Persist one immutable gate result when a five-minute scan completes. */
export async function persistGexGateForFiveMinuteScan(input: {
  analysisId: string;
  symbol: string;
  price: number | null;
  previousPrice: number | null;
}) {
  const database = await getDatabase();
  const [dataset] = await database
    .select({ rows: gexDatasets.rows, runAt: gexDatasets.runAt })
    .from(gexDatasets)
    .where(eq(gexDatasets.category, "daily"))
    .orderBy(desc(gexDatasets.runAt))
    .limit(1);
  const row = Array.isArray(dataset?.rows)
    ? dataset.rows.find((candidate) =>
      typeof candidate === "object" && candidate !== null
      && (candidate as Record<string, unknown>).symbol === input.symbol)
    : null;
  const values = row && typeof row === "object" ? row as Record<string, unknown> : null;
  const gate = evaluateGexGate({
    price: input.price,
    previousPrice: input.previousPrice,
    callWall: finiteNumber(values?.callWall),
    putWall: finiteNumber(values?.putWall),
    gexFlip: finiteNumber(values?.gexFlip),
  });
  await database.update(analyses).set({
    gexGate: gate,
    gexDatasetRunAt: dataset?.runAt ?? null,
  }).where(and(eq(analyses.id, input.analysisId)));
  return gate;
}
