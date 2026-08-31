import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/config/env";
import type {
  MarketDataProvider,
  MarketSession,
  MarketTimeframe,
  NormalizedMarketBar,
} from "@/market-data/provider";
import { dateFromMarketParts, marketDate } from "@/market-data/time";

const alpacaBarSchema = z.object({
  t: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
  n: z.number().optional(),
  vw: z.number().optional(),
});

const barsResponseSchema = z.object({
  bars: z.record(z.string(), z.array(alpacaBarSchema)),
  next_page_token: z.string().nullable().optional(),
});

const latestBarsResponseSchema = z.object({
  bars: z.record(z.string(), alpacaBarSchema),
});

const calendarSchema = z.array(
  z.object({
    date: z.string(),
    open: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    close: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  }),
);

function calendarTimestamp(date: string, clockTime: string): Date {
  const [hour, minute] = clockTime.split(":").map(Number) as [number, number];
  return dateFromMarketParts(date, hour, minute);
}

const timeframeMap: Record<MarketTimeframe, string> = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "1d": "1Day",
};

function timeframeDuration(timeframe: MarketTimeframe): number {
  if (timeframe === "1d") return 24 * 60 * 60_000;
  return Number.parseInt(timeframe, 10) * 60_000;
}

export class AlpacaMarketDataProvider implements MarketDataProvider {
  readonly id = "alpaca" as const;
  readonly feed = "iex" as const;

  private headers(): HeadersInit {
    const env = getServerEnv();
    if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) {
      throw new Error("Alpaca credentials are not configured.");
    }
    return {
      "APCA-API-KEY-ID": env.ALPACA_API_KEY,
      "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET,
    };
  }

  private async request(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: this.headers(),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Alpaca returned HTTP ${response.status}.`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalize(
    symbol: string,
    timeframe: MarketTimeframe,
    bar: z.infer<typeof alpacaBarSchema>,
    observedAt: Date,
  ): NormalizedMarketBar {
    const startsAt = new Date(bar.t);
    const endsAt = new Date(startsAt.getTime() + timeframeDuration(timeframe));
    return {
      symbol,
      timeframe,
      startsAt,
      endsAt,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      tradeCount: bar.n ?? null,
      sourceVwap: bar.vw ?? null,
      isComplete: endsAt <= observedAt,
      qualityFlags: ["alpaca_iex_partial_market"],
    };
  }

  async getHistoricalBars(input: {
    symbol: string;
    timeframe: MarketTimeframe;
    startsAt: Date;
    endsAt: Date;
  }) {
    const observedAt = new Date();
    const all: NormalizedMarketBar[] = [];
    let pageToken: string | null | undefined;
    do {
      const url = new URL("https://data.alpaca.markets/v2/stocks/bars");
      url.searchParams.set("symbols", input.symbol);
      url.searchParams.set("timeframe", timeframeMap[input.timeframe]);
      url.searchParams.set("start", input.startsAt.toISOString());
      url.searchParams.set("end", input.endsAt.toISOString());
      url.searchParams.set("feed", "iex");
      url.searchParams.set("adjustment", "split");
      url.searchParams.set("sort", "asc");
      url.searchParams.set("limit", "10000");
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const parsed = barsResponseSchema.parse(await this.request(url));
      all.push(
        ...(parsed.bars[input.symbol] ?? []).map((bar) =>
          this.normalize(input.symbol, input.timeframe, bar, observedAt),
        ),
      );
      pageToken = parsed.next_page_token;
    } while (pageToken);

    return {
      bars: all,
      quality: {
        provider: this.id,
        feed: this.feed,
        observedAt,
        flags: ["alpaca_iex_partial_market"],
      },
    };
  }

  async getLatestBars(symbols: string[]) {
    const observedAt = new Date();
    const url = new URL("https://data.alpaca.markets/v2/stocks/bars/latest");
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("feed", "iex");
    const parsed = latestBarsResponseSchema.parse(await this.request(url));
    return {
      bars: Object.entries(parsed.bars).map(([symbol, bar]) =>
        this.normalize(symbol, "1m", bar, observedAt),
      ),
      quality: {
        provider: this.id,
        feed: this.feed,
        observedAt,
        flags: ["alpaca_iex_partial_market"],
      },
    };
  }

  async getSession(date: Date): Promise<MarketSession> {
    const dateString = marketDate(date);
    const url = new URL("https://api.alpaca.markets/v2/calendar");
    url.searchParams.set("start", dateString);
    url.searchParams.set("end", dateString);
    const parsed = calendarSchema.parse(await this.request(url));
    const session = parsed[0];
    const observedAt = new Date();
    const quality = {
      provider: this.id,
      feed: this.feed,
      observedAt,
      flags: ["alpaca_calendar"],
    };
    if (!session) {
      return {
        date: dateString,
        opensAt: date,
        closesAt: date,
        isRegularSession: false,
        quality,
      };
    }
    return {
      date: session.date,
      opensAt: calendarTimestamp(session.date, session.open),
      closesAt: calendarTimestamp(session.date, session.close),
      isRegularSession: true,
      quality,
    };
  }
}
