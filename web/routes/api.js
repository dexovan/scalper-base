// web/routes/api.js
import express from "express";
import fs from "fs";
import path from "path";
import paths from "../../src/config/paths.js";
import HealthStatus, {
  updateHealth,
  getHealthSummary,
  getServiceStatus
} from "../../src/monitoring/health.js";

import metrics from '../../src/core/metrics.js';

const router = express.Router();

/* ---------------------------------------------------------
   GET /api/health – Full health check
--------------------------------------------------------- */
router.get("/health", (req, res) => {
  try {
    const status = updateHealth();
    return res.json({
      timestamp: new Date().toISOString(),
      status: "success",
      data: status
    });
  } catch (error) {
    return res.status(500).json({
      timestamp: new Date().toISOString(),
      status: "error",
      message: "Health check failed",
      error: error.message
    });
  }
});

/* ---------------------------------------------------------
   GET /api/health/summary – Overview
--------------------------------------------------------- */
router.get("/health/summary", (req, res) => {
  try {
    const summary = getHealthSummary();
    return res.json({
      timestamp: new Date().toISOString(),
      status: "success",
      data: {
        summary,
        uptime: process.uptime(),
        mode: HealthStatus.mode
      }
    });
  } catch (error) {
    return res.status(500).json({
      timestamp: new Date().toISOString(),
      status: "error",
      message: "Health summary failed",
      error: error.message
    });
  }
});

/* ---------------------------------------------------------
   GET /api/health/services – List of services
--------------------------------------------------------- */
router.get("/health/services", (req, res) => {
  try {
    return res.json({
      timestamp: new Date().toISOString(),
      status: "success",
      data: HealthStatus.services
    });
  } catch (error) {
    return res.status(500).json({
      timestamp: new Date().toISOString(),
      status: "error",
      message: "Services status failed",
      error: error.message
    });
  }
});

/* ---------------------------------------------------------
   GET /api/health/services/:serviceName
--------------------------------------------------------- */
router.get("/health/services/:serviceName", (req, res) => {
  try {
    const s = getServiceStatus(req.params.serviceName);
    if (!s) {
      return res.status(404).json({
        timestamp: new Date().toISOString(),
        status: "error",
        message: `Service '${req.params.serviceName}' not found`
      });
    }

    return res.json({
      timestamp: new Date().toISOString(),
      status: "success",
      data: { ...s }
    });
  } catch (error) {
    return res.status(500).json({
      timestamp: new Date().toISOString(),
      status: "error",
      message: "Service status failed",
      error: error.message
    });
  }
});

// ---------------------------------------------------------
// MONITOR SUMMARY — engine metrics + system info
// ---------------------------------------------------------
router.get('/monitor/summary', async (req, res) => {
    res.json({
        engine: metrics.getSummary(),
        system: {
            uptime: process.uptime(),
            rss: process.memoryUsage().rss,
            heap: process.memoryUsage().heapUsed
        },
        ws: global.WS_STATUS || 'unknown'
    });
});

// ---------------------------------------------------------
// MONITOR LOGS — poslednje linije iz pm2-engine-out.log
// ---------------------------------------------------------
router.get("/monitor/logs", (req, res) => {
  const lines = parseInt(req.query.lines, 10) || 200;
  const logFile = path.join(paths.PROJECT_ROOT, "logs", "pm2-engine-out.log");

  fs.readFile(logFile, "utf8", (err, text) => {
    if (err) {
      return res.json({
        ok: false,
        error: err.message,
        lines: [],
      });
    }

    const allLines = text.split("\n");
    const tail = allLines.slice(-lines);

    res.json({
      ok: true,
      file: "pm2-engine-out.log",
      lines: tail,
    });
  });
});

export default router;
