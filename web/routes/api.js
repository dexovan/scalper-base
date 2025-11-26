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

/* ---------------------------------------------------------
   GET /api/scalp-scanner – Scalp Scanner signals & stats
--------------------------------------------------------- */
router.get("/scalp-scanner", (req, res) => {
  try {
    const signalsFile = path.join(paths.DATA_DIR, 'signals.json');

    // Check if signals file exists
    if (!fs.existsSync(signalsFile)) {
      return res.json({
        ok: true,
        signals: [],
        topCandidates: [],
        stats: {
          totalScanned: 0,
          signalsFound: 0
        },
        filterStats: {},
        lastScan: null,
        message: "No signals file found - scanner hasn't run yet"
      });
    }

    // Read signals file
    const data = fs.readFileSync(signalsFile, 'utf-8');
    let signals = [];

    try {
      // Try parsing as single JSON object first (new format)
      const parsed = JSON.parse(data);
      if (parsed.signals && Array.isArray(parsed.signals)) {
        signals = parsed.signals;
      }
    } catch (e) {
      // Fallback: try parsing as newline-delimited JSON (old format)
      const lines = data.trim().split('\n').filter(line => line.trim());
      signals = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (err) {
          return null;
        }
      }).filter(Boolean);
    }

    if (signals.length === 0) {
      return res.json({
        ok: true,
        signals: [],
        topCandidates: [],
        stats: {
          totalScanned: 0,
          signalsFound: 0
        },
        filterStats: {},
        lastScan: null,
        message: "No signals detected yet"
      });
    }

    // Normalize signal format and extract metrics
    signals = signals.map(signal => {
      // Extract nested candle and live data if present
      const volatility = signal.candle?.volatility ?? signal.volatility ?? 0;
      const volumeSpike = signal.candle?.volumeSpike ?? signal.volumeSpike ?? 0;
      const velocity = Math.abs(signal.candle?.velocity ?? signal.velocity ?? 0); // Use absolute value!
      const momentum = Math.abs(signal.candle?.priceChange1m ?? signal.momentum ?? 0);
      const imbalance = signal.live?.imbalance ?? signal.imbalance ?? 1.0;
      const spread = signal.live?.spread ?? signal.spread ?? 0;

      return {
        symbol: signal.symbol,
        side: signal.direction || signal.side || 'LONG',
        confidence: parseFloat(signal.confidence) || 0,
        timestamp: signal.timestamp,
        entry: signal.entry || signal.live?.price || 0,

        // Entry Zone (NEW)
        entryZone: signal.entryZone ? {
          min: signal.entryZone.min,
          ideal: signal.entryZone.ideal,
          max: signal.entryZone.max,
          display: signal.entryZone.display
        } : null,

        // Entry Status (NEW)
        entryStatus: signal.entryStatus ? {
          inZone: signal.entryStatus.inZone,
          distancePercent: signal.entryStatus.distancePercent || 0,
          direction: signal.entryStatus.direction || 'UNKNOWN'
        } : null,

        takeProfit: parseFloat(signal.tp) || 0,
        stopLoss: parseFloat(signal.sl) || 0,
        expectedProfit: signal.expectedProfit || 0,
        volatility,
        volumeSpike,
        velocity,
        momentum,
        imbalance,
        spread,

        // Live data for display
        live: signal.live ? {
          price: signal.live.price,
          bid: signal.live.bid,
          ask: signal.live.ask,
          orderFlowNet60s: signal.live.orderFlowNet60s
        } : null
      };
    }).reverse(); // Most recent first

    // Get latest scan metadata
    const lastSignal = signals[0];
    const lastScan = lastSignal?.timestamp || null;

    // Calculate stats from recent signals (last hour)
    const oneHourAgo = Date.now() - 3600000;
    const recentSignals = signals.filter(s => new Date(s.timestamp).getTime() > oneHourAgo);

    // Filter stats - count symbols passing each filter (use absolute values for directional metrics)
    const filterStats = {
      volatility: 0,
      volumeSpike: 0,
      velocity: 0,
      momentum: 0,
      imbalance: 0,
      spread: 0
    };

    recentSignals.forEach(signal => {
      if (signal.volatility >= 0.15) filterStats.volatility++;
      if (signal.volumeSpike >= 1.5) filterStats.volumeSpike++;
      if (signal.velocity >= 0.03) filterStats.velocity++; // Already absolute from normalization
      if (signal.momentum >= 0.1) filterStats.momentum++;
      if (signal.imbalance >= 1.5) filterStats.imbalance++;
      if (signal.spread <= 0.1) filterStats.spread++;
    });

    // Get top candidates (4-5 filters passing)
    const topCandidates = recentSignals.filter(signal => {
      const passCount = [
        signal.volatility >= 0.15,
        signal.volumeSpike >= 1.5,
        signal.velocity >= 0.03,
        signal.momentum >= 0.1,
        signal.imbalance >= 1.5,
        signal.spread <= 0.1
      ].filter(Boolean).length;
      return passCount >= 4 && passCount < 6;
    }).slice(0, 10);

    // Stats
    const stats = {
      totalScanned: 300, // From tracked symbols
      signalsFound: recentSignals.length
    };

    return res.json({
      ok: true,
      signals: recentSignals.filter(s => {
        // Only show signals that pass ALL 6 filters
        return s.volatility >= 0.15 &&
               s.volumeSpike >= 1.5 &&
               s.velocity >= 0.03 &&
               s.momentum >= 0.1 &&
               s.imbalance >= 1.5 &&
               s.spread <= 0.1;
      }),
      topCandidates,
      stats,
      filterStats,
      lastScan
    });

  } catch (error) {
    console.error('[API] Error reading scalp-scanner data:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* ---------------------------------------------------------
   POST /api/scalp-scanner/clear – Clear signals file
--------------------------------------------------------- */
router.post("/scalp-scanner/clear", (req, res) => {
  try {
    const signalsFile = path.join(paths.DATA_DIR, 'signals.json');

    if (fs.existsSync(signalsFile)) {
      fs.unlinkSync(signalsFile);
    }

    return res.json({
      ok: true,
      message: "Signals cleared"
    });

  } catch (error) {
    console.error('[API] Error clearing signals:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* ---------------------------------------------------------
   GET /api/execution/positions – Get active trading positions
--------------------------------------------------------- */
router.get("/execution/positions", async (req, res) => {
  try {
    // Fetch from Engine API
    const response = await fetch('http://localhost:8090/api/positions');
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error('[API] Error fetching positions:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* ---------------------------------------------------------
   GET /api/execution/stats – Get execution statistics
--------------------------------------------------------- */
router.get("/execution/stats", (req, res) => {
  try {
    const executionLogFile = path.join(paths.DATA_DIR, 'execution_history.json');

    // Check if execution log exists
    if (!fs.existsSync(executionLogFile)) {
      return res.json({
        ok: true,
        stats: {
          totalExecutions: 0,
          successfulExecutions: 0,
          failedExecutions: 0,
          dryRunExecutions: 0,
          successRate: 0
        },
        recentTrades: []
      });
    }

    // Read execution log
    const data = fs.readFileSync(executionLogFile, 'utf-8');
    const lines = data.trim().split('\n').filter(line => line.trim());
    const executions = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (err) {
        return null;
      }
    }).filter(Boolean);

    // Calculate stats
    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter(e => e.success).length;
    const failedExecutions = executions.filter(e => !e.success).length;
    const dryRunExecutions = executions.filter(e => e.dryRun).length;
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions * 100) : 0;

    // Get recent trades (last 20)
    const recentTrades = executions
      .slice(-20)
      .reverse()
      .map(e => ({
        symbol: e.symbol,
        direction: e.direction,
        entry: e.entry,
        tp: e.tp,
        sl: e.sl,
        success: e.success,
        dryRun: e.dryRun,
        orderId: e.orderId,
        timestamp: e.timestamp,
        error: e.error
      }));

    res.json({
      ok: true,
      stats: {
        totalExecutions,
        successfulExecutions,
        failedExecutions,
        dryRunExecutions,
        successRate: successRate.toFixed(2)
      },
      recentTrades
    });

  } catch (error) {
    console.error('[API] Error fetching execution stats:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;


