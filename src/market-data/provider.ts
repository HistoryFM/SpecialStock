export type MarketDataProviderId = "alpaca" | "schwab" | "demo";
export type MarketDataFeed = "iex" | "sip" | "schwab" | "demo";
export type MarketTimeframe = "1m" | "5m" | "15m" | "1d";

export type NormalizedMarketBar = {
  symbol: string;
  timeframe: MarketTimeframe;
  startsAt: Date;
  endsAt: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number | null;
  sourceVwap: number | null;
  isComplete: boolean;
  qualityFlags: string[];
};

export type MarketDataQuality = {
  provider: MarketDataProviderId;
  feed: MarketDataFeed;
  observedAt: Date;
  flags: string[];
};

export type MarketSession = {
  date: string;
  opensAt: Date;
  closesAt: Date;
  isRegularSession: boolean;
  quality: MarketDataQuality;
};

export interface MarketDataProvider {
  readonly id: MarketDataProviderId;
  readonly feed: MarketDataFeed;
  getHistoricalBars(input: {
    symbol: string;
    timeframe: MarketTimeframe;
    startsAt: Date;
    endsAt: Date;
  }): Promise<{ bars: NormalizedMarketBar[]; quality: MarketDataQuality }>;
  getLatestBars(
    symbols: string[],
  ): Promise<{ bars: NormalizedMarketBar[]; quality: MarketDataQuality }>;
  getSession(date: Date): Promise<MarketSession>;
  getPreviousRegularSession(before: Date): Promise<MarketSession>;
}
