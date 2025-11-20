// web/routes/monitor.js
import express from "express";
import { fetchMonitorSummary } from "../core/metrics.js";

const router = express.Router();

// GET /monitor – render stranice
router.get("/", (req, res) => {
  res.render("monitor/index", {
    title: "System Monitor",
  });
});

// GET /monitor/api/summary – proxy ka engine monitor API-ju
router.get("/api/summary", async (req, res) => {
  try {
    const data = await fetchMonitorSummary();

    if (data?.error) {
      return res.status(502).json({
        ok: false,
        source: "engine",
        error: data.message || "Engine monitor unavailable",
      });
    }

    res.json(data);
  } catch (err) {
    console.error("❌ [MONITOR] API route error:", err);
    res.status(500).json({
      ok: false,
      error: "Monitor API internal error",
    });
  }
});

export default router;
