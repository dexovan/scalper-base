// ===============================================
// src/http/monitorApi.js
// LOCAL ENGINE API SERVER (shares memory with WS)
// ===============================================

import express from "express";
import cors from "cors";

import metrics from "../core/metrics.js";
import wsMetrics from "../monitoring/wsMetrics.js";

export function startMonitorApiServer(port = 8090) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ---------------------------------------------------
  // GET /api/monitor/summary
  // (REAL-TIME ENGINE + WS METRICS, SAME PROCESS)
  // ---------------------------------------------------
  app.get("/api/monitor/summary", (req, res) => {
    return res.json({
      engine: metrics.getSummary(),
      ws: wsMetrics.getSummary(),
      system: {
        uptime: process.uptime(),
        rss: process.memoryUsage().rss,
        heap: process.memoryUsage().heapUsed,
      },
    });
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`🟢 ENGINE-API running on port ${port}`);
    console.log(`➡️  http://localhost:${port}/api/monitor/summary`);
  });
}
