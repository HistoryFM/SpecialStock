import "server-only";

import { GexChartImgProvider } from "@/gex/chart-provider";
import { GexChartValueReader, type GexChartReading, type GexModelUsage } from "@/gex/chart-reader";
import { GexFlipReader } from "@/gex/gex-flip-reader";

export const GEX_CATEGORIES = ["daily", "weekly", "monthly", "manual"] as const;
export type GexCategory = (typeof GEX_CATEGORIES)[number];

export type GexLiveRow = {
  symbol: string;
  category: GexCategory;
  requestedExpiration?: string;
  expiration: string;
  underlyingPrice: number;
  gexFlip: number;
  callWall: number;
  putWall: number;
  activityCallWall: number;
  activityPutWall: number;
  netGex: number;
  expectedMove: number | null;
  levels: { callEntry: number; callTarget: number; callStop: number; putEntry: number; putTarget: number; putStop: number } | null;
  calculatedAt: string;
  chart: { chartSymbol: string; imageHash: string; values: GexChartReading | null } | null;
};

function tradeLevels(row: GexLiveRow) {
  const values = row.chart?.values;
  if (!values?.readable || values.vwap === null || values.keltnerUpper === null || values.keltnerMiddle === null || values.keltnerLower === null || row.expectedMove === null) return null;
  const positiveGamma = row.underlyingPrice >= row.gexFlip;
  return positiveGamma
    ? { callEntry: row.callWall, callTarget: values.vwap, callStop: row.callWall * 1.005, putEntry: row.putWall, putTarget: values.vwap, putStop: row.putWall * 0.995 }
    : { callEntry: row.callWall, callTarget: row.callWall + row.expectedMove, callStop: Math.min(values.vwap, row.callWall * 0.995), putEntry: row.putWall, putTarget: row.putWall - row.expectedMove, putStop: Math.max(values.keltnerMiddle, row.putWall * 1.005) };
}

type Contract = { strikePrice?: unknown; gamma?: unknown; volatility?: unknown; openInterest?: unknown; totalVolume?: unknown; volume?: unknown };
type Chain = {
  underlyingPrice?: unknown;
  underlying?: { last?: unknown; mark?: unknown; exchangeName?: unknown; quote?: { exchangeName?: unknown } };
  callExpDateMap?: Record<string, Record<string, Contract[]>>;
  putExpDateMap?: Record<string, Record<string, Contract[]>>;
};

export class GexLiveError extends Error {
  constructor(public readonly kind: "not_configured" | "provider" | "unavailable", message: string) { super(message); }
}

const schwabChainAttempts = 3;
const schwabRetryDelaysMs = [400, 900];

function waitForRetry(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function chartExchange(chain: Chain): "NASDAQ" | "NYSE" | "AMEX" | null {
  const raw = chain.underlying?.exchangeName ?? chain.underlying?.quote?.exchangeName;
  if (typeof raw !== "string") return null;
  const exchange = raw.trim().toUpperCase();
  if (exchange.includes("NASDAQ")) return "NASDAQ";
  if (exchange.includes("NYSE AMERICAN") || exchange.includes("NYSE ARCA") || exchange.includes("AMEX")) return "AMEX";
  if (exchange.includes("NYSE")) return "NYSE";
  return null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function expiryDate(key: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(key);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }

function thirdFriday(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month, 1, 12));
  return new Date(Date.UTC(year, month, 1 + ((5 - first.getUTCDay() + 7) % 7) + 14, 12));
}

export function validRequestedExpiration(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = expiryDate(value);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parsed !== null && isoDate(parsed) === value && value >= today;
}

function chooseExpiration(keys: string[], category: GexCategory, now: Date, requestedExpiration?: string): string {
  if (category === "manual" && (!requestedExpiration || !validRequestedExpiration(requestedExpiration, now))) {
    throw new GexLiveError("unavailable", "Select a valid current or future expiration date for manual GEX.");
  }
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const easternHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(now));
  const todayDate = expiryDate(today)!;
  const afterClose = easternHour >= 16;
  const weeklyAfterClose = category === "weekly" && todayDate.getUTCDay() === 5 && afterClose;
  const currentThirdFriday = thirdFriday(todayDate.getUTCFullYear(), todayDate.getUTCMonth());
  const earliest = category === "manual" ? requestedExpiration! : today;
  const options = keys.map((key) => ({ key, date: expiryDate(key) })).filter((value): value is { key: string; date: Date } => value.date !== null).filter((value) => {
    const date = isoDate(value.date);
    if (((category === "daily" && afterClose) || weeklyAfterClose) && date <= today) return false;
    return date >= earliest;
  }).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (category === "manual") {
    if (!options.length) throw new GexLiveError("unavailable", `Schwab returned no expiration on or after ${earliest}.`);
    return options[0]!.key;
  }
  if (!options.length) throw new GexLiveError("unavailable", "Schwab did not return a usable future expiration.");
  if (category === "daily") return options[0]!.key;
  if (category === "weekly") {
    const friday = options.find((value) => value.date.getUTCDay() === 5);
    if (weeklyAfterClose && !friday) throw new GexLiveError("unavailable", "Schwab returned no later Friday expiration after the 4 p.m. Eastern cutoff.");
    return friday?.key ?? options[0]!.key;
  }
  const currentDate = isoDate(currentThirdFriday);
  const target = today > currentDate || (today === currentDate && afterClose)
    ? thirdFriday(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1)
    : currentThirdFriday;
  const targetDate = isoDate(target);
  const monthlyExpiry = options.find((value) => isoDate(value.date) === targetDate);
  if (!monthlyExpiry) throw new GexLiveError("unavailable", `Schwab returned no options chain for the monthly third-Friday expiration ${targetDate}.`);
  return monthlyExpiry.key;
}

function contracts(map: Record<string, Record<string, Contract[]>> | undefined, expiry: string): Contract[] {
  return Object.values(map?.[expiry] ?? {}).flat();
}

function contractsForDate(map: Record<string, Record<string, Contract[]>> | undefined, expiration: string): Contract[] {
  const key = Object.keys(map ?? {}).find((candidate) => candidate.startsWith(`${expiration}:`));
  return key ? contracts(map, key) : [];
}

function highest(entries: Array<[number, number]>): number | null {
  return entries.length ? entries.slice().sort((a, b) => b[1] - a[1])[0]![0] : null;
}

function zeroCrossing(entries: Array<[number, number]>): number | null {
  const sorted = entries.slice().sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < sorted.length; index += 1) {
    const [leftStrike, left] = sorted[index - 1]!; const [rightStrike, right] = sorted[index]!;
    if ((left <= 0 && right >= 0) || (left >= 0 && right <= 0)) {
      const distance = Math.abs(left) + Math.abs(right);
      return distance ? leftStrike + ((rightStrike - leftStrike) * Math.abs(left)) / distance : leftStrike;
    }
  }
  return sorted.length ? sorted.reduce((closest, candidate) => Math.abs(candidate[1]) < Math.abs(closest[1]) ? candidate : closest)[0] : null;
}

function expectedMove(contractsForExpiry: Contract[], spot: number, expiry: Date, now: Date): number | null {
  const atMoney = contractsForExpiry
    .map((contract) => ({ strike: number(contract.strikePrice), volatility: number(contract.volatility) }))
    .filter((contract): contract is { strike: number; volatility: number } => contract.strike !== null && contract.volatility !== null && contract.volatility > 0)
    .sort((left, right) => Math.abs(left.strike - spot) - Math.abs(right.strike - spot))[0];
  if (!atMoney) return null;
  const annualizedVolatility = atMoney.volatility > 3 ? atMoney.volatility / 100 : atMoney.volatility;
  const days = Math.max(1, Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000));
  return spot * annualizedVolatility * Math.sqrt(days / 365);
}

/** Computes dollar GEX as open interest × gamma × 100 × spot²; calls are positive and puts negative.
 * Activity walls are ranked separately by open interest plus traded volume. */
export function calculateGex(chain: Chain, symbol: string, category: GexCategory, now = new Date(), requestedExpiration?: string): GexLiveRow {
  const spot = number(chain.underlyingPrice) ?? number(chain.underlying?.mark) ?? number(chain.underlying?.last);
  if (!spot || spot <= 0) throw new GexLiveError("unavailable", `${symbol} did not include a usable underlying price.`);
  const keys = [...new Set([...Object.keys(chain.callExpDateMap ?? {}), ...Object.keys(chain.putExpDateMap ?? {})])];
  const availableKeys = category === "manual"
    ? Object.keys(chain.callExpDateMap ?? {}).filter((key) => contracts(chain.callExpDateMap, key).length > 0 && contractsForDate(chain.putExpDateMap, key.slice(0, 10)).length > 0)
    : keys;
  const expiry = chooseExpiration(availableKeys, category, now, requestedExpiration);
  const expiryValue = expiryDate(expiry)!;
  const putExpiry = category === "manual" ? Object.keys(chain.putExpDateMap ?? {}).find((key) => key.startsWith(`${isoDate(expiryValue)}:`)) ?? expiry : expiry;
  const callByStrike = new Map<number, number>(); const putByStrike = new Map<number, number>();
  const callWallScore = new Map<number, number>(); const putWallScore = new Map<number, number>();
  for (const contract of contracts(chain.callExpDateMap, expiry)) {
    const strike = number(contract.strikePrice); const gamma = number(contract.gamma); const openInterest = number(contract.openInterest); const volume = number(contract.totalVolume) ?? number(contract.volume) ?? 0;
    if (strike === null || gamma === null || openInterest === null || gamma < 0 || openInterest < 0) continue;
    callByStrike.set(strike, (callByStrike.get(strike) ?? 0) + openInterest * gamma * 100 * spot ** 2);
    callWallScore.set(strike, (callWallScore.get(strike) ?? 0) + openInterest + Math.max(0, volume));
  }
  for (const contract of contracts(chain.putExpDateMap, putExpiry)) {
    const strike = number(contract.strikePrice); const gamma = number(contract.gamma); const openInterest = number(contract.openInterest); const volume = number(contract.totalVolume) ?? number(contract.volume) ?? 0;
    if (strike === null || gamma === null || openInterest === null || gamma < 0 || openInterest < 0) continue;
    putByStrike.set(strike, (putByStrike.get(strike) ?? 0) - openInterest * gamma * 100 * spot ** 2);
    putWallScore.set(strike, (putWallScore.get(strike) ?? 0) + openInterest + Math.max(0, volume));
  }
  const callEntries = [...callByStrike.entries()]; const putEntries = [...putByStrike.entries()].map(([strike, value]) => [strike, Math.abs(value)] as [number, number]);
  const callWall = highest(callEntries); const putWall = highest(putEntries);
  const activityCallWall = highest([...callWallScore.entries()]); const activityPutWall = highest([...putWallScore.entries()]);
  const net = new Map<number, number>();
  for (const [strike, value] of callByStrike) net.set(strike, (net.get(strike) ?? 0) + value);
  for (const [strike, value] of putByStrike) net.set(strike, (net.get(strike) ?? 0) + value);
  const flip = zeroCrossing([...net.entries()]);
  if (callWall === null || putWall === null || activityCallWall === null || activityPutWall === null || flip === null) throw new GexLiveError("unavailable", `${symbol} did not include enough gamma and open-interest data for the selected expiration.`);
  const expectedMoveValue = expectedMove([...contracts(chain.callExpDateMap, expiry), ...contracts(chain.putExpDateMap, putExpiry)], spot, expiryValue, now);
  return { symbol, category, ...(category === "manual" ? { requestedExpiration } : {}), expiration: isoDate(expiryValue), underlyingPrice: spot, gexFlip: flip, callWall, putWall, activityCallWall, activityPutWall, netGex: [...net.values()].reduce((sum, value) => sum + value, 0), expectedMove: expectedMoveValue, levels: null, calculatedAt: now.toISOString(), chart: null };
}

export async function fetchSchwabChain(symbol: string, fetcher: typeof fetch = fetch): Promise<Chain> {
  const token = process.env.SCHWAB_ACCESS_TOKEN?.trim();
  if (!token) throw new GexLiveError("not_configured", "Configure a Schwab access token locally before running live GEX.");
  const url = new URL("https://api.schwabapi.com/marketdata/v1/chains");
  url.searchParams.set("symbol", symbol); url.searchParams.set("contractType", "ALL"); url.searchParams.set("strategy", "SINGLE"); url.searchParams.set("includeUnderlyingQuote", "true");
  for (let attempt = 0; attempt < schwabChainAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    } catch {
      if (attempt < schwabChainAttempts - 1) {
        await waitForRetry(schwabRetryDelaysMs[attempt]!);
        continue;
      }
      throw new GexLiveError("provider", "Schwab options data did not respond before the 20-second deadline after retries.");
    }
    if (response.ok) return response.json() as Promise<Chain>;
    if (response.status === 401 || response.status === 403) {
      throw new GexLiveError("not_configured", "Schwab authorization was rejected. Refresh the local access token.");
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < schwabChainAttempts - 1) {
      await waitForRetry(schwabRetryDelaysMs[attempt]!);
      continue;
    }
    if (response.status === 429) throw new GexLiveError("provider", "Schwab rate-limited this option-chain request after retries. Try the GEX run again shortly.");
    if (response.status >= 500) throw new GexLiveError("provider", "Schwab options service was temporarily unavailable after retries.");
    throw new GexLiveError("provider", "Schwab rejected this option-chain request.");
  }
  throw new GexLiveError("provider", "Schwab options data could not be retrieved.");
}

export async function runLiveGex(symbols: string[], category: GexCategory, fetcher: typeof fetch = fetch, requestedExpiration?: string): Promise<{ rows: GexLiveRow[]; failures: string[]; warnings: string[]; modelUsage: Array<GexModelUsage & { symbol: string; category: GexCategory }> }> {
  if (category === "manual" && (!requestedExpiration || !validRequestedExpiration(requestedExpiration))) {
    throw new GexLiveError("unavailable", "Select a valid current or future expiration date for manual GEX.");
  }
  const chartProvider = new GexChartImgProvider();
  const chartReader = new GexChartValueReader();
  const flipReader = new GexFlipReader();
  const rows: GexLiveRow[] = []; const failures: string[] = []; const pending = [...symbols];
  const warnings: string[] = [];
  const modelUsage: Array<GexModelUsage & { symbol: string; category: GexCategory }> = [];
  const worker = async () => {
    for (let symbol = pending.shift(); symbol; symbol = pending.shift()) {
      try {
        const chain = await fetchSchwabChain(symbol, fetcher);
        const row = calculateGex(chain, symbol, category, new Date(), requestedExpiration);
        try {
          const flip = await flipReader.calculate({
            symbol, spot: row.underlyingPrice, expiration: row.expiration,
            calls: contractsForDate(chain.callExpDateMap, row.expiration),
            puts: contractsForDate(chain.putExpDateMap, row.expiration),
            fetcher,
          });
          modelUsage.push({ ...flip.usage, symbol, category });
          row.gexFlip = flip.result.calculated_zero_gamma_flip;
        } catch (error) { warnings.push(`${symbol}: ${error instanceof Error ? error.message : "The Gemini GEX-flip calculation is unavailable; the deterministic flip was retained."}`); }
        const exchange = chartExchange(chain);
        if (!exchange) {
          warnings.push(`${symbol}: Schwab did not identify a supported Chart-Img exchange.`);
        } else {
          try {
            const captured = await chartProvider.capture({ symbol, exchange, capturedAt: new Date(), fetcher });
            const reading = await chartReader.read({ png: captured.png, fetcher });
            modelUsage.push({ ...reading.usage, symbol, category });
            const values = reading.values;
            row.chart = { chartSymbol: captured.chartSymbol, imageHash: captured.imageHash, values };
            row.levels = tradeLevels(row);
            if (!values.readable) warnings.push(`${symbol}: the latest VWAP or Keltner legend value was not clearly readable.`);
          } catch (error) { warnings.push(`${symbol}: ${error instanceof Error ? error.message : "The GEX chart values are unavailable."}`); }
        }
        rows.push(row);
      }
      catch (error) { failures.push(error instanceof GexLiveError ? `${symbol}: ${error.message}` : `${symbol}: Live GEX calculation failed.`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, symbols.length) }, worker));
  return { rows: symbols.flatMap((symbol) => rows.filter((row) => row.symbol === symbol)), failures, warnings, modelUsage };
}
