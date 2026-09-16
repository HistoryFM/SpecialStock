import { dateFromMarketParts } from "@/market-data/time";
import type { MarketSession } from "@/market-data/provider";

const SLOT_WINDOW_MS = 10 * 60_000;

export function swingScheduledFor(session: Pick<MarketSession, "date" | "closesAt" | "isRegularSession">): Date | null {
  if (!session.isRegularSession) return null;
  const normalClose = dateFromMarketParts(session.date, 16, 0);
  return session.closesAt.getTime() === normalClose.getTime()
    ? dateFromMarketParts(session.date, 15, 50, 10)
    : new Date(session.closesAt.getTime() - 10 * 60_000 - 10_000);
}

export function eligibleSwingSlot(now: Date, session: Pick<MarketSession, "date" | "closesAt" | "isRegularSession">) {
  const scheduledFor = swingScheduledFor(session);
  if (!scheduledFor) return null;
  const age = now.getTime() - scheduledFor.getTime();
  if (age < 0 || age > SLOT_WINDOW_MS) return null;
  return { scheduledFor, sessionDate: session.date, idempotencyKey: `swing:auto:${session.date}` };
}

export function missedSwingSlot(now: Date, session: Pick<MarketSession, "date" | "closesAt" | "isRegularSession">): Date | null {
  const scheduledFor = swingScheduledFor(session);
  return scheduledFor && now.getTime() > scheduledFor.getTime() + SLOT_WINDOW_MS ? scheduledFor : null;
}
