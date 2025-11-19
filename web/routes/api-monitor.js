// web/routes/api-monitor.js
import express from "express";
import os from "os";
import { getWsStatus } from "../../src/connectors/bybitPublic.js";

const router = express.Router();

/**
 * Helper – formatiranje brojeva
 */
function toMB(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

/**
 * GET /api/monitor/summary
 * Glavni endpoint za monitoring panel
 */
router.get("/summary", (req, res) => {
  try {
    // 📌 System info
    const uptimeSec = process.uptime();
    const loadAvg = os.loadavg?.()[0] ?? null;
    const mem = process.memoryUsage();

    // 📌 WS status (Bybit public WS)
    let wsStatus = null;
    try {
      wsStatus = getWsStatus();
    } catch (e) {
      wsStatus = { ok: false, error: "getWsStatus() not available" };
    }

    const summary = {
      system: {
        uptimeSeconds: Math.round(uptimeSec),
        uptimeHuman: `${Math.floor(uptimeSec / 3600)}h ${Math.floor(
          (uptimeSec % 3600) / 60
        )}m`,
        load1m: loadAvg,
        memory: {
          rssMB: toMB(mem.rss),
          heapUsedMB: toMB(mem.heapUsed),
          heapTotalMB: toMB(mem.heapTotal),
        },
      },

      ws: wsStatus || null,

      engine: {
        // Za sada placeholder – kasnije ćemo vezati na pravi engine status
        status: "running",
        mode: "scalper-core",
      },

      timestamp: new Date().toISOString(),
    };

    res.json(summary);
  } catch (err) {
    console.error("[MONITOR] summary error:", err);
    res.status(500).json({ error: "Monitor summary failed" });
  }
});

export default router;
