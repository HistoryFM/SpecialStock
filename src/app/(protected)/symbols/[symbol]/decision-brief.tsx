import { levelDistance } from "@/symbols/presentation";
import type { IndicatorReadings } from "@/analysis/types";

type DecisionAnalysis = {
  verdict: "bullish" | "bearish" | "no_trade";
  conviction: "low" | "medium" | "high";
  setupType: string;
  summary: string;
  immediateBias: string;
  primaryTarget: string | null;
  invalidationLevel: string | null;
  supportLevels: number[];
  resistanceLevels: number[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  deeperScenario: string;
  broaderTrend: string;
  indicatorReadings?: IndicatorReadings | null;
};

const indicatorLabels: Record<keyof IndicatorReadings, string> = {
  price_action: "Price action",
  vwap: "VWAP",
  keltner: "Keltner",
  volume: "Volume",
  adx: "ADX",
  rsi: "RSI",
  macd: "MACD",
  cci: "CCI",
  cmf: "CMF",
};

function money(value: string | number | null) {
  return value === null ? "—" : `$${Number(value).toFixed(2)}`;
}

function distanceLabel(distance: ReturnType<typeof levelDistance>): string {
  if (!distance) return "—";
  const sign = distance.percent > 0 ? "+" : "";
  return `${sign}${distance.percent.toFixed(2)}% from analysis price`;
}

export function DecisionBrief({
  analysis,
  snapshotPrice,
}: {
  analysis: DecisionAnalysis;
  snapshotPrice: number | null;
}) {
  const target = analysis.primaryTarget ? Number(analysis.primaryTarget) : null;
  const invalidation = analysis.invalidationLevel ? Number(analysis.invalidationLevel) : null;
  const targetDistance = snapshotPrice === null ? null : levelDistance(snapshotPrice, target);
  const invalidationDistance = snapshotPrice === null ? null : levelDistance(snapshotPrice, invalidation);

  return (
    <article className="decision-brief" data-testid="ai-decision-brief">
      <div className="decision-heading">
        <div><p className="eyebrow">AI analysis · next 15–30 minutes</p><h2>{analysis.verdict.replace("_", " ")}</h2></div>
        <span className={`conviction-badge ${analysis.conviction}`}>{analysis.conviction} conviction</span>
      </div>
      <p className="setup-type">{analysis.setupType}</p>
      <p className="decision-summary">{analysis.summary}</p>
      <section className="immediate-read"><h3>Immediate read</h3><p>{analysis.immediateBias}</p></section>

      {analysis.indicatorReadings ? (
        <section className="indicator-evidence" aria-labelledby="indicator-evidence-title">
          <div className="indicator-evidence-heading">
            <h3 id="indicator-evidence-title">Visual evidence ledger</h3>
            <span>Read directly from the frozen chart</span>
          </div>
          <div className="indicator-evidence-grid">
            {(Object.entries(analysis.indicatorReadings) as Array<[
              keyof IndicatorReadings,
              IndicatorReadings[keyof IndicatorReadings],
            ]>).map(([key, reading]) => (
              <article key={key}>
                <div>
                  <strong>{indicatorLabels[key]}</strong>
                  <span className={`reading-stance ${reading.stance}`}>{reading.stance}</span>
                </div>
                <p>{reading.observation}</p>
                {reading.readability !== "clear" ? <small>{reading.readability} readability</small> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {analysis.verdict === "no_trade" ? (
        <div className="no-trade-grid">
          <section><h3>Why no trade</h3><p>{analysis.summary}</p></section>
          <section><h3>What is conflicting</h3><ul>{analysis.conflictingEvidence.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section><h3>What would need to change</h3><p>{analysis.deeperScenario}</p></section>
        </div>
      ) : (
        <>
          <dl className="decision-levels">
            <div><dt>Analysis price</dt><dd>{money(snapshotPrice)}</dd><small>Frozen snapshot</small></div>
            <div><dt>Primary target</dt><dd className="positive">{money(target)}</dd><small>{distanceLabel(targetDistance)}</small></div>
            <div><dt>Invalidation</dt><dd className="negative">{money(invalidation)}</dd><small>{distanceLabel(invalidationDistance)}</small></div>
          </dl>
          <div className="decision-evidence-grid">
            <section><h3>Why the AI sees it</h3><ul>{analysis.supportingEvidence.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></section>
            <section><h3>Conflicting evidence</h3><ul>{analysis.conflictingEvidence.map((item) => <li key={item}>{item}</li>)}</ul></section>
          </div>
          <section className="changes-view"><h3>What changes this view</h3><p>{invalidation ? `A move through ${money(invalidation)} invalidates the technical thesis. ` : ""}{analysis.deeperScenario}</p></section>
        </>
      )}
      {analysis.supportLevels.length || analysis.resistanceLevels.length ? (
        <section className="changes-view">
          <h3>Visible support and resistance</h3>
          <p>
            Support: {analysis.supportLevels.length ? analysis.supportLevels.map(money).join(", ") : "—"}
            {" · "}
            Resistance: {analysis.resistanceLevels.length ? analysis.resistanceLevels.map(money).join(", ") : "—"}
          </p>
        </section>
      ) : null}
      <footer className="broader-context"><strong>Broader context</strong><span>{analysis.broaderTrend}</span></footer>
    </article>
  );
}
