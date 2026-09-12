import { describePredicate, type AnnualRow, type Drawdown, type Predicate, type PriceRow, type RunInput, type RunResult, type Series, type Trade } from "./types";

type Indicators = { sma50: (number | null)[]; sma200: (number | null)[]; rsi: (number | null)[]; macd: (number | null)[]; signal: (number | null)[] };

function sma(values: number[], period: number): (number | null)[] {
  let total = 0;
  return values.map((value, index) => {
    total += value;
    if (index >= period) total -= values[index - period];
    return index < period - 1 ? null : total / period;
  });
}

function ema(values: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  let previous = values[0];
  return values.map((value, index) => {
    previous = index === 0 ? value : previous + alpha * (value - previous);
    return previous;
  });
}

function rsi(values: number[], period: number): (number | null)[] {
  const output: (number | null)[] = Array(values.length).fill(null);
  if (values.length <= period) return output;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const delta = values[i] - values[i - 1]; gain += Math.max(delta, 0); loss += Math.max(-delta, 0); }
  gain /= period; loss /= period;
  const value = () => loss === 0 && gain === 0 ? 50 : loss === 0 ? 100 : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss);
  output[period] = value();
  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
    output[i] = value();
  }
  return output;
}

export function calculateIndicators(closes: number[], input: RunInput["strategy"]): Indicators {
  const fast = ema(closes, input.macdFast);
  const slow = ema(closes, input.macdSlow);
  const macd = fast.map((value, index) => index < input.macdSlow - 1 ? null : value - slow[index]);
  const first = input.macdSlow - 1;
  const signalRaw = ema(macd.slice(first).map((value) => value!), input.macdSignal);
  const signal = macd.map((_, index) => index < first + input.macdSignal - 1 ? null : signalRaw[index - first]);
  return { sma50: sma(closes, 50), sma200: sma(closes, 200), rsi: rsi(closes, input.rsiPeriod), macd, signal };
}

function predicateValues(predicate: Predicate, closes: number[], values: Indicators, index: number): [number | null, number | null] {
  if (predicate.kind === "price_sma") return [closes[index], values[predicate.period === 50 ? "sma50" : "sma200"][index]];
  if (predicate.kind === "sma_pair") return [values.sma50[index], values.sma200[index]];
  if (predicate.kind === "rsi") return [values.rsi[index], predicate.threshold];
  return [values.macd[index], values.signal[index]];
}

export function matchesPredicate(predicate: Predicate, closes: number[], values: Indicators, index: number): boolean {
  if (index < 1) return false;
  const [left, right] = predicateValues(predicate, closes, values, index);
  if (left === null || right === null) return false;
  if (predicate.relation === "above") return left > right;
  if (predicate.relation === "below") return left < right;
  const [priorLeft, priorRight] = predicateValues(predicate, closes, values, index - 1);
  if (priorLeft === null || priorRight === null) return false;
  return predicate.relation === "crosses_above"
    ? priorLeft <= priorRight && left > right
    : priorLeft >= priorRight && left < right;
}

function warmup(input: RunInput): number {
  const rules = [...input.strategy.entry, ...input.strategy.exit];
  return Math.max(1, ...rules.map((rule) => rule.kind === "sma_pair" || (rule.kind === "price_sma" && rule.period === 200) ? 200 : rule.kind === "price_sma" ? 50 : rule.kind === "rsi" ? input.strategy.rsiPeriod + 1 : input.strategy.macdSlow + input.strategy.macdSignal));
}

function percentDrawdown(series: Series, dates: string[], initial: number): Drawdown {
  let peak = initial, peakDate = dates[0], worst = 0, worstPeak = peakDate, trough = peakDate;
  series.values.forEach((value, index) => {
    if (value > peak) { peak = value; peakDate = dates[index]; }
    const drop = value / peak - 1;
    if (drop < worst) { worst = drop; worstPeak = peakDate; trough = dates[index]; }
  });
  return { ticker: series.ticker, percent: worst * 100, peakDate: worstPeak, troughDate: trough };
}

export function runBacktest(input: RunInput, files: Record<string, { id: string; rows: PriceRow[] }>, period?: { startDate: string; endDate: string }): RunResult {
  const tickers = [...new Set([input.longTicker, input.mode === "inverse" ? input.inverseTicker! : null, "SPY", "QQQ", ...input.comparisons].filter((value): value is string => Boolean(value)))];
  for (const ticker of tickers) if (!files[ticker]) throw new Error(`Upload ${ticker} before running this backtest.`);
  const longRows = files[input.longTicker].rows;
  const available = Object.fromEntries(tickers.map((ticker) => [ticker, new Map(files[ticker].rows.map((row) => [row.date, row.close]))])) as Record<string, Map<string, number>>;
  const latestStart = tickers.reduce((date, ticker) => files[ticker].rows[0].date > date ? files[ticker].rows[0].date : date, longRows[0].date);
  const lastDate = period?.endDate ?? tickers.reduce((date, ticker) => files[ticker].rows.at(-1)!.date < date ? files[ticker].rows.at(-1)!.date : date, longRows.at(-1)!.date);
  const minPrior = warmup(input);
  let startIndex = -1;
  for (let index = minPrior; index < longRows.length; index++) {
    const date = longRows[index].date;
    if (date < latestStart || date > lastDate) continue;
    if (period?.startDate && date !== period.startDate) continue;
    if (!period?.startDate && date.slice(5, 7) !== "01") continue;
    if (tickers.every((ticker) => available[ticker].has(date))) { startIndex = index; break; }
  }
  if (startIndex < 0) throw new Error("No shared January start has enough indicator history.");
  const dates = longRows.slice(startIndex).map((row) => row.date).filter((date) => date <= lastDate);
  for (const ticker of tickers) {
    const within = files[ticker].rows.filter((row) => row.date >= dates[0] && row.date <= dates.at(-1)!);
    if (within.length !== dates.length || within.some((row, index) => row.date !== dates[index])) throw new Error(`${ticker} has missing or unaligned trading dates in the comparison period.`);
  }
  const closes = longRows.map((row) => row.close);
  const indicators = calculateIndicators(closes, input.strategy);
  let equity = input.startingCapital;
  let holding: "cash" | "long" | "inverse" = "cash";
  let hasEnteredLong = false;
  const trades: Trade[] = [];
  const strategyValues: number[] = [];
  const slip = input.slippage / 100;
  const transact = (action: "buy" | "sell", ticker: string, date: string) => {
    equity = action === "sell" ? equity * (1 - slip) - input.fee : (equity - input.fee) / (1 + slip);
    if (equity <= 0) throw new Error("Trading fees exhaust the portfolio.");
    trades.push({ date, action, ticker, equityAfter: equity, fee: input.fee, slippagePercent: input.slippage });
  };
  for (let offset = 0; offset < dates.length; offset++) {
    const index = startIndex + offset;
    const date = dates[offset];
    if (offset > 0) {
      const prior = dates[offset - 1];
      if (holding === "long") equity *= available[input.longTicker].get(date)! / available[input.longTicker].get(prior)!;
      else if (holding === "inverse") equity *= available[input.inverseTicker!].get(date)! / available[input.inverseTicker!].get(prior)!;
      else equity *= Math.pow(1 + input.cashRate / 100, (Date.parse(date) - Date.parse(prior)) / 86400000 / 365);
    }
    const enter = input.strategy.entry.every((rule) => matchesPredicate(rule, closes, indicators, index));
    const exit = input.strategy.exit.every((rule) => matchesPredicate(rule, closes, indicators, index));
    if (enter && exit) throw new Error(`Entry and exit rules both fired on ${date}; clarify the strategy.`);
    if (enter && holding !== "long") {
      if (holding === "inverse") transact("sell", input.inverseTicker!, date);
      transact("buy", input.longTicker, date);
      holding = "long"; hasEnteredLong = true;
    } else if (exit && holding === "long" && hasEnteredLong) {
      transact("sell", input.longTicker, date);
      if (input.mode === "inverse") { transact("buy", input.inverseTicker!, date); holding = "inverse"; }
      else holding = "cash";
    }
    strategyValues.push(equity);
  }
  const series: Series[] = [{ ticker: "Strategy", values: strategyValues }];
  for (const ticker of tickers.filter((value) => value !== input.longTicker && value !== input.inverseTicker)) {
    const first = available[ticker].get(dates[0])!;
    series.push({ ticker, values: dates.map((date) => input.startingCapital * available[ticker].get(date)! / first) });
  }
  const years = [...new Set(dates.map((date) => date.slice(0, 4)))];
  const annual: AnnualRow[] = years.map((year, yearIndex) => {
    const endIndex = dates.findLastIndex((date) => date.startsWith(year));
    const priorIndex = yearIndex === 0 ? -1 : dates.findLastIndex((date) => Number(date.slice(0, 4)) < Number(year));
    return { year: year === dates.at(-1)!.slice(0, 4) && dates.at(-1)!.slice(5) < "12-28" ? `${year} YTD` : year,
      returns: Object.fromEntries(series.map((item) => [item.ticker, (item.values[endIndex] / (priorIndex < 0 ? input.startingCapital : item.values[priorIndex]) - 1) * 100])) };
  });
  return {
    startDate: dates[0], endDate: dates.at(-1)!, dates, series, annual,
    drawdowns: series.map((item) => percentDrawdown(item, dates, input.startingCapital)), trades,
    fileIds: Object.fromEntries(tickers.map((ticker) => [ticker, files[ticker].id])),
    warnings: ["Price returns only; dividends are not included.", "Same-close signals and fills are an idealized assumption.", `Entry: ${input.strategy.entry.map(describePredicate).join(" AND ")}`, `Exit: ${input.strategy.exit.map(describePredicate).join(" AND ")}`],
  };
}
