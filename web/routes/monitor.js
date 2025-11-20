import express from "express";
import metrics from "../core/metrics.js";
import { getWsSummary } from "../monitoring/wsMetrics.js";

const router = express.Router();

function getSystemMetrics() {
  return {
    uptime: process.uptime(),
    rss: process.memoryUsage().rss,
    heap: process.memoryUsage().heapUsed,
  };
}

router.get("/summary", (req, res) => {
  res.json({
    engine: metrics.getSummary(),
    system: getSystemMetrics(),
    ws: getWsSummary()
  });
});

export default router;
