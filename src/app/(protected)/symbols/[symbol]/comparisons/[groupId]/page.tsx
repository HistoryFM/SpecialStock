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
  const completedCount = comparison.members.filter(({ row }) => row?.analysis).length;
  return <main className="page-shell detail-shell comparison-page">
    <header className="symbol-header"><Link className="back-link" href="/dashboard">← Watchlist</Link><div className="symbol-identity"><span className="eyebrow">Manual comparison</span><h1>{symbol.data}</h1><p className="muted">{comparison.group.createdAt.toLocaleString()} · raw compact results</p></div></header>
    <section className="comparison-intro" aria-labelledby="comparison-heading">
      <div><p className="eyebrow">Manual multi-interval run</p><h2 id="comparison-heading">Independent judgments at a glance</h2><p>Compare each compact signal directly. SpecialStock does not calculate a combined direction or alignment score.</p></div>
      <span className={`status-pill ${completedCount === comparison.members.length ? "live" : "warning"}`}>{completedCount} of {comparison.members.length} completed</span>
    </section>
    <section className="comparison-grid">
      {comparison.members.map(({ timeframe, row }) => {
        const analysis = row?.analysis;
        return <article className={`comparison-card signal-${analysis?.verdict ?? "neutral"}`} key={timeframe}>
          <header className="comparison-judgment-heading"><div><span className="comparison-timeframe">{timeframe}</span><p>Compact signal</p></div><div><h2>{analysis?.verdict?.replace("_", " ") ?? row?.slot.status.replace("_", " ") ?? "Unavailable"}</h2>{analysis ? <span className={`conviction-badge ${analysis.conviction}`}>{analysis.conviction} conviction</span> : null}</div></header>
          <dl className="comparison-primary-levels"><div><dt>Observed</dt><dd>{price(analysis?.observedPrice)}</dd></div><div><dt>Target</dt><dd className="positive">{price(analysis?.primaryTarget)}</dd></div><div><dt>Invalidation</dt><dd className="negative">{price(analysis?.invalidationLevel)}</dd></div></dl>
          <dl className="comparison-metadata"><div><dt>Visual quality</dt><dd>{analysis?.visualQuality ?? "—"}</dd></div><div><dt>Status</dt><dd>{row?.slot.status.replace("_", " ") ?? "unavailable"}</dd></div><div><dt>Captured</dt><dd>{row?.artifact?.frozenInput.capturedAt ? new Date(String(row.artifact.frozenInput.capturedAt)).toLocaleString() : row?.slot.scheduledFor.toLocaleString() ?? "—"}</dd></div><div><dt>Provider cost</dt><dd>{row?.run?.costUsd == null ? "—" : `$${Number(row.run.costUsd).toFixed(6)}`}</dd></div></dl>
          {analysis ? <Link className="primary-button comparison-detail-link" href={analysisUrl(symbol.data, analysis.id)}>Open {timeframe} analysis →</Link> : null}
          {row?.artifact ? <details className="comparison-chart-disclosure"><summary><span>Frozen chart</span><small>Exact model input</small></summary><div className="comparison-chart-frame"><Image alt={`${symbol.data} ${timeframe} frozen chart`} className="comparison-chart" height={row.artifact.height} src={`/api/chart-artifacts/${row.artifact.id}/image`} unoptimized width={row.artifact.width} /></div></details> : <div className="comparison-chart-unavailable">No completed chart is available for this interval.</div>}
        </article>;
      })}
    </section>
  </main>;
}
