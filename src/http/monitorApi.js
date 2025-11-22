// ============================================================
// src/http/monitorApi.js
// ENGINE-API (LIVE METRICS + LIVE LOG VIEWER)
// ============================================================

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

import metrics from "../core/metrics.js";
import wsMetrics from "../monitoring/wsMetrics.js";
import { getStorageStats } from "../utils/dataStorage.js";
import {
  getUniverseSnapshot,
  getUniverseStats,
  getSymbolMeta,
  getSymbolsByCategory
} from "../market/universe_v2.js";
import * as OrderbookManager from "../microstructure/OrderbookManager.js";
import FeatureEngine from "../features/featureEngine.js";

// PM2 LOG FILE PATHS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.resolve(__dirname, "../../logs");
const ENGINE_OUT = path.join(LOG_DIR, "pm2-engine-out.log");
const ENGINE_ERR = path.join(LOG_DIR, "pm2-engine-error.log");

// ============================================================
// Helper — safe tail reader for large files
// ============================================================
function tailLines(filePath, maxLines = 200) {
  try {
    if (!fs.existsSync(filePath)) return [];

    // Check file size first
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    // If file is larger than 50MB, use more efficient approach
    if (fileSizeMB > 50) {
      try {
        const result = execSync(`tail -n ${maxLines} "${filePath}"`, {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 10 // 10MB buffer max
        });
        return result.split('\n').filter(line => line.trim());
      } catch (execErr) {
        return [`<large file - using tail command failed>`, `File size: ${fileSizeMB.toFixed(1)}MB`, execErr.message];
      }
    }    // For smaller files, use the original method
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
      else if (payload.indexPrice) price = parseFloat(payload.indexPrice); // Bybit index price
      else if (payload.markPrice) price = parseFloat(payload.markPrice); // Bybit mark price
      else if (payload.bid1Price && payload.ask1Price) {
        // Use mid-price between bid and ask
        const bid = parseFloat(payload.bid1Price);
        const ask = parseFloat(payload.ask1Price);
        price = (bid + ask) / 2;
      } else if (payload.bid1Price) price = parseFloat(payload.bid1Price);
      else if (payload.ask1Price) price = parseFloat(payload.ask1Price);

      console.log("🔍 Price extraction:", {
        lastPrice: payload.lastPrice,
        price: payload.price,
        c: payload.c,
        indexPrice: payload.indexPrice,
        markPrice: payload.markPrice,
        bid1Price: payload.bid1Price,
        ask1Price: payload.ask1Price,
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
// FETCH 24H DATA FROM BYBIT REST API
// ============================================================
let ticker24hInterval = null;

async function fetch24hData() {
  try {
    console.log("📊 Fetching 24h ticker data from Bybit REST API...");
    const url = "https://api.bybit.com/v5/market/tickers?category=linear";
    const response = await fetch(url);
    const json = await response.json();

    if (!json || !json.result || !Array.isArray(json.result.list)) {
      console.error("❌ Failed to fetch 24h data:", json);
      return;
    }

    const tickers = json.result.list;
    let updatedCount = 0;

    for (const ticker of tickers) {
      const symbol = ticker.symbol;
      const existing = latestTickers.get(symbol);

      // Parse 24h data
      const change24h = ticker.price24hPcnt ? parseFloat(ticker.price24hPcnt) : null;
      const volume24h = ticker.volume24h ? parseFloat(ticker.volume24h) :
                        ticker.turnover24h ? parseFloat(ticker.turnover24h) : null;

      if (existing) {
        // Update existing ticker with 24h data
        existing.change24h = change24h;
        existing.volume24h = volume24h;
        updatedCount++;
      } else {
        // Create new ticker entry
        const price = ticker.lastPrice ? parseFloat(ticker.lastPrice) : null;
        if (price) {
          latestTickers.set(symbol, {
            symbol,
            price,
            change24h,
            volume24h,
            timestamp: new Date().toISOString()
          });
          updatedCount++;
        }
      }
    }

    console.log(`✅ Updated 24h data for ${updatedCount} symbols (total: ${latestTickers.size})`);
  } catch (error) {
    console.error("❌ Error fetching 24h data:", error.message);
  }
}

// Start periodic 24h data refresh (every 30 seconds)
function start24hDataRefresh() {
  if (ticker24hInterval) {
    clearInterval(ticker24hInterval);
  }

  // Initial fetch
  fetch24hData();

  // Refresh every 30 seconds
  ticker24hInterval = setInterval(() => {
    fetch24hData();
  }, 30000);

  console.log("🔄 Started 24h data refresh (every 30s)");
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
  app.get("/api/monitor/summary", async (req, res) => {
    try {
      // Get universe stats
      const { getUniverseStats } = await import("../market/universe_v2.js");
      const universeStats = getUniverseStats();

      // Get WebSocket connection status from bybitPublic
      let marketDataMetrics = {
        wsConnected: false,
        lastMessageAt: null,
        reconnectAttempts: 0,
        subscribedSymbols: 0
      };

      try {
        // Try to get WS status from bybitPublic connector
        const bybitPublicModule = await import("../connectors/bybitPublic.js");
        if (bybitPublicModule.getConnectionStatus) {
          const wsStatus = bybitPublicModule.getConnectionStatus();
          marketDataMetrics = {
            wsConnected: wsStatus.connected || false,
            lastMessageAt: wsStatus.lastMessageAt || null,
            reconnectAttempts: wsStatus.reconnectAttempts || 0,
            subscribedSymbols: wsStatus.subscribedSymbols || 0
          };
        }
      } catch (error) {
        console.warn("⚠️ [SUMMARY] Could not get WS status from bybitPublic:", error.message);
      }

      return res.json({
        timestamp: new Date().toISOString(),

        engine: metrics.getSummary(),
        ws: wsMetrics.getSummary(),

        // NEW: Universe metrics
        universe: {
          totalSymbols: universeStats.totalSymbols || 0,
          primeCount: universeStats.primeCount || 0,
          normalCount: universeStats.normalCount || 0,
          wildCount: universeStats.wildCount || 0,
          lastUniverseUpdateAt: universeStats.lastUniverseUpdateAt || null
        },

        // NEW: Market data metrics
        marketData: marketDataMetrics,

        system: {
          uptime: process.uptime(),
          rss: process.memoryUsage().rss,
          heap: process.memoryUsage().heapUsed,
        },
      });

    } catch (error) {
      console.error("❌ [SUMMARY] Error generating summary:", error.message);
      return res.status(500).json({
        timestamp: new Date().toISOString(),
        error: error.message,
        engine: metrics.getSummary(),
        ws: wsMetrics.getSummary(),
        system: {
          uptime: process.uptime(),
          rss: process.memoryUsage().rss,
          heap: process.memoryUsage().heapUsed,
        },
      });
    }
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

      const symbols = await getSymbolsByCategory(category);
      console.log(`🔍 getSymbolsByCategory(${category}) returned:`, typeof symbols, Array.isArray(symbols) ? `array of ${symbols.length}` : symbols);

      // Ensure symbols is an array
      if (!Array.isArray(symbols)) {
        console.error(`❌ getSymbolsByCategory returned non-array:`, symbols);
        return res.json({
          ok: false,
          error: `Invalid symbols data for category ${category}`,
          timestamp: new Date().toISOString()
        });
      }

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
  // GET /api/symbol/:symbol/basic - Combined symbol data for Faza 3 dashboard
  // Returns: {symbol, meta from universe_v2, profile from SymbolProfile}
  // ============================================================
  app.get("/api/symbol/:symbol/basic", async (req, res) => {
    try {
      const { symbol } = req.params;

      // Import SymbolProfile functions
      const { loadProfile } = await import("../market/symbolProfile.js");

      // Get meta from universe_v2
      const symbolMeta = getSymbolMeta(symbol);

      // Get profile from SymbolProfile
      const symbolProfile = await loadProfile(symbol);

      // If symbol not found in universe, still return basic data with profile
      if (!symbolMeta) {
        return res.json({
          ok: true,
          timestamp: new Date().toISOString(),
          symbol: symbol,
          meta: null,
          profile: symbolProfile,
          warning: "Symbol not found in universe, profile data only"
        });
      }

      // Return combined data
      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        symbol: symbol,
        meta: symbolMeta,
        profile: symbolProfile
      });

    } catch (error) {
      console.error(`❌ [API] Error getting basic data for ${req.params.symbol}:`, error.message);
      return res.status(500).json({
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
      console.log(`🔍 [DEBUG] latestTickers Map size: ${latestTickers.size}`);
      console.log(`🔍 [DEBUG] Available ticker symbols: ${Array.from(latestTickers.keys()).join(', ')}`);

      const enrichedSymbols = allSymbols.map(symbolMeta => {
        const symbolName = typeof symbolMeta === 'string' ? symbolMeta : symbolMeta.symbol;
        const ticker = latestTickers.get(symbolName);

        console.log(`🔍 [DEBUG] Symbol: ${symbolName}, Ticker found: ${!!ticker}, Price: ${ticker?.price}`);

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
  // MICROSTRUCTURE ENDPOINTS (FAZA 3)
  // ============================================================

  // GET /api/symbol/:symbol/micro - Complete microstructure state
  app.get("/api/symbol/:symbol/micro", async (req, res) => {
    try {
      const { symbol } = req.params;
      const microState = OrderbookManager.getSymbolMicroState(symbol);

      if (!microState) {
        return res.json({
          ok: false,
          error: `No microstructure data for symbol: ${symbol}`,
          symbol,
          timestamp: new Date().toISOString()
        });
      }

      return res.json({
        ok: true,
        symbol,
        microState,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [API] Error fetching microstructure for ${req.params.symbol}:`, error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        symbol: req.params.symbol,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/symbol/:symbol/orderbook - Current orderbook
  app.get("/api/symbol/:symbol/orderbook", async (req, res) => {
    try {
      const { symbol } = req.params;
      const { depth = 10 } = req.query;

      const orderbookSummary = OrderbookManager.getOrderbookSummary(symbol, parseInt(depth));

      if (!orderbookSummary) {
        return res.json({
          ok: false,
          error: `No orderbook data for symbol: ${symbol}`,
          symbol,
          timestamp: new Date().toISOString()
        });
      }

      return res.json({
        ok: true,
        symbol,
        orderbook: orderbookSummary,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [API] Error fetching orderbook for ${req.params.symbol}:`, error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        symbol: req.params.symbol,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/symbol/:symbol/trades - Recent trades
  app.get("/api/symbol/:symbol/trades", async (req, res) => {
    try {
      const { symbol } = req.params;
      const { limit = 100 } = req.query;

      const recentTrades = OrderbookManager.getRecentTrades(symbol, parseInt(limit));

      return res.json({
        ok: true,
        symbol,
        trades: recentTrades,
        count: recentTrades.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [API] Error fetching trades for ${req.params.symbol}:`, error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        symbol: req.params.symbol,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/symbol/:symbol/candles/:timeframe - Micro candles
  app.get("/api/symbol/:symbol/candles/:timeframe", async (req, res) => {
    try {
      const { symbol, timeframe } = req.params;
      const { limit = 100 } = req.query;

      const candles = OrderbookManager.getCandles(symbol, timeframe, parseInt(limit));

      return res.json({
        ok: true,
        symbol,
        timeframe,
        candles,
        count: candles.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [API] Error fetching candles for ${req.params.symbol}/${req.params.timeframe}:`, error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        symbol: req.params.symbol,
        timeframe: req.params.timeframe,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/microstructure/symbols - List of active symbols with microstructure
  app.get("/api/microstructure/symbols", async (req, res) => {
    try {
      const activeSymbols = OrderbookManager.getActiveSymbols();

      const symbolsSummary = activeSymbols.map(symbol => {
        const microState = OrderbookManager.getSymbolMicroState(symbol);
        return {
          symbol,
          lastUpdateAt: microState?.lastUpdateAt,
          bestBid: microState?.priceInfo?.bestBid,
          bestAsk: microState?.priceInfo?.bestAsk,
          spread: microState?.priceInfo?.spread,
          lastPrice: microState?.priceInfo?.lastPrice,
          tradesCount: microState?.trades?.length || 0
        };
      });

      return res.json({
        ok: true,
        symbols: symbolsSummary,
        count: symbolsSummary.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [API] Error fetching microstructure symbols:", error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/microstructure/health - Microstructure system health
  app.get("/api/microstructure/health", async (req, res) => {
    try {
      const activeSymbols = OrderbookManager.getActiveSymbols();
      const now = new Date();

      let healthyCount = 0;
      let staleCount = 0;
      const staleThresholdMs = 30000; // 30 seconds

      const symbolsHealth = activeSymbols.map(symbol => {
        const microState = OrderbookManager.getSymbolMicroState(symbol);
        const lastUpdate = microState?.lastUpdateAt ? new Date(microState.lastUpdateAt) : null;
        const isStale = !lastUpdate || (now - lastUpdate) > staleThresholdMs;

        if (isStale) {
          staleCount++;
        } else {
          healthyCount++;
        }

        return {
          symbol,
          lastUpdateAt: microState?.lastUpdateAt,
          isStale,
          orderbookLevels: (microState?.orderbook?.bids?.length || 0) + (microState?.orderbook?.asks?.length || 0),
          tradesCount: microState?.trades?.length || 0
        };
      });

      const overallHealth = staleCount === 0 ? "HEALTHY" :
                           healthyCount > staleCount ? "DEGRADED" : "CRITICAL";

      return res.json({
        ok: true,
        health: {
          status: overallHealth,
          activeSymbols: activeSymbols.length,
          healthySymbols: healthyCount,
          staleSymbols: staleCount,
          staleThresholdMs
        },
        symbols: symbolsHealth,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [API] Error checking microstructure health:", error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // FAZA 4: FEATURE ENGINE API ROUTES
  // ============================================================

  // Initialize Feature Engine
  const featureEngine = new FeatureEngine();
  console.log("🔧 Feature Engine initialized for API");

  // GET /api/features/health - Feature Engine health status
  app.get("/api/features/health", async (req, res) => {
    try {
      const health = featureEngine.getHealthStatus();
      res.json({
        status: "success",
        data: health,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [FEATURES/HEALTH] Error:", error);
      res.status(500).json({
        status: "error",
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/features/config - Feature Engine configuration
  app.get("/api/features/config", async (req, res) => {
    try {
      const config = featureEngine.getConfiguration();
      res.json({
        status: "success",
        data: config,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [FEATURES/CONFIG] Error:", error);
      res.status(500).json({
        status: "error",
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/features/overview - Features analysis overview
  app.get("/api/features/overview", async (req, res) => {
    try {
      const overview = featureEngine.getFeaturesOverview();
      res.json({
        status: "success",
        data: overview,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [FEATURES/OVERVIEW] Error:", error);
      res.status(500).json({
        status: "error",
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/features/symbol/:symbol - Symbol-specific features
  app.get("/api/features/symbol/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const features = featureEngine.getFeaturesForSymbol(symbol);
      res.json({
        status: "success",
        data: features,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [FEATURES/SYMBOL/${req.params.symbol}] Error:`, error);
      res.status(500).json({
        status: "error",
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // POST /api/features/update - Trigger features update
  app.post("/api/features/update", async (req, res) => {
    try {
      const { symbol } = req.body;
      if (!symbol) {
        return res.status(400).json({
          status: "error",
          error: "Symbol is required",
          timestamp: new Date().toISOString()
        });
      }

      await featureEngine.updateFeaturesForSymbol(symbol);
      res.json({
        status: "success",
        message: `Features updated for ${symbol}`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [FEATURES/UPDATE] Error:", error);
      res.status(500).json({
        status: "error",
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

    // Start 24h data refresh
    start24hDataRefresh();
  });
}
