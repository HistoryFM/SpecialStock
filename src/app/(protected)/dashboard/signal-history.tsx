"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { EligibleSignalHistoryPage, SignalHistoryFilter, SignalHistorySort } from "@/history/data";

function money(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function timestamp(value: string) {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date),
  };
}

export function SignalHistory({ initialPage }: { initialPage: EligibleSignalHistoryPage }) {
  const router = useRouter();
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<SignalHistoryFilter>("all");
  const [sort, setSort] = useState<SignalHistorySort>("newest");

  async function loadPage(nextFilter: SignalHistoryFilter, nextSort: SignalHistorySort, nextCursor?: string) {
    const search = new URLSearchParams({ filter: nextFilter, sort: nextSort });
    if (nextCursor) search.set("cursor", nextCursor);
    const response = await fetch(`/api/signals/history?${search}`, { cache: "no-store" });
    if (!response.ok) throw new Error("History could not be loaded.");
    return response.json() as Promise<EligibleSignalHistoryPage>;
  }

  async function changeView(nextFilter: SignalHistoryFilter, nextSort: SignalHistorySort) {
    if (loading || (nextFilter === filter && nextSort === sort)) return;
    setLoading(true);
    setFilter(nextFilter);
    setSort(nextSort);
    setItems([]);
    setCursor(null);
    try {
      const page = await loadPage(nextFilter, nextSort);
      setItems(page.items);
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await loadPage(filter, sort, cursor);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="watchlist-panel signal-history" aria-labelledby="signal-history-title">
      <div className="watchlist-toolbar">
        <div><h2 id="signal-history-title">Eligible signal history</h2><span>Last 24 hours · medium and high conviction</span></div>
        <div className="watchlist-controls">
          <div className="filter-group" aria-label="Filter signal history">
            {(["all", "bullish", "bearish"] as const).map((value) => (
              <button aria-pressed={filter === value} className={filter === value ? "active" : ""} disabled={loading} key={value} onClick={() => void changeView(value, sort)} type="button">
                {value[0]!.toUpperCase()}{value.slice(1)}
              </button>
            ))}
          </div>
          <button className="secondary-button compact" disabled={loading} onClick={() => void changeView(filter, sort === "newest" ? "conviction" : "newest")} type="button">
            {sort === "conviction" ? "Newest first" : "Conviction High→Low"}
          </button>
        </div>
      </div>
      <div className="watchlist-scroll">
        <table className="watchlist-table signal-history-table">
          <thead><tr><th>Date and time</th><th>Symbol</th><th>Signal</th><th>Price</th><th>Target</th><th>Invalidation</th><th>Full analysis</th></tr></thead>
          <tbody>{items.map((item) => {
            const occurredAt = timestamp(item.scheduledFor);
            return (
              <tr key={item.analysisId} tabIndex={0} onClick={() => router.push(`/symbols/${item.symbol}?analysis=${item.analysisId}`)} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") router.push(`/symbols/${item.symbol}?analysis=${item.analysisId}`);
              }}>
                <td>
                  <time className="signal-history-time" dateTime={item.scheduledFor}>
                    <strong>{occurredAt.date}</strong>
                    <span>{occurredAt.time}</span>
                  </time>
                </td>
                <td><strong>{item.symbol}</strong></td>
                <td><span className={`signal-badge ${item.verdict}`}><strong>{item.verdict.replace("_", " ")}</strong><span>{item.conviction}</span></span></td>
                <td>{money(item.price)}</td><td>{money(item.target)}</td><td>{money(item.invalidation)}</td>
                <td className="analysis-state-cell">{item.fullAnalysisState.replaceAll("_", " ")}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {!items.length ? <div className="table-empty">No eligible signals yet.</div> : null}
      </div>
      {cursor ? <button className="secondary-button" disabled={loading} onClick={() => void loadMore()} type="button">{loading ? "Loading…" : "Load more"}</button> : null}
    </section>
  );
}
