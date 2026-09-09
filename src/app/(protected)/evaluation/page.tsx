import { getEvaluationData } from "@/evaluation/data";

export const dynamic = "force-dynamic";

function failures(value: Record<string, number>) {
  const entries = Object.entries(value);
  return entries.length ? entries.map(([kind, count]) => `${kind}: ${count}`).join(" · ") : "none";
}

export default async function EvaluationPage() {
  const data = await getEvaluationData();
  const evidenceReady = data.qualifyingSessions >= 3 && data.resolvedDirectionalOutcomes >= 30;
  return (
    <main className="page-shell">
      <section className="page-heading"><div><p className="eyebrow">Evidence before preference</p><h1>Inference evaluation</h1><p className="muted">Completion, prediction outcomes, coverage, latency, cost, retry behavior, and reviewer flags grouped by inference profile and prompt revision.</p></div><span className={`status-pill ${evidenceReady ? "success" : "neutral"}`}>{Math.min(data.qualifyingSessions, 3)} / 3 sessions · {Math.min(data.resolvedDirectionalOutcomes, 30)} / 30 resolved</span></section>
      {data.profileMetrics.length === 0 ? <section className="empty-state"><h2>No evaluation-eligible compact runs yet</h2><p>Manual smoke analyses are intentionally excluded. Scheduled Gemini scans populate evaluation.</p></section> : <div className="table-wrap"><table><thead><tr><th>Profile / prompt</th><th>Completion</th><th>Coverage</th><th>Target / invalidation</th><th>Expired / ambiguous</th><th>Latency median / p90</th><th>Queue median / p90</th><th>Reasoning median</th><th>Retries</th><th>Failures</th><th>Avg cost</th><th>Unsupported</th></tr></thead><tbody>{data.profileMetrics.map((metric) => <tr key={metric.key}><td><strong>{metric.profile}</strong><br /><code>{metric.promptRevisionId}</code><br /><span className="muted">{metric.model}</span></td><td>{(metric.completionRate * 100).toFixed(1)}%<br /><span className="muted">{metric.completed} / {metric.runs}</span></td><td>{(metric.noTradeRate * 100).toFixed(1)}% no trade<br /><span className="muted">{metric.directional} directional</span></td><td>{metric.target} / {metric.invalidation}</td><td>{metric.expired} / {metric.ambiguous}</td><td>{metric.medianLatency ?? "—"} / {metric.p90Latency ?? "—"} ms</td><td>{metric.medianQueueWait ?? "—"} / {metric.p90QueueWait ?? "—"} ms</td><td>{metric.medianReasoningTokens?.toLocaleString() ?? "unknown"}</td><td>{metric.retries}<br /><span className="muted">{metric.recoveredRetries} recovered</span></td><td>{failures(metric.failures)}</td><td>${metric.averageCost.toFixed(6)}</td><td>{metric.unsupported} / {metric.reviewed}</td></tr>)}</tbody></table></div>}
      <section className="notice-card"><div><strong>{evidenceReady ? "Evaluation sample ready" : "Do not judge prediction improvement yet"}</strong><p>Use target-first versus invalidation-first as the primary outcome and no-trade rate as coverage. Require at least three qualifying sessions and 30 resolved directional outcomes before comparing prediction quality.</p></div><span className={`status-pill ${evidenceReady ? "success" : "warning"}`}>{evidenceReady ? "Review evidence" : "Collecting evidence"}</span></section>
    </main>
  );
}
