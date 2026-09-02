import { Temporal } from "@js-temporal/polyfill";

export const MARKET_TIME_ZONE = "America/New_York";

export function toMarketZoned(date: Date): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(
    MARKET_TIME_ZONE,
  );
}

export function marketDate(date: Date): string {
  return toMarketZoned(date).toPlainDate().toString();
}

export function marketDayBounds(date: string): { start: Date; end: Date } {
  const plainDate = Temporal.PlainDate.from(date);
  const start = plainDate.toZonedDateTime({
    timeZone: MARKET_TIME_ZONE,
    plainTime: Temporal.PlainTime.from("00:00"),
  });
  const end = plainDate.add({ days: 1 }).toZonedDateTime({
    timeZone: MARKET_TIME_ZONE,
    plainTime: Temporal.PlainTime.from("00:00"),
  });
  return {
    start: new Date(start.epochMilliseconds),
    end: new Date(end.epochMilliseconds),
  };
}

export function normalizeMarketDate(value: string | undefined, now = new Date()): string {
  const today = marketDate(now);
  if (!value || value > today) return today;
  try {
    const parsed = Temporal.PlainDate.from(value);
    return parsed.toString() === value ? value : today;
  } catch {
    return today;
  }
}

export function dateFromMarketParts(
  date: string,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const plainDate = Temporal.PlainDate.from(date);
  return new Date(
    plainDate
      .toZonedDateTime({
        timeZone: MARKET_TIME_ZONE,
        plainTime: new Temporal.PlainTime(hour, minute, second),
      })
      .epochMilliseconds,
  );
}

export function isWeekday(date: string): boolean {
  return Temporal.PlainDate.from(date).dayOfWeek <= 5;
}

export function previousWeekday(date: Date): string {
  let current = toMarketZoned(date).toPlainDate();
  const zoned = toMarketZoned(date);
  if (zoned.hour < 16) current = current.subtract({ days: 1 });
  while (current.dayOfWeek > 5) current = current.subtract({ days: 1 });
  return current.toString();
}

export function addMarketDays(date: string, amount: number): string {
  let current = Temporal.PlainDate.from(date);
  let remaining = Math.abs(amount);
  const direction = amount < 0 ? -1 : 1;
  while (remaining > 0) {
    current = current.add({ days: direction });
    if (current.dayOfWeek <= 5) remaining -= 1;
  }
  return current.toString();
}

export function addCalendarDays(date: string, amount: number): string {
  return Temporal.PlainDate.from(date).add({ days: amount }).toString();
}

export type ScanSlotKind = "postclose";

export type CanonicalScanSlot = {
  kind: ScanSlotKind;
  candleStartsAt: Date;
  scheduledFor: Date;
  idempotencyPart: string;
};

const CANDLE_MS = 5 * 60_000;
const SCAN_DELAY_MS = 10_000;
const REQUESTED_SLOT_MAX_AGE_MS = 10 * 60_000;

function scanSlotForCandle(candleStartsAt: Date): CanonicalScanSlot {
  return {
    kind: "postclose",
    candleStartsAt,
    scheduledFor: new Date(candleStartsAt.getTime() + CANDLE_MS + SCAN_DELAY_MS),
    idempotencyPart: `postclose:${candleStartsAt.toISOString()}`,
  };
}

function isEligibleCandleStart(
  candleStartsAt: Date,
  session: { opensAt: Date; closesAt: Date; isRegularSession: boolean },
): boolean {
  if (!session.isRegularSession) return false;
  const offset = candleStartsAt.getTime() - session.opensAt.getTime();
  const lastIncludedCandleStart = session.closesAt.getTime() - 2 * CANDLE_MS;
  return (
    offset >= 0 &&
    offset % CANDLE_MS === 0 &&
    candleStartsAt.getTime() <= lastIncludedCandleStart
  );
}

export function canonicalScanSlot(
  now: Date,
  session: { opensAt: Date; closesAt: Date; isRegularSession: boolean },
): CanonicalScanSlot | null {
  if (!session.isRegularSession) return null;
  const firstScheduledAt = session.opensAt.getTime() + CANDLE_MS + SCAN_DELAY_MS;
  const nowMs = now.getTime();
  if (nowMs < firstScheduledAt || nowMs >= session.closesAt.getTime()) return null;

  const slotIndex = Math.floor((nowMs - firstScheduledAt) / CANDLE_MS);
  const candleStartsAt = new Date(session.opensAt.getTime() + slotIndex * CANDLE_MS);
  return isEligibleCandleStart(candleStartsAt, session)
    ? scanSlotForCandle(candleStartsAt)
    : null;
}

export function requestedScanSlot(
  slotKey: string,
  now: Date,
  session: { opensAt: Date; closesAt: Date; isRegularSession: boolean },
): CanonicalScanSlot | null {
  const prefix = "postclose:";
  if (!slotKey.startsWith(prefix)) return null;
  const candleStartsAt = new Date(slotKey.slice(prefix.length));
  if (Number.isNaN(candleStartsAt.getTime())) return null;
  if (!isEligibleCandleStart(candleStartsAt, session)) return null;

  const slot = scanSlotForCandle(candleStartsAt);
  const age = now.getTime() - slot.scheduledFor.getTime();
  return age >= 0 && age <= REQUESTED_SLOT_MAX_AGE_MS ? slot : null;
}

export function nextScanTime(
  now: Date,
  session: { opensAt: Date; closesAt: Date; isRegularSession: boolean },
): Date | null {
  if (!session.isRegularSession || now >= new Date(session.closesAt.getTime() + 10_000)) {
    return null;
  }
  const firstScheduledAt = session.opensAt.getTime() + CANDLE_MS + SCAN_DELAY_MS;
  const lastScheduledAt = session.closesAt.getTime() - CANDLE_MS + SCAN_DELAY_MS;
  if (now.getTime() < firstScheduledAt) return new Date(firstScheduledAt);
  const elapsed = now.getTime() - firstScheduledAt;
  const nextScheduledAt = firstScheduledAt + (Math.floor(elapsed / CANDLE_MS) + 1) * CANDLE_MS;
  return nextScheduledAt <= lastScheduledAt ? new Date(nextScheduledAt) : null;
}
