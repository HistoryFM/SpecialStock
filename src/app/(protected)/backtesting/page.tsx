import { BacktestingWorkbench } from "./workbench";

export const dynamic = "force-dynamic";

export default function BacktestingPage() {
  return (
    <main className="page-shell backtesting-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Historical strategy lab</p>
          <h1>Backtesting</h1>
          <p className="muted">Import daily prices, test explicit rules, and compare annual returns and full-period drawdowns.</p>
        </div>
        <span className="status-pill">Simulation only</span>
      </section>
      <BacktestingWorkbench />
    </main>
  );
}
