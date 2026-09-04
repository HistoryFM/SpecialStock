import { SchedulerClient } from "@/app/(protected)/dashboard/scheduler-client";
import { SignalHistory } from "@/app/(protected)/dashboard/signal-history";
import { getDashboardData } from "@/dashboard/data";
import { getEligibleSignalHistory } from "@/history/data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboardData();
  const history = await getEligibleSignalHistory();

  return (
    <main className="page-shell">
      <section className="page-heading compact-heading">
        <div>
          <p className="eyebrow">Technical scanner</p>
          <h1>Watchlist</h1>
          <p className="muted">
            Frozen Chart-Img snapshots with Gemini visual judgment for the next 15–30 minutes.
          </p>
        </div>
        <span className={`status-pill ${data.demoMode ? "warning" : "live"}`}>
          {data.demoMode ? "Demo providers" : "Live providers"}
        </span>
      </section>

      {data.demoMode ? (
        <div className="warning-banner" role="status">
          <strong>Analysis providers not configured</strong>
          <span>
            Add rotated Chart-Img and OpenRouter keys to `.env.local` before running a scan.
          </span>
        </div>
      ) : null}

      <SchedulerClient
        initialItems={data.items}
        database={data.database}
        budget={data.budget}
        demoMode={data.demoMode}
      />
      <SignalHistory key={history.items[0]?.analysisId ?? "empty"} initialPage={history} />
    </main>
  );
}
