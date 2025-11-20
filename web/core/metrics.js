// web/core/metrics.js
// Proxy ka ENGINE monitor API-ju (port 8090)

const MONITOR_URL =
  process.env.MONITOR_API_URL || "http://localhost:8090/api/monitor/summary";

export async function fetchMonitorSummary() {
  try {
    const res = await fetch(MONITOR_URL, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`Monitor API HTTP ${res.status}`);
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error("❌ [MONITOR] Error calling engine monitor API:", err.message);
    return {
      error: true,
      message: err.message,
    };
  }
}
