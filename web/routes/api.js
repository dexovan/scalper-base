// web/routes/api.js
import express from "express";
import fs from "fs";
import path from "path";
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

    const trades = getRecentTrades(symbol, limit);

    return res.json({
      success: true,
      data: trades || []
    });
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

    const candles = getCandles(symbol, timeframe, limit);

    return res.json({
      ok: true,
      symbol,
      timeframe,
      candles: candles || [],
      count: candles ? candles.length : 0,
      timestamp: new Date().toISOString()
    });
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

