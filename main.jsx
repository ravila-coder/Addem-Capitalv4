import React from "react";
import { createRoot } from "react-dom/client";

const ENDPOINT = "/api/data";

/* Boot: fetch live data from the Netlify function (which reads the Google Sheet),
   then render. If unavailable, the dashboard renders with bundled sample data. */
async function fetchData() {
  const r = await fetch(ENDPOINT, { cache: "no-store" });
  if (!r.ok) throw new Error("data endpoint " + r.status);
  return r.json();
}

async function boot() {
  let version = null;
  try {
    const d = await fetchData();
    if (d && (d.model || d.portfolio || d.origination)) { window.__ADDEM_DATA__ = d; version = d.version; }
  } catch (e) {
    console.warn("Live data unavailable — using bundled sample.", e);
  }
  const { default: App } = await import("./App.jsx");
  createRoot(document.getElementById("root")).render(React.createElement(App));

  /* Auto-refresh: poll the Sheet-backed endpoint; when the data changes,
     reload so every KPI, chart, statement and portfolio view updates. */
  const check = async () => {
    try {
      const d = await fetchData();
      if (d && d.version && version && d.version !== version) window.location.reload();
      if (d && d.version) version = version || d.version;
    } catch (_) { /* ignore transient errors */ }
  };
  setInterval(check, 60 * 1000); // every minute
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}
boot();
