import { getEvaluationData } from "@/evaluation/data";

export const dynamic = "force-dynamic";

export default async function EvaluationPage() {
  const data = await getEvaluationData();
  return (
    <main className="page-shell">
      <section className="page-heading"><div><p className="eyebrow">Evidence before preference</p><h1>Model evaluation</h1><p className="muted">Technical claim outcomes, failure behavior, latency, cost, and reviewed unsupported claims.</p></div><span className="status-pill neutral">{Math.min(data.qualifyingSessions, 3)} / 3 qualifying sessions</span></section>
      {data.modelMetrics.length === 0 ? <section className="empty-state"><h2>No evaluation-eligible model runs yet</h2><p>Manual smoke analyses are intentionally excluded. Scheduled Gemini scans populate model evaluation.</p></section> : <div className="table-wrap"><table><thead><tr><th>Model</th><th>Runs</th><th>Primary</th><th>No trade</th><th>Target / invalidation</th><th>Expired / ambiguous</th><th>Median latency</th><th>Avg cost</th><th>Unsupported</th></tr></thead><tbody>{data.modelMetrics.map((metric) => <tr key={metric.model}><td>{metric.model}</td><td>{metric.runs}</td><td>{metric.primary}</td><td>{metric.noTrade}</td><td>{metric.target} / {metric.invalidation}</td><td>{metric.expired} / {metric.ambiguous}</td><td>{metric.medianLatency ?? "—"} ms</td><td>${metric.averageCost.toFixed(6)}</td><td>{metric.unsupported} / {metric.reviewed}</td></tr>)}</tbody></table></div>}
      <section className="notice-card"><div><strong>Notification gate</strong><p>Comparison stops after three qualifying sessions. Model selection and notifications remain manual decisions.</p></div><span className="status-pill warning">Silent evaluation</span></section>
    </main>
  );
}
