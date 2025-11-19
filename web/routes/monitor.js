// web/routes/monitor.js
import express from "express";
import { requireAuth } from "../auth/middleware.js";
import { getMonitorSummary } from "../../src/monitoring/metricsTracker.js";

const router = express.Router();

/**
 * HTML monitoring panel (/monitor)
 */
router.get("/monitor", requireAuth, (req, res) => {
  const summary = getMonitorSummary();
  res.render("monitor", {
    title: "System Monitor",
    summary,
  });
});

/**
 * JSON API summary (/api/monitor/summary)
 * Pogodno za debug, future frontend, itd.
 */
router.get("/api/monitor/summary", requireAuth, (req, res) => {
  const summary = getMonitorSummary();
  res.json(summary);
});

export default router;
