import express from "express";
import os from "os";
import { engineMetrics } from "../../src/monitoring/engineMetrics.js";
import { wsMetrics } from "../../src/monitoring/wsMetrics.js";

const router = express.Router();

router.get("/summary", (req, res) => {
  const mem = process.memoryUsage();

  res.json({
    system: {
      uptimeSeconds: process.uptime(),
      load1m: os.loadavg()[0],
      memory: {
        rssMB: (mem.rss / 1024 / 1024).toFixed(1),
        heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
      }
    },
    ws: {
      messagesLast60s: wsMetrics.messagesLast60s
    },
    engine: {
      decisionsTotal: engineMetrics.decisionsTotal,
      decisionRate: engineMetrics.decisionRate,
      tradesExecuted: engineMetrics.tradesExecuted,
      ordersSent: engineMetrics.ordersSent,
      lastDecisionAt: engineMetrics.lastDecisionAt
    },
    timestamp: new Date().toISOString()
  });
});

export default router;
