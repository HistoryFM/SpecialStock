import "server-only";

import { getServerEnv } from "@/config/env";
import { AlpacaMarketDataProvider } from "@/market-data/alpaca";
import { DemoMarketDataProvider } from "@/market-data/demo";
import type { MarketDataProvider } from "@/market-data/provider";

export function createMarketDataProvider(): MarketDataProvider {
  const env = getServerEnv();
  return env.ALPACA_API_KEY && env.ALPACA_API_SECRET
    ? new AlpacaMarketDataProvider()
    : new DemoMarketDataProvider();
}
