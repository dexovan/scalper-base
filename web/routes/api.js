// web/routes/api.js
import express from "express";
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import paths from "../../src/config/paths.js";

import HealthStatus, {
  updateHealth,
  getHealthSummary,
  getServiceStatus
} from "../../src/monitoring/health.js";

import metrics from "../../src/core/metrics.js";
import { getOrderbookSummary, getRecentTrades, getCandles } from "../../src/microstructure/OrderbookManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/* ---------------------------------------------------------
   GET /api/engine/health – Proxy to engine microstructure health
--------------------------------------------------------- */
router.get("/engine/health", (req, res) => {
  // Proxy request to engine process on port 8090 using native http module
  const options = {
    hostname: 'localhost',
    port: 8090,
    path: '/api/microstructure/health',
    method: 'GET',
    timeout: 5000
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let data = '';

    proxyRes.on('data', (chunk) => {
      data += chunk;
    });

    proxyRes.on('end', () => {
      try {
        const jsonData = JSON.parse(data);
        res.json(jsonData);
      } catch (error) {
        console.error('[API] Failed to parse engine response:', error.message);
        res.status(500).json({
          ok: false,
          error: 'Invalid response from engine',
          message: error.message
        });
      }
    });
  });

  proxyReq.on('error', (error) => {
    console.error('[API] Failed to connect to engine:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to connect to engine',
      message: error.message
    });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({
      ok: false,
      error: 'Engine request timeout'
    });
  });

  proxyReq.end();
});

/* ---------------------------------------------------------
   GET /api/stats – Live system statistics
--------------------------------------------------------- */
router.get("/stats", (req, res) => {
  try {
    // Read stats from file written by engine process
    const fs = require('fs');
    const path = require('path');
    const statsPath = path.join(process.cwd(), 'data', 'stats.json');

    let orderbookStats = { activeSymbols: 0, totalOrderbookUpdates: 0, totalTradeUpdates: 0 };

    // Try to read from file if it exists
    if (fs.existsSync(statsPath)) {
      try {
        const rawData = fs.readFileSync(statsPath, 'utf8');
        orderbookStats = JSON.parse(rawData);
      } catch (err) {
        console.error('[API] Failed to read stats.json:', err.message);
      }
    }

    const engineMetrics = metrics.getSummary();

    // Calculate event rate (updates per second)
    const eventsPerSecond = orderbookStats.activeSymbols * 2; // ~2 updates/sec per symbol

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        activeSymbols: orderbookStats.activeSymbols,
        eventsPerSecond,
        eventsPerMinute: eventsPerSecond * 60,
        totalOrderbookUpdates: orderbookStats.totalOrderbookUpdates,
        totalTradeUpdates: orderbookStats.totalTradeUpdates,
        uptime: engineMetrics.uptime,
        decisionCount: engineMetrics.decisionCount,
        ordersSent: engineMetrics.ordersSent,
        tradesExecuted: engineMetrics.tradesExecuted,
        memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stats",
      error: error.message
    });
  }
});

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

/* ---------------------------------------------------------
   GET /api/symbol/:symbol/orderbook – Real orderbook data
--------------------------------------------------------- */
router.get("/symbol/:symbol/orderbook", async (req, res) => {
  try {
    const { symbol } = req.params;
    const depth = parseInt(req.query.depth) || 10;

    const orderbook = getOrderbookSummary(symbol, depth);

    if (!orderbook || !orderbook.bids || !orderbook.asks) {
      return res.json({
        success: false,
        message: `No orderbook data available for ${symbol}`
      });
    }

    return res.json({
      success: true,
      data: orderbook
    });
  } catch (error) {
    console.error(`Error fetching orderbook for ${req.params.symbol}:`, error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch orderbook",
      error: error.message
    });
  }
});

/* ---------------------------------------------------------
   GET /api/symbol/:symbol/trades – Recent trades
--------------------------------------------------------- */
router.get("/symbol/:symbol/trades", async (req, res) => {
  try {
    const { symbol } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    // Proxy to engine API (port 8090) - Dashboard and Engine are separate processes!
    const options = {
      hostname: 'localhost',
      port: 8090,
      path: `/api/symbol/${symbol}/trades?limit=${limit}`,
      method: 'GET',
      timeout: 5000
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        try {
          console.log(`[PROXY] Engine response status: ${proxyRes.statusCode}, data length: ${data.length}`);
          const jsonData = JSON.parse(data);
          console.log(`[PROXY] Parsed trades: ${jsonData.trades?.length || 0} items`);
          const response = {
            success: jsonData.ok || false,
            data: jsonData.trades || []
          };
          console.log(`[PROXY] Sending to browser:`, response);
          res.json(response);
        } catch (error) {
          console.error(`[API] Failed to parse engine trades response:`, error.message);
          console.error(`[API] Raw data:`, data.substring(0, 200));
          res.status(500).json({
            success: false,
            message: "Failed to parse engine response",
            error: error.message
          });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error(`[API] Engine proxy error for trades:`, error.message);
      res.status(500).json({
        success: false,
        message: "Engine API unavailable",
        error: error.message
      });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({
        success: false,
        message: "Engine API timeout"
      });
    });

    proxyReq.end();

  } catch (error) {
    console.error(`Error fetching trades for ${req.params.symbol}:`, error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch trades",
      error: error.message
    });
  }
});

/* ---------------------------------------------------------
   GET /api/symbol/:symbol/candles/:timeframe – Candle data
--------------------------------------------------------- */
router.get("/symbol/:symbol/candles/:timeframe", async (req, res) => {
  try {
    const { symbol, timeframe } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    // Proxy to engine API (port 8090) - Dashboard and Engine are separate processes!
    const options = {
      hostname: 'localhost',
      port: 8090,
      path: `/api/symbol/${symbol}/candles/${timeframe}?limit=${limit}`,
      method: 'GET',
      timeout: 5000
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          res.json(jsonData);
        } catch (error) {
          console.error(`[API] Failed to parse engine candles response:`, error.message);
          res.status(500).json({
            ok: false,
            message: "Failed to parse engine response",
            error: error.message
          });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error(`[API] Engine proxy error for candles:`, error.message);
      res.status(500).json({
        ok: false,
        message: "Engine API unavailable",
        error: error.message
      });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({
        ok: false,
        message: "Engine API timeout"
      });
    });

    proxyReq.end();

  } catch (error) {
    console.error(`Error fetching candles for ${req.params.symbol}:`, error);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch candles",
      error: error.message
    });
  }
});

export default router;

