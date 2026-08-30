"use client";

import { useEffect } from "react";

type Event = {
  id: string;
  reason: string;
  symbol: string;
  analysisId: string;
  verdict: string;
  summary: string;
  url: string;
};

export function NotificationBridge() {
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const response = await fetch("/api/notification-events", { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const { events } = (await response.json()) as { events: Event[] };
      for (const event of events) {
        const notification = new Notification(`${event.symbol} · ${event.verdict}`, {
          body: event.summary,
          tag: event.id,
        });
        notification.onclick = () => {
          window.focus();
          window.location.assign(event.url);
          notification.close();
        };
        await fetch("/api/notification-events", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: event.id, state: "delivered" }),
        });
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 15_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);
  return null;
}
