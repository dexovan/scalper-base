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
import { getStorageStats } from "../utils/dataStorage.js";
import {
  getUniverseSnapshot,
  getUniverseStats,
  getSymbolMeta,
  getSymbolsByCategory
} from "../market/universe_v2.js";

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
// GLOBAL STATE FOR REAL-TIME DATA
// ============================================================
let latestTickers = new Map(); // symbol -> ticker data
let recentTrades = []; // last 100 trades
const MAX_RECENT_TRADES = 100;

// Listen to bybitPublic events for real-time data
export function attachRealtimeListeners(bybitPublic) {
  console.log("🔗 attachRealtimeListeners: Setting up event listeners");

  bybitPublic.on('event', (eventData) => {
    console.log("📡 MonitorAPI received event:", eventData?.type, eventData?.symbol);
    const { type, symbol, payload } = eventData;

    if (type === 'ticker') {
      console.log("📊 Processing ticker for", symbol, "payload:", JSON.stringify(payload, null, 2));

      // Try different possible price fields from Bybit ticker
      let price = null;
      if (payload.lastPrice) price = parseFloat(payload.lastPrice);
      else if (payload.price) price = parseFloat(payload.price);
      else if (payload.c) price = parseFloat(payload.c); // Bybit sometimes uses 'c' for close price

      console.log("🔍 Price extraction:", {
        lastPrice: payload.lastPrice,
        price: payload.price,
        c: payload.c,
        finalPrice: price
      });      let change24h = null;
      if (payload.price24hPcnt) change24h = parseFloat(payload.price24hPcnt);
      else if (payload.priceChangePercent) change24h = parseFloat(payload.priceChangePercent);

      let volume24h = null;
      if (payload.volume24h) volume24h = parseFloat(payload.volume24h);
      else if (payload.turnover24h) volume24h = parseFloat(payload.turnover24h);
      else if (payload.v) volume24h = parseFloat(payload.v);

      const tickerData = {
        symbol,
        price,
        change24h,
        volume24h,
        timestamp: new Date().toISOString()
      };

      latestTickers.set(symbol, tickerData);
      console.log("💾 Stored ticker for", symbol, "price:", price, "total tickers:", latestTickers.size);
    }    if (type === 'trade') {
      const trade = {
        symbol,
        side: payload.S,
        price: parseFloat(payload.p),
        quantity: parseFloat(payload.v),
        timestamp: new Date().toISOString(),
        tickDirection: payload.L
      };

      recentTrades.unshift(trade);
      if (recentTrades.length > MAX_RECENT_TRADES) {
        recentTrades = recentTrades.slice(0, MAX_RECENT_TRADES);
      }
    }
  });
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
  // GET /api/monitor/tickers - Real-time ticker data
  // ============================================================
  app.get("/api/monitor/tickers", (req, res) => {
    const tickerArray = Array.from(latestTickers.values());
    return res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      tickers: tickerArray
    });
  });

  // ============================================================
  // GET /api/monitor/trades - Recent trade data
  // ============================================================
  app.get("/api/monitor/trades", (req, res) => {
    const limit = parseInt(req.query.limit || "50", 10);
    const limitedTrades = recentTrades.slice(0, Math.min(limit, MAX_RECENT_TRADES));

    return res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      trades: limitedTrades,
      total: recentTrades.length
    });
  });

  // ============================================================
  // GET /api/monitor/storage - Storage statistics
  // ============================================================
  app.get("/api/monitor/storage", async (req, res) => {
    try {
      const stats = await getStorageStats();
      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        storage: stats
      });
    } catch (error) {
      return res.json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // GET /api/monitor/universe - Universe overview with stats
  // ============================================================
  app.get("/api/monitor/universe", async (req, res) => {
    try {
      const universe = getUniverseSnapshot();
      const stats = getUniverseStats();

      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        universe: {
          fetchedAt: universe.fetchedAt,
          stats: stats,
          symbolCount: {
            total: stats.totalSymbols,
            prime: stats.primeCount,
            normal: stats.normalCount,
            wild: stats.wildCount
          }
        }
      });
    } catch (error) {
      return res.json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // GET /api/monitor/symbols/:category - Symbols by category (Prime/Normal/Wild)
  // ============================================================
  app.get("/api/monitor/symbols/:category", async (req, res) => {
    try {
      const { category } = req.params;
      const limit = parseInt(req.query.limit || "50", 10);

      const symbols = getSymbolsByCategory(category);

      // Enrich symbols with real-time ticker data
      const enrichedSymbols = symbols.map(symbolMeta => {
        const ticker = latestTickers.get(symbolMeta.symbol);
        return {
          ...symbolMeta,
          // Add real-time market data if available
          currentPrice: ticker?.price || null,
          change24h: ticker?.change24h || null,
          volume24h: ticker?.volume24h || null,
          priceTimestamp: ticker?.timestamp || null
        };
      });

      const limitedSymbols = enrichedSymbols.slice(0, limit);

      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        category: category,
        symbols: limitedSymbols,
        total: symbols.length,
        returned: limitedSymbols.length
      });
    } catch (error) {
      return res.json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // GET /api/monitor/symbol/:symbol - Individual symbol details
  // ============================================================
  app.get("/api/monitor/symbol/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const symbolMeta = getSymbolMeta(symbol);

      if (!symbolMeta) {
        return res.status(404).json({
          ok: false,
          error: `Symbol '${symbol}' not found`,
          timestamp: new Date().toISOString()
        });
      }

      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        symbol: symbolMeta
      });
    } catch (error) {
      return res.json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // GET /api/symbols - All symbols (simplified endpoint for dashboard)
  // ============================================================
  app.get("/api/symbols", async (req, res) => {
    try {
      const allSymbols = await getSymbolsByCategory('All');

      return res.json({
        ok: true,
        symbols: allSymbols, // Array format that dashboard expects
        count: allSymbols.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [API] Error fetching symbols:", error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // GET /api/monitor/symbols - All symbols (monitor API version)
  // ============================================================
  app.get("/api/monitor/symbols", async (req, res) => {
    try {
      const allSymbols = await getSymbolsByCategory('All');

      // Enrich symbols with real-time ticker data
      const enrichedSymbols = allSymbols.map(symbolMeta => {
        const symbolName = typeof symbolMeta === 'string' ? symbolMeta : symbolMeta.symbol;
        const ticker = latestTickers.get(symbolName);

        return {
          ...symbolMeta,
          // Add real-time market data if available
          currentPrice: ticker?.price || null,
          change24h: ticker?.change24h || null,
          volume24h: ticker?.volume24h || null,
          priceTimestamp: ticker?.timestamp || null
        };
      });

      return res.json({
        ok: true,
        symbols: enrichedSymbols,
        count: enrichedSymbols.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [API] Error fetching symbols:", error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });  // ============================================================
  // POST /api/monitor/refresh-ws - Refresh WebSocket subscription
  // ============================================================
  app.post("/api/monitor/refresh-ws", async (req, res) => {
    try {
      const { refreshWebSocketSubscription } = await import("../connectors/bybitPublic.js");

      console.log("🔄 [API] Refreshing WebSocket subscription requested...");
      await refreshWebSocketSubscription();

      return res.json({
        ok: true,
        message: "WebSocket subscription refreshed successfully",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [API] Error refreshing WebSocket:", error.message);
      return res.json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
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
