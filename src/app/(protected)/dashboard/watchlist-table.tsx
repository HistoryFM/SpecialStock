"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { SymbolDashboardItem } from "@/dashboard/data";

type Filter = "all" | "directional" | "no_trade" | "attention";
type SortKey = "configured" | "symbol" | "verdict" | "automaticScanEnabled" | "price" | "sourceAt" | "scannedAt";

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "directional", label: "Directional" },
  { value: "no_trade", label: "No trade" },
  { value: "attention", label: "Needs attention" },
];

function price(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function time(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function freshnessLabel(item: SymbolDashboardItem): string {
  if (!item.sourceAt) return "No market data";
  if (item.freshnessSeconds === null) return time(item.sourceAt);
  if (item.freshnessSeconds < 60) return `${item.freshnessSeconds}s old`;
  if (item.freshnessSeconds < 3_600) return `${Math.floor(item.freshnessSeconds / 60)}m old`;
  return `${Math.floor(item.freshnessSeconds / 3_600)}h old`;
}

export function needsAttention(item: SymbolDashboardItem): boolean {
  return Boolean(
    item.error ||
      ["failed", "skipped"].includes(item.status) ||
      (item.status === "running" && !item.attemptIsRunning) ||
      (!item.analysisId && !item.attemptIsRunning) ||
      (item.freshnessSeconds !== null && item.freshnessSeconds > 900),
  );
}

export function filterAndSortItems(
  items: SymbolDashboardItem[],
  filter: Filter,
  sortKey: SortKey,
  direction: "asc" | "desc",
): SymbolDashboardItem[] {
  const filtered = items.filter((item) => {
    if (filter === "directional") return item.verdict === "bullish" || item.verdict === "bearish";
    if (filter === "no_trade") return item.verdict === "no_trade";
    if (filter === "attention") return needsAttention(item);
    return true;
  });
  if (sortKey === "configured") return filtered;

  return [...filtered].sort((a, b) => {
    const left = sortKey === "price" ? a.latestPrice : a[sortKey];
    const right = sortKey === "price" ? b.latestPrice : b[sortKey];
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    const comparison = typeof left === "number"
      ? left - Number(right)
      : String(left).localeCompare(String(right));
    return direction === "asc" ? comparison : -comparison;
  });
}

function SortButton({
  label,
  value,
  active,
  direction,
  onSort,
}: {
  label: string;
  value: SortKey;
  active: boolean;
  direction: "asc" | "desc";
  onSort: (value: SortKey) => void;
}) {
  return (
    <button className="table-sort" type="button" onClick={() => onSort(value)}>
      {label}<span aria-hidden="true">{active ? (direction === "asc" ? " ↑" : " ↓") : ""}</span>
    </button>
  );
}

function signalCopy(item: SymbolDashboardItem) {
  if (item.verdict === "bullish") return { icon: "↑", label: "Bullish" };
  if (item.verdict === "bearish") return { icon: "↓", label: "Bearish" };
  if (item.verdict === "no_trade") return { icon: "—", label: "No trade" };
  return { icon: "·", label: item.status.replaceAll("_", " ") };
}

function convictionCopy(value: SymbolDashboardItem["conviction"]): string | null {
  return value ? `${value[0].toUpperCase()}${value.slice(1)} conviction` : null;
}

export function runStateCopy(
  item: SymbolDashboardItem,
  running: boolean,
): { label: string; tone: "current" | "running" | "failed" | "empty" } {
  const resultTime = time(item.resultCompletedAt);
  if (running) {
    return item.analysisId
      ? { label: `New analysis running · showing previous ${resultTime} result`, tone: "running" }
      : { label: "First analysis running · no completed result yet", tone: "running" };
  }
  if (item.status === "failed" || item.status === "skipped") {
    return item.analysisId
      ? { label: `Latest run failed · showing last valid ${resultTime} result`, tone: "failed" }
      : { label: "Latest run failed · no valid result", tone: "failed" };
  }
  if (item.status === "running") {
    return item.analysisId
      ? { label: `Previous run interrupted · showing last valid ${resultTime} result`, tone: "failed" }
      : { label: "Previous run interrupted · no valid result", tone: "failed" };
  }
  if (item.analysisId && item.resultIsCurrent) {
    return { label: `Latest completed run · ${resultTime}`, tone: "current" };
  }
  if (item.analysisId) {
    return { label: `Showing last valid result · ${resultTime}`, tone: "failed" };
  }
  return { label: "No completed analysis", tone: "empty" };
}

export function WatchlistTable({
  items,
  busySymbols,
  onRun,
  onAutomaticScanChange,
}: {
  items: SymbolDashboardItem[];
  busySymbols: Set<string>;
  onRun: (symbol: string) => void;
  onAutomaticScanChange: (symbols: string[], enabled: boolean) => Promise<boolean>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("configured");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const visible = useMemo(
    () => filterAndSortItems(items, filter, sortKey, direction),
    [direction, filter, items, sortKey],
  );
  const visibleSymbols = visible.map((item) => item.symbol);
  const configuredSymbols = new Set(items.map((item) => item.symbol));
  const activeSelected = new Set([...selected].filter((symbol) => configuredSymbols.has(symbol)));
  const allVisibleSelected = visibleSymbols.length > 0 && visibleSymbols.every((symbol) => selected.has(symbol));

  const sort = (next: SortKey) => {
    if (next === sortKey) setDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(next);
      setDirection("asc");
    }
  };

  const toggleSelected = (symbol: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      for (const symbol of visibleSymbols) {
        if (allVisibleSelected) next.delete(symbol);
        else next.add(symbol);
      }
      return next;
    });
  };

  const updateSelected = async (enabled: boolean) => {
    const symbols = [...activeSelected];
    if (!symbols.length) return;
    setBulkPending(true);
    const updated = await onAutomaticScanChange(symbols, enabled);
    setBulkPending(false);
    if (updated) setSelected(new Set());
  };

  return (
    <section className="watchlist-panel" aria-labelledby="watchlist-title">
      <div className="watchlist-toolbar">
        <div>
          <h2 id="watchlist-title">Watchlist</h2>
          <span>{items.length} configured symbols</span>
        </div>
        <div className="filter-group" aria-label="Filter watchlist">
          {filters.map((option) => (
            <button
              aria-pressed={filter === option.value}
              className={filter === option.value ? "active" : ""}
              key={option.value}
              onClick={() => setFilter(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {activeSelected.size ? (
        <div className="bulk-auto-toolbar" aria-live="polite">
          <strong>{activeSelected.size} selected</strong>
          <span>Change automatic five-minute scanning</span>
          <div>
            <button className="secondary-button compact" disabled={bulkPending} onClick={() => void updateSelected(true)} type="button">
              Enable auto
            </button>
            <button className="secondary-button compact" disabled={bulkPending} onClick={() => void updateSelected(false)} type="button">
              Disable auto
            </button>
          </div>
        </div>
      ) : null}

      <div className="watchlist-scroll">
        <table className="watchlist-table">
          <thead>
            <tr>
              <th className="select-cell">
                <input aria-label="Select all visible stocks" checked={allVisibleSelected} onChange={toggleAllVisible} type="checkbox" />
              </th>
              <th><SortButton label="Symbol / price" value="symbol" active={sortKey === "symbol"} direction={direction} onSort={sort} /></th>
              <th><SortButton label="Signal" value="verdict" active={sortKey === "verdict"} direction={direction} onSort={sort} /></th>
              <th><SortButton label="Auto" value="automaticScanEnabled" active={sortKey === "automaticScanEnabled"} direction={direction} onSort={sort} /></th>
              <th>Visual quality</th>
              <th>Target / invalidation</th>
              <th><SortButton label="Data / last scan" value="scannedAt" active={sortKey === "scannedAt"} direction={direction} onSort={sort} /></th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const href = `/symbols/${item.symbol}`;
              const attention = needsAttention(item);
              const signal = signalCopy(item);
              const running = busySymbols.has(item.symbol) || item.attemptIsRunning;
              const runState = runStateCopy(item, running);
              const conviction = convictionCopy(item.conviction);
              return (
                <tr
                  aria-label={`Open ${item.symbol} analysis`}
                  className={`${attention ? "needs-attention" : ""} ${running ? "is-running" : ""} signal-${item.verdict ?? "neutral"}`}
                  key={item.symbol}
                  onClick={() => router.push(href)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(href);
                    }
                  }}
                  tabIndex={0}
                >
                  <td className="select-cell">
                    <input aria-label={`Select ${item.symbol}`} checked={selected.has(item.symbol)} onChange={() => toggleSelected(item.symbol)} onClick={(event) => event.stopPropagation()} type="checkbox" />
                  </td>
                  <td>
                    <a href={href} onClick={(event) => event.preventDefault()} className="symbol-cell">
                      <strong>{item.symbol}</strong>
                      <span>{item.exchange} · {price(item.latestPrice)}</span>
                    </a>
                  </td>
                  <td>
                    <div className={`signal-badge ${item.verdict ?? "neutral"}`}>
                      <span aria-hidden="true">{signal.icon}</span>
                      <strong>{signal.label}</strong>
                      {conviction ? <span className="conviction-label">{conviction}</span> : null}
                    </div>
                    <small className={`run-state ${runState.tone}`}>{runState.label}</small>
                  </td>
                  <td>
                    <span className={`auto-state ${item.automaticScanEnabled ? "on" : "off"}`}>
                      {item.automaticScanEnabled ? "Auto on" : "Auto off"}
                    </span>
                  </td>
                  <td className="summary-cell">
                    <span>{item.visualQuality ? `${item.visualQuality[0]!.toUpperCase()}${item.visualQuality.slice(1)}` : "Run a scan to assess the chart."}</span>
                    {item.error ? (
                      <details onClick={(event) => event.stopPropagation()}>
                        <summary>Latest scan failed</summary>
                        <p>{item.error}</p>
                      </details>
                    ) : null}
                  </td>
                  <td className="numeric-cell">
                    <span className="positive">{price(item.target)}</span>
                    <span className="negative">{price(item.invalidation)}</span>
                  </td>
                  <td>
                    <span>{freshnessLabel(item)}</span>
                    <small>
                      {item.resultCompletedAt ? `Result ${time(item.resultCompletedAt)}` : `Attempt ${time(item.scannedAt)}`}
                      {` · ${item.slotKind?.replaceAll("_", " ") ?? "—"}`}
                    </small>
                  </td>
                  <td className="action-cell">
                    <button
                      className="secondary-button compact"
                      disabled={running}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRun(item.symbol);
                      }}
                      type="button"
                    >
                      {running ? "Running…" : "Run now"}
                    </button>
                    <details className="mobile-row-details" onClick={(event) => event.stopPropagation()}>
                      <summary>More</summary>
                      <dl>
                        <div><dt>Visual quality</dt><dd>{item.visualQuality ?? "Not assessed"}</dd></div>
                        <div><dt>Levels</dt><dd>{price(item.target)} / {price(item.invalidation)}</dd></div>
                        <div><dt>Model</dt><dd>{item.model}</dd></div>
                        <div><dt>Run status</dt><dd>{runState.label}</dd></div>
                        <div><dt>Automatic scanning</dt><dd>{item.automaticScanEnabled ? "On" : "Off"}</dd></div>
                      </dl>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 ? <div className="table-empty">No symbols match this filter.</div> : null}
      </div>
    </section>
  );
}
