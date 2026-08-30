import Link from "next/link";

import { getAlertEvents } from "@/alerts/data";
import { analysisUrl } from "@/symbols/presentation";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const events = await getAlertEvents();
  return (
    <main className="page-shell narrow">
      <section className="page-heading"><div><p className="eyebrow">Material lifecycle events</p><h1>Alert inbox</h1><p className="muted">Only fresh, valid, high-conviction primary changes can appear here.</p></div><span className="status-pill neutral">{events.length} events</span></section>
      {events.length === 0 ? <section className="empty-state"><h2>No alert events</h2><p>Demo and manual scans are intentionally suppressed.</p></section> : <div className="alert-list">{events.map(({ event, thesis, analysis }) => <article className="settings-card" key={event.id}><div className="section-heading"><div><p className="eyebrow">{event.reason.replaceAll("_", " ")}</p><h2>{thesis.symbol} · {analysis.verdict}</h2></div><span className={`status-pill ${event.deliveryState === "delivered" ? "live" : "neutral"}`}>{event.deliveryState}</span></div><p>{analysis.summary}</p><p className="muted">{event.createdAt.toLocaleString()} · cooldown until {event.cooldownUntil?.toLocaleString() ?? "—"}</p><Link className="secondary-button compact" href={analysisUrl(thesis.symbol, analysis.id)}>Open exact analysis</Link></article>)}</div>}
    </main>
  );
}
