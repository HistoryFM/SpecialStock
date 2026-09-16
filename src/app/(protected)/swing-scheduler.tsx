"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { canClaimSwingScheduler, type SwingSchedulerLeader } from "@/swing/leader";

const LOCK_KEY = "specialstock:swing-scheduler-leader";
const LAST_KEY = "specialstock:swing-last-slot";

export function SwingScheduler() {
  useEffect(() => {
    const tabId = crypto.randomUUID();
    let stopped = false;
    let leaderAnnounced = false;
    const tick = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      const now = Date.now();
      let current: SwingSchedulerLeader | null = null;
      try { current = JSON.parse(localStorage.getItem(LOCK_KEY) ?? "null") as SwingSchedulerLeader | null; }
      catch { localStorage.removeItem(LOCK_KEY); }
      if (!canClaimSwingScheduler(current, tabId, now)) { leaderAnnounced = false; return; }
      localStorage.setItem(LOCK_KEY, JSON.stringify({ tabId, expiresAt: now + 30_000 }));
      if (!leaderAnnounced) {
        leaderAnnounced = true;
        Sentry.logger.info("swing.scheduler.leader_acquired");
      }
      try {
        const response = await fetch("/api/swing/state", { cache: "no-store" });
        if (!response.ok) return;
        const state = await response.json() as { configuration: { settings: { automaticEnabled: boolean; activeWatchlistVersionId: string | null } }; schedule: { nextEligibleAt: string | null; sessionDate: string; regularSession: boolean } };
        const due = state.schedule.nextEligibleAt ? Date.parse(state.schedule.nextEligibleAt) : Number.NaN;
        const slot = `swing:auto:${state.schedule.sessionDate}`;
        if (!state.configuration.settings.automaticEnabled || !state.configuration.settings.activeWatchlistVersionId || !state.schedule.regularSession || !Number.isFinite(due) || now < due || localStorage.getItem(LAST_KEY) === slot) return;
        Sentry.logger.info("swing.scheduler.dispatch_requested", { "specialstock.swing.session_date": state.schedule.sessionDate });
        const created = await fetch("/api/swing/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "automatic" }) });
        if (created.ok) localStorage.setItem(LAST_KEY, slot);
      } catch {
        // The authenticated page remains usable; a later tick may retry the same idempotent slot.
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), 15_000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, []);
  return null;
}
