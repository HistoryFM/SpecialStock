import "server-only";

import { Temporal } from "@js-temporal/polyfill";

import type {
  MarketDataProvider,
  MarketSession,
  MarketTimeframe,
  NormalizedMarketBar,
} from "@/market-data/provider";
import {
  dateFromMarketParts,
  isWeekday,
  marketDate,
  MARKET_TIME_ZONE,
  previousWeekday,
} from "@/market-data/time";

function symbolSeed(symbol: string): number {
  return [...symbol].reduce((sum, character) => sum * 31 + character.charCodeAt(0), 17);
}

function minuteBar(symbol: string, startsAt: Date, index: number): NormalizedMarketBar {
  const seed = symbolSeed(symbol);
  const base = 80 + (seed % 340);
  const wave = Math.sin((index + seed) / 17) * 2.4 + Math.sin((index + seed) / 61) * 4.8;
  const trend = ((index % 390) - 195) * ((seed % 7) - 3) * 0.0009;
  const open = base + wave + trend;
  const close = open + Math.sin((index + seed) / 5) * 0.38;
  const spread = 0.18 + Math.abs(Math.cos((index + seed) / 11)) * 0.42;
  const volume = Math.round(35_000 + Math.abs(Math.sin((index + seed) / 13)) * 190_000);
  return {
    symbol,
    timeframe: "1m",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60_000),
    open,
    high: Math.max(open, close) + spread,
    low: Math.min(open, close) - spread,
    close,
    volume,
    tradeCount: Math.round(volume / 110),
    sourceVwap: (open + close) / 2,
    isComplete: true,
    qualityFlags: ["demo_data"],
  };
}

function aggregateDaily(symbol: string, bars: NormalizedMarketBar[]): NormalizedMarketBar[] {
  const byDate = Map.groupBy(bars, (bar) => marketDate(bar.startsAt));
  return Array.from(byDate, ([, sessionBars]) => ({
    symbol,
    timeframe: "1d" as const,
    startsAt: sessionBars[0]!.startsAt,
    endsAt: sessionBars.at(-1)!.endsAt,
    open: sessionBars[0]!.open,
    high: Math.max(...sessionBars.map((bar) => bar.high)),
    low: Math.min(...sessionBars.map((bar) => bar.low)),
    close: sessionBars.at(-1)!.close,
    volume: sessionBars.reduce((sum, bar) => sum + bar.volume, 0),
    tradeCount: sessionBars.reduce((sum, bar) => sum + (bar.tradeCount ?? 0), 0),
    sourceVwap: null,
    isComplete: true,
    qualityFlags: ["demo_data"],
  }));
}

export class DemoMarketDataProvider implements MarketDataProvider {
  readonly id = "demo" as const;
  readonly feed = "demo" as const;

  async getHistoricalBars(input: {
    symbol: string;
    timeframe: MarketTimeframe;
    startsAt: Date;
    endsAt: Date;
  }) {
    const start = Temporal.Instant.fromEpochMilliseconds(input.startsAt.getTime())
      .toZonedDateTimeISO(MARKET_TIME_ZONE)
      .toPlainDate();
    const end = Temporal.Instant.fromEpochMilliseconds(input.endsAt.getTime())
      .toZonedDateTimeISO(MARKET_TIME_ZONE)
      .toPlainDate();
    const bars: NormalizedMarketBar[] = [];
    let day = start;
    let globalIndex = 0;
    while (Temporal.PlainDate.compare(day, end) <= 0) {
      if (day.dayOfWeek <= 5) {
        const open = dateFromMarketParts(day.toString(), 9, 30);
        for (let minute = 0; minute < 390; minute += 1) {
          const startsAt = new Date(open.getTime() + minute * 60_000);
          if (startsAt >= input.startsAt && startsAt <= input.endsAt) {
            bars.push(minuteBar(input.symbol, startsAt, globalIndex));
          }
          globalIndex += 1;
        }
      }
      day = day.add({ days: 1 });
    }
    const selected = input.timeframe === "1d" ? aggregateDaily(input.symbol, bars) : bars;
    return {
      bars: selected,
      quality: {
        provider: this.id,
        feed: this.feed,
        observedAt: new Date(),
        flags: ["demo_data"],
      },
    };
  }

  async getLatestBars(symbols: string[]) {
    const date = previousWeekday(new Date());
    const startsAt = new Date(dateFromMarketParts(date, 15, 59));
    return {
      bars: symbols.map((symbol) => minuteBar(symbol, startsAt, 389)),
      quality: {
        provider: this.id,
        feed: this.feed,
        observedAt: new Date(),
        flags: ["demo_data"],
      },
    };
  }

  async getSession(date: Date): Promise<MarketSession> {
    const dateString = marketDate(date);
    const regular = isWeekday(dateString);
    return {
      date: dateString,
      opensAt: dateFromMarketParts(dateString, 9, 30),
      closesAt: dateFromMarketParts(dateString, 16, 0),
      isRegularSession: regular,
      quality: {
        provider: this.id,
        feed: this.feed,
        observedAt: new Date(),
        flags: ["demo_calendar"],
      },
    };
  }
}
