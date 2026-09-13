import { describeAllocations, requiredTickers, type ConditionAtom, type StrategyPlan } from "./plan";
import type { AnnualRow, Drawdown, PriceRow, RunResult, Series, Trade } from "./types";

type Files = Record<string, { id: string; rows: PriceRow[] }>;
type Position = { shares: number; entry: number; best: number };
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86400000;

function sma(closes: number[], period: number): (number | null)[] {
  let sum = 0;
  return closes.map((close, index) => {
    sum += close;
    if (index >= period) sum -= closes[index - period];
    return index < period - 1 ? null : sum / period;
  });
}
function ema(values: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  let prior = values[0];
  return values.map((value, index) => { prior = index ? prior + alpha * (value - prior) : value; return prior; });
}
function rsi(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  let gain = 0, loss = 0;
  for (let index = 1; index <= period; index++) { const delta = closes[index] - closes[index - 1]; gain += Math.max(0, delta); loss += Math.max(0, -delta); }
  gain /= period; loss /= period;
  const compute = () => gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss);
  result[period] = compute();
  for (let index = period + 1; index < closes.length; index++) {
    const delta = closes[index] - closes[index - 1];
    gain = (gain * (period - 1) + Math.max(0, delta)) / period;
    loss = (loss * (period - 1) + Math.max(0, -delta)) / period;
    result[index] = compute();
  }
  return result;
}
function drawdown(series: Series, dates: string[], initial: number): Drawdown {
  let peak = initial, peakDate = dates[0], worst = 0, worstPeak = peakDate, trough = peakDate;
  for (let index = 0; index < dates.length; index++) {
    if (series.values[index] > peak) { peak = series.values[index]; peakDate = dates[index]; }
    const drop = series.values[index] / peak - 1;
    if (drop < worst) { worst = drop; worstPeak = peakDate; trough = dates[index]; }
  }
  return { ticker: series.ticker, percent: worst * 100, peakDate: worstPeak, troughDate: trough };
}

export function runPlannedBacktest(plan: StrategyPlan, files: Files, period?: { startDate: string; endDate: string }): RunResult {
  const tickers = requiredTickers(plan);
  for (const ticker of tickers) if (!files[ticker]) throw new Error(`Upload ${ticker} before running this backtest.`);
  const signalTickers = [...new Set(plan.transitions.flatMap((transition) => transition.when.any.flatMap((group) => group.map((atom) => atom.ticker))))];
  const rows = files[signalTickers[0] ?? tickers[0]].rows;
  const maps = Object.fromEntries(tickers.map((ticker) => [ticker, new Map(files[ticker].rows.map((row) => [row.date, row.close]))])) as Record<string, Map<string, number>>;
  const latestStart = tickers.reduce((date, ticker) => files[ticker].rows[0].date > date ? files[ticker].rows[0].date : date, rows[0].date);
  const end = tickers.reduce((date, ticker) => files[ticker].rows.at(-1)!.date < date ? files[ticker].rows.at(-1)!.date : date, period?.endDate ?? rows.at(-1)!.date);
  const atoms = plan.transitions.flatMap((transition) => transition.when.any.flat());
  const warmup = Math.max(1, ...atoms.map((atom) => atom.kind === "price_sma" ? atom.period : atom.kind === "rsi" ? atom.period + 1 : atom.slow + atom.signal));
  const requestedStart = period?.startDate ?? plan.settings.startDate;
  let startIndex = -1;
  for (let index = warmup; index < rows.length; index++) {
    const date = rows[index].date;
    if (date < latestStart || date > end) continue;
    if (requestedStart === "first_january" ? date.slice(5, 7) !== "01" : date < requestedStart) continue;
    if (tickers.every((ticker) => maps[ticker].has(date))) { startIndex = index; break; }
  }
  if (startIndex < 0) throw new Error("No shared start date has enough indicator history.");
  const dates = rows.slice(startIndex).map((row) => row.date).filter((date) => date <= end);
  for (const ticker of tickers) {
    const aligned = files[ticker].rows.filter((row) => row.date >= dates[0] && row.date <= dates.at(-1)!);
    if (aligned.length !== dates.length || aligned.some((row, index) => row.date !== dates[index])) throw new Error(`${ticker} has missing or unaligned trading dates in the comparison period.`);
  }
  const values = Object.fromEntries(signalTickers.map((ticker) => [ticker, files[ticker].rows.map((row) => row.close)])) as Record<string, number[]>;
  const indexes = Object.fromEntries(signalTickers.map((ticker) => [ticker, new Map(files[ticker].rows.map((row, index) => [row.date, index]))])) as Record<string, Map<string, number>>;
  const cache = new Map<string, (number | null)[]>();
  const indicator = (ticker: string, kind: string, a: number, b = 0, c = 0): (number | null)[] => {
    const key = `${ticker}:${kind}:${a}:${b}:${c}`;
    if (!cache.has(key)) {
      const closes = values[ticker];
      if (kind === "sma") cache.set(key, sma(closes, a));
      else if (kind === "rsi") cache.set(key, rsi(closes, a));
      else {
        const fast = ema(closes, a), slow = ema(closes, b);
        const macd = fast.map((value, index) => index < b - 1 ? null : value - slow[index]);
        if (kind === "macd") cache.set(key, macd);
        else {
          const raw = ema(macd.slice(b - 1).map((value) => value!), c);
          cache.set(key, macd.map((_, index) => index < b + c - 2 ? null : raw[index - b + 1]));
        }
      }
    }
    return cache.get(key)!;
  };
  const match = (atom: ConditionAtom, date: string) => {
    const index = indexes[atom.ticker].get(date)!;
    const left = atom.kind === "price_sma" ? values[atom.ticker] : atom.kind === "rsi" ? indicator(atom.ticker, "rsi", atom.period) : indicator(atom.ticker, "macd", atom.fast, atom.slow, atom.signal);
    const base = atom.kind === "price_sma" ? indicator(atom.ticker, "sma", atom.period)
      : atom.kind === "rsi" ? null : indicator(atom.ticker, "signal", atom.fast, atom.slow, atom.signal);
    const rightAt = (at: number) => atom.kind === "rsi" ? atom.threshold : atom.kind === "price_sma"
      ? base![at] === null ? null : base![at]! * (1 + atom.bandPct / 100) : base![at];
    if (left[index] === null || rightAt(index) === null) return false;
    const delta = left[index]! - rightAt(index)!;
    if (atom.relation === "above") return delta > 0;
    if (atom.relation === "below") return delta < 0;
    if (atom.relation === "at_or_above") return delta >= 0;
    if (atom.relation === "at_or_below") return delta <= 0;
    if (!index || left[index - 1] === null || rightAt(index - 1) === null) return false;
    return atom.relation === "crosses_above" ? left[index - 1]! <= rightAt(index - 1)! && delta > 0 : left[index - 1]! >= rightAt(index - 1)! && delta < 0;
  };
  const positions = new Map<string, Position>();
  const trades: Trade[] = [], strategyValues: number[] = [];
  let equity = plan.settings.startingCapital, state = "cash";
  const close = (ticker: string, date: string) => maps[ticker].get(date)!;
  const gross = (date: string) => [...positions].reduce((total, [ticker, position]) => total + Math.abs(position.shares) * close(ticker, date), 0);
  const execute = (ticker: string, target: number, date: string, reason: string) => {
    const old = positions.get(ticker);
    const current = old?.shares ?? 0;
    if (Math.abs(target - current) < 1e-9) return;
    const price = close(ticker, date);
    const leg = (delta: number, intent: "buy_long" | "sell_long" | "open_short" | "cover_short") => {
      equity -= Math.abs(delta) * price * plan.settings.slippage / 100 + plan.settings.fee;
      if (equity <= 0) throw new Error(`Trading costs exhaust the portfolio on ${date}.`);
      trades.push({ date, action: delta > 0 ? "buy" : "sell", ticker, equityAfter: equity, fee: plan.settings.fee,
        slippagePercent: plan.settings.slippage, intent, reason,
        closePrices: Object.fromEntries(tickers.map((symbol) => [symbol, close(symbol, date)])) });
    };
    if (current && (!target || Math.sign(current) !== Math.sign(target))) {
      leg(-current, current > 0 ? "sell_long" : "cover_short");
      positions.delete(ticker);
    } else if (current && Math.abs(target) < Math.abs(current)) {
      leg(target - current, current > 0 ? "sell_long" : "cover_short");
      positions.set(ticker, { ...old!, shares: target });
    }
    const remaining = positions.get(ticker);
    if (target && (!remaining || Math.abs(target) > Math.abs(remaining.shares) + 1e-9)) {
      const delta = target - (remaining?.shares ?? 0);
      leg(delta, delta > 0 ? "buy_long" : "open_short");
      positions.set(ticker, { shares: target,
        entry: remaining ? (remaining.entry * Math.abs(remaining.shares) + price * Math.abs(delta)) / Math.abs(target) : price,
        best: remaining?.best ?? price });
    }
  };
  for (let offset = 0; offset < dates.length; offset++) {
    const date = dates[offset];
    if (offset) {
      const prior = dates[offset - 1], elapsed = days(prior, date);
      const freeCash = Math.max(0, equity - gross(prior));
      equity += freeCash * (Math.pow(1 + plan.settings.cashRate / 100, elapsed / 365) - 1);
      for (const [ticker, position] of positions) {
        equity += position.shares * (close(ticker, date) - close(ticker, prior));
        if (position.shares < 0) equity -= Math.abs(position.shares) * close(ticker, prior) * plan.settings.borrowRate / 100 * elapsed / 365;
      }
      if (equity <= 0) throw new Error(`Portfolio equity was exhausted on ${date}.`);
    }
    const stopped: string[] = [];
    for (const [ticker, position] of positions) {
      const price = close(ticker, date);
      position.best = position.shares > 0 ? Math.max(position.best, price) : Math.min(position.best, price);
      const stop = plan.stops.find((item) => item.ticker === ticker);
      if (!stop) continue;
      const fixed = stop.fixedPct !== undefined && (position.shares > 0 ? price <= position.entry * (1 - stop.fixedPct / 100) : price >= position.entry * (1 + stop.fixedPct / 100));
      const trailing = stop.trailingPct !== undefined && (position.shares > 0 ? price <= position.best * (1 - stop.trailingPct / 100) : price >= position.best * (1 + stop.trailingPct / 100));
      if (fixed || trailing) stopped.push(ticker);
    }
    if (stopped.length) for (const ticker of stopped) execute(ticker, 0, date, "stop loss");
    else {
      const transition = plan.transitions.find((item) => item.from === state && item.when.any.some((group) => group.every((atom) => match(atom, date))));
      if (transition) {
        const next = plan.states.find((item) => item.id === transition.to);
        const targets = next?.allocations ?? [];
        const targetMap = new Map(targets.map((item) => [item.ticker, equity * item.percent / 100 / close(item.ticker, date) * (item.side === "short" ? -1 : 1)]));
        for (const ticker of [...new Set([...positions.keys(), ...targetMap.keys()])]) execute(ticker, targetMap.get(ticker) ?? 0, date, `phase: ${next?.label ?? "Cash"}`);
        state = transition.to;
      }
    }
    strategyValues.push(equity);
  }
  const series: Series[] = [{ ticker: "Strategy", values: strategyValues }, ...tickers.map((ticker) => {
    const first = close(ticker, dates[0]);
    return { ticker, values: dates.map((date) => plan.settings.startingCapital * close(ticker, date) / first) };
  })];
  const years = [...new Set(dates.map((date) => date.slice(0, 4)))];
  const annual: AnnualRow[] = years.map((year, yearIndex) => {
    const last = dates.findLastIndex((date) => date.startsWith(year));
    const prior = yearIndex ? dates.findLastIndex((date) => Number(date.slice(0, 4)) < Number(year)) : -1;
    return { year: year === dates.at(-1)!.slice(0, 4) && dates.at(-1)!.slice(5) < "12-28" ? `${year} YTD` : year,
      returns: Object.fromEntries(series.map((item) => [item.ticker, (item.values[last] / (prior < 0 ? plan.settings.startingCapital : item.values[prior]) - 1) * 100])) };
  });
  return { startDate: dates[0], endDate: dates.at(-1)!, dates, series, annual,
    drawdowns: series.map((item) => drawdown(item, dates, plan.settings.startingCapital)), trades,
    fileIds: Object.fromEntries(tickers.map((ticker) => [ticker, files[ticker].id])),
    warnings: ["Price returns only; dividends are not included.", "Same-close signals, stops, and fills are idealized.",
      ...plan.states.map((item) => `${item.label}: ${describeAllocations(item.allocations)}`)] };
}
