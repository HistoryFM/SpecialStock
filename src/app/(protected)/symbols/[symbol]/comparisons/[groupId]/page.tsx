import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getManualComparison } from "@/scans/comparison";
import { tickerSchema } from "@/settings/schema";
import { analysisUrl } from "@/symbols/presentation";

export const dynamic = "force-dynamic";

function price(value: string | null | undefined) {
  return value == null ? "—" : `$${Number(value).toFixed(2)}`;
}

export default async function ComparisonPage({ params }: { params: Promise<{ symbol: string; groupId: string }> }) {
  const input = await params;
  const symbol = tickerSchema.safeParse(input.symbol);
  if (!symbol.success) notFound();
  const comparison = await getManualComparison(symbol.data, input.groupId);
  if (!comparison) notFound();
  return <main className="page-shell detail-shell comparison-page">
    <header className="symbol-header"><Link className="back-link" href="/dashboard">← Watchlist</Link><div className="symbol-identity"><span className="eyebrow">Manual comparison</span><h1>{symbol.data}</h1><p className="muted">{comparison.group.createdAt.toLocaleString()} · raw compact results</p></div></header>
    <section className="comparison-grid">
      {comparison.members.map(({ timeframe, row }) => {
        const analysis = row?.analysis;
        return <article className={`comparison-card signal-${analysis?.verdict ?? "neutral"}`} key={timeframe}>
          <div className="section-heading"><div><p className="eyebrow">{timeframe} chart</p><h2>{analysis?.verdict?.replace("_", " ") ?? row?.slot.status.replace("_", " ") ?? "Unavailable"}</h2></div>{analysis ? <span className="status-pill neutral">{analysis.conviction}</span> : null}</div>
          {row?.artifact ? <Image alt={`${symbol.data} ${timeframe} frozen chart`} className="comparison-chart" height={row.artifact.height} src={`/api/chart-artifacts/${row.artifact.id}/image`} unoptimized width={row.artifact.width} /> : <div className="table-empty">No completed chart is available for this interval.</div>}
          <dl className="comparison-levels"><div><dt>Status</dt><dd>{row?.slot.status.replace("_", " ") ?? "unavailable"}</dd></div><div><dt>Captured</dt><dd>{row?.artifact?.frozenInput.capturedAt ? new Date(String(row.artifact.frozenInput.capturedAt)).toLocaleString() : row?.slot.scheduledFor.toLocaleString() ?? "—"}</dd></div><div><dt>Observed</dt><dd>{price(analysis?.observedPrice)}</dd></div><div><dt>Target</dt><dd>{price(analysis?.primaryTarget)}</dd></div><div><dt>Invalidation</dt><dd>{price(analysis?.invalidationLevel)}</dd></div><div><dt>Quality</dt><dd>{analysis?.visualQuality ?? "—"}</dd></div><div><dt>Cost</dt><dd>{row?.run?.costUsd == null ? "—" : `$${Number(row.run.costUsd).toFixed(6)}`}</dd></div></dl>
          {analysis ? <Link className="primary-button" href={analysisUrl(symbol.data, analysis.id)}>Open detail</Link> : null}
        </article>;
      })}
    </section>
  </main>;
}
