// ============================================================
// src/http/monitorApi.js
// ENGINE-API (LIVE METRICS + LIVE LOG VIEWER)
// ============================================================

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import metrics from "../core/metrics.js";
import wsMetrics from "../monitoring/wsMetrics.js";

// PM2 LOG FILE PATHS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.resolve(__dirname, "../../logs");
const ENGINE_OUT = path.join(LOG_DIR, "pm2-engine-out.log");
const ENGINE_ERR = path.join(LOG_DIR, "pm2-engine-error.log");

// ============================================================
// Helper — safe tail reader
// ============================================================
function tailLines(filePath, maxLines = 200) {
  try {
    if (!fs.existsSync(filePath)) return [];

    const data = fs.readFileSync(filePath, "utf8");
    const lines = data.split("\n");

    return lines.slice(-maxLines);
  } catch (err) {
    return ["<log read error>", err.message];
  }
}

// ============================================================
// START ENGINE API SERVER
// ============================================================
export function startMonitorApiServer(port = 8090) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ============================================================
  // GET /api/monitor/summary
  // ============================================================
  app.get("/api/monitor/summary", (req, res) => {
    return res.json({
      timestamp: new Date().toISOString(),

      engine: metrics.getSummary(),
      ws: wsMetrics.getSummary(),

      system: {
        uptime: process.uptime(),
        rss: process.memoryUsage().rss,
        heap: process.memoryUsage().heapUsed,
      },
    });
  });

  // ============================================================
  // GET /api/monitor/logs?lines=200
  // ============================================================
  app.get("/api/monitor/logs", (req, res) => {
    const lines = parseInt(req.query.lines || "200", 10);

    const outLines = tailLines(ENGINE_OUT, lines);
    const errLines = tailLines(ENGINE_ERR, lines);

    return res.json({
      ok: true,
      lines: [
        "===== ENGINE STDOUT =====",
        ...outLines,
        "",
        "===== ENGINE ERROR =====",
        ...errLines,
      ],
    });
  });

  // ============================================================
  // START SERVER
  // ============================================================
  app.listen(port, "0.0.0.0", () => {
    console.log("🚀 DEBUG: Monitor API successfully started");
    console.log(`🟢 ENGINE-API running on port ${port}`);
    console.log(`➡️  http://localhost:${port}/api/monitor/summary`);
  });
}
