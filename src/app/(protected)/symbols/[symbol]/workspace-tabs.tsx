"use client";

import { useState, type ReactNode } from "react";

type Tab = "history" | "audit" | "review";

export function WorkspaceTabs({
  history,
  audit,
  review,
  initialTab = "history",
}: {
  history: ReactNode;
  audit: ReactNode;
  review: ReactNode;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const panels = { history, audit, review };
  const selectTab = (value: Tab) => {
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };
  return (
    <section className="workspace-tabs">
      <div className="tab-list" role="tablist" aria-label="Symbol workspace sections">
        {(["history", "audit", "review"] as Tab[]).map((value) => (
          <button
            aria-controls={`panel-${value}`}
            aria-selected={tab === value}
            id={`tab-${value}`}
            key={value}
            onClick={() => selectTab(value)}
            role="tab"
            type="button"
          >
            {value === "audit" ? "Audit & inputs" : value[0]!.toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <div aria-labelledby={`tab-${tab}`} id={`panel-${tab}`} role="tabpanel">{panels[tab]}</div>
    </section>
  );
}
