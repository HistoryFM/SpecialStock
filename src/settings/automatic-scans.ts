import type { WatchlistEntry } from "@/settings/types";

export function automaticScanSymbols(watchlist: WatchlistEntry[]): string[] {
  return watchlist
    .filter((entry) => entry.automaticScanEnabled)
    .map((entry) => entry.symbol);
}

export function updateAutomaticScanEntries(
  watchlist: WatchlistEntry[],
  symbols: string[],
  enabled: boolean,
): WatchlistEntry[] | null {
  const configured = new Set(watchlist.map((entry) => entry.symbol));
  if (symbols.some((symbol) => !configured.has(symbol))) return null;
  const selected = new Set(symbols);
  return watchlist.map((entry) => selected.has(entry.symbol)
    ? { ...entry, automaticScanEnabled: enabled }
    : entry);
}
