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

// ============================================================
// PUBLIC EXPORTS
// ============================================================

// Listen to bybitPublic events for real-time data
export function attachRealtimeListeners(bybitPublic) {
  console.log("🔗 attachRealtimeListeners: Setting up event listeners");

  bybitPublic.on('event', (eventData) => {
    // FULLY DISABLED: Console spam (50,000+ logs/second = GIGABYTES!)
    // console.log("📡 MonitorAPI received event:", eventData?.type, eventData?.symbol);
    const { type, symbol, payload } = eventData;

    if (type === 'ticker') {
      // FULLY DISABLED: Console spam (logs every ticker for 500 symbols = 50,000+ logs/s!)
      // console.log("📊 Processing ticker for", symbol, "payload:", JSON.stringify(payload, null, 2));

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

      // FULLY DISABLED: Console spam - this logs entire payload for every ticker!
      // console.log("🔍 Price extraction:", {
      //   lastPrice: payload.lastPrice,
      //   price: payload.price,
      //   c: payload.c,
      //   indexPrice: payload.indexPrice,
      //   markPrice: payload.markPrice,
      //   bid1Price: payload.bid1Price,
      //   ask1Price: payload.ask1Price,
      //   finalPrice: price
      // });      // Extract 24h data from WebSocket payload (if available)
      let change24h = null;
      if (payload.price24hPcnt) change24h = parseFloat(payload.price24hPcnt);
      else if (payload.priceChangePercent) change24h = parseFloat(payload.priceChangePercent);

      let volume24h = null;
      if (payload.volume24h) volume24h = parseFloat(payload.volume24h);
      else if (payload.turnover24h) volume24h = parseFloat(payload.turnover24h);
      else if (payload.v) volume24h = parseFloat(payload.v);

      // Get existing ticker to preserve 24h data if not in WebSocket payload
      const existing = latestTickers.get(symbol);

      const tickerData = {
        symbol,
        price,  // Always update price from WebSocket
        change24h: change24h !== null ? change24h : (existing?.change24h || null),  // Preserve if not in WebSocket
        volume24h: volume24h !== null ? volume24h : (existing?.volume24h || null),  // Preserve if not in WebSocket
        timestamp: new Date().toISOString(),
        last24hUpdate: change24h !== null || volume24h !== null ? new Date().toISOString() : existing?.last24hUpdate,
        source: existing?.source  // Preserve source marker
      };

      latestTickers.set(symbol, tickerData);
      // FULLY DISABLED: Console spam (logs every ticker = 50,000+ logs/s!)
      // console.log("💾 Stored ticker for", symbol, "price:", price, "total tickers:", latestTickers.size);
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
// FETCH 24H DATA FROM BYBIT REST API (ROBUST VERSION)
// ============================================================
let ticker24hInterval = null;
let fetch24hRetryCount = 0;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds
const REFRESH_INTERVAL_MS = 60000; // 60 seconds
let lastSuccessfulFetch = null;

/**
 * Fetch 24h ticker data from Bybit REST API with retry logic
 * Updates latestTickers Map with change24h and volume24h
 * WebSocket provides real-time prices, REST API provides 24h statistics
 */
async function fetch24hData(retryAttempt = 0) {
  const startTime = Date.now();

  try {
    console.log(`📊 [24H-DATA] Fetching from Bybit REST API (attempt ${retryAttempt + 1}/${MAX_RETRY_ATTEMPTS})...`);

    const url = "https://api.bybit.com/v5/market/tickers?category=linear";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'scalper-base/1.0'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();

    // Validate response structure
    if (!json || !json.result || !Array.isArray(json.result.list)) {
      throw new Error(`Invalid API response structure: ${JSON.stringify(json).slice(0, 200)}`);
    }

    const tickers = json.result.list;
    let updatedExisting = 0;
    let createdNew = 0;
    let skipped = 0;

    // Process all tickers
    for (const ticker of tickers) {
      const symbol = ticker.symbol;

      // Skip if symbol is missing
      if (!symbol) {
        skipped++;
        continue;
      }

      const existing = latestTickers.get(symbol);

      // Parse 24h data with multiple fallbacks
      const change24h = ticker.price24hPcnt ? parseFloat(ticker.price24hPcnt) :
                        ticker.priceChangePercent ? parseFloat(ticker.priceChangePercent) : null;

      const volume24h = ticker.volume24h ? parseFloat(ticker.volume24h) :
                        ticker.turnover24h ? parseFloat(ticker.turnover24h) :
                        ticker.quoteVolume ? parseFloat(ticker.quoteVolume) : null;

      if (existing) {
        // Update existing ticker with 24h data (preserve real-time price from WebSocket)
        existing.change24h = change24h;
        existing.volume24h = volume24h;
        existing.last24hUpdate = new Date().toISOString();
        updatedExisting++;
      } else {
        // Create new ticker entry (for symbols not yet in WebSocket stream)
        const price = ticker.lastPrice ? parseFloat(ticker.lastPrice) :
                     ticker.price ? parseFloat(ticker.price) : null;

        if (price) {
          latestTickers.set(symbol, {
            symbol,
            price,
            change24h,
            volume24h,
            timestamp: new Date().toISOString(),
            last24hUpdate: new Date().toISOString(),
            source: 'rest-api'
          });
          createdNew++;
        } else {
          skipped++;
        }
      }
    }

    const duration = Date.now() - startTime;
    lastSuccessfulFetch = new Date().toISOString();
    fetch24hRetryCount = 0; // Reset retry counter on success

    console.log(
      `✅ [24H-DATA] Success in ${duration}ms | ` +
      `Updated: ${updatedExisting} | Created: ${createdNew} | Skipped: ${skipped} | ` +
      `Total tickers: ${latestTickers.size}`
    );

    return true;

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ [24H-DATA] Failed after ${duration}ms:`, error.message);

    // Retry logic
    if (retryAttempt < MAX_RETRY_ATTEMPTS - 1) {
      fetch24hRetryCount++;
      console.log(`🔄 [24H-DATA] Retrying in ${RETRY_DELAY_MS}ms (attempt ${retryAttempt + 2}/${MAX_RETRY_ATTEMPTS})...`);

      setTimeout(() => {
        fetch24hData(retryAttempt + 1);
      }, RETRY_DELAY_MS);

      return false;
    } else {
      console.error(`❌ [24H-DATA] Max retry attempts reached. Will try again on next interval.`);
      fetch24hRetryCount = 0;
      return false;
    }
  }
}

/**
 * Start periodic 24h data refresh
 * - Initial fetch on startup
 * - Refresh every 60 seconds
 * - Auto-retry on failures
 */
function start24hDataRefresh() {
  if (ticker24hInterval) {
    console.log("⚠️ [24H-DATA] Refresh already running, clearing old interval...");
    clearInterval(ticker24hInterval);
  }

  console.log(`🚀 [24H-DATA] Starting periodic refresh (interval: ${REFRESH_INTERVAL_MS / 1000}s)...`);

  // Initial fetch (don't wait)
  fetch24hData();

  // Periodic refresh
  ticker24hInterval = setInterval(() => {
    // Only fetch if not currently retrying
    if (fetch24hRetryCount === 0) {
      fetch24hData();
    } else {
      console.log(`⏭️ [24H-DATA] Skipping scheduled fetch (retry in progress: ${fetch24hRetryCount}/${MAX_RETRY_ATTEMPTS})`);
    }
  }, REFRESH_INTERVAL_MS);

  console.log(`✅ [24H-DATA] Periodic refresh started successfully`);
}

/**
 * Stop 24h data refresh (for cleanup)
 */
function stop24hDataRefresh() {
  if (ticker24hInterval) {
    clearInterval(ticker24hInterval);
    ticker24hInterval = null;
    console.log("🛑 [24H-DATA] Periodic refresh stopped");
  }
}

/**
 * Get 24h data refresh status (for monitoring)
 */
function get24hDataStatus() {
  return {
    running: ticker24hInterval !== null,
    lastSuccessfulFetch,
    retryCount: fetch24hRetryCount,
    totalTickers: latestTickers.size,
    intervalSeconds: REFRESH_INTERVAL_MS / 1000
  };
}

// ============================================================
// FEATURE ENGINE INSTANCE (shared across index.js and API)
// ============================================================
export const featureEngine = new FeatureEngine();
console.log("🔧 Feature Engine instance created (module-level)");

// ============================================================
// START ENGINE API SERVER
// ============================================================
export function startMonitorApiServer(port = 8090) {
  return new Promise((resolve, reject) => {
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
      tickers: tickerArray,
      ticker24hStatus: get24hDataStatus() // Include 24h refresh status
    });
  });

  // ============================================================
  // GET /api/monitor/24h-status - 24h data refresh status
  // ============================================================
  app.get("/api/monitor/24h-status", (req, res) => {
    return res.json({
      ok: true,
      status: get24hDataStatus()
    });
  });

  // ============================================================
  // GET /api/monitor/test-fetch - Manual trigger for 24h data fetch (DEBUG)
  // ============================================================
  app.get("/api/monitor/test-fetch", async (req, res) => {
    try {
      console.log("🧪 [TEST-FETCH] Manual fetch triggered via API endpoint");
      await fetch24hData(0);
      return res.json({
        ok: true,
        message: "Fetch triggered successfully",
        status: get24hDataStatus()
      });
    } catch (error) {
      console.error("❌ [TEST-FETCH] Error:", error);
      return res.json({
        ok: false,
        error: error.message,
        stack: error.stack
      });
    }
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
  // ============================================================
  // GET /api/live-market/:symbol - Live market state (for Signal Scanner)
  // ============================================================
  app.get("/api/live-market/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;

      // 1. Get ticker data (price, bid, ask)
      const ticker = latestTickers.get(symbol);
      if (!ticker) {
        return res.json({
          ok: false,
          error: `No ticker data for symbol: ${symbol}`,
          symbol,
          timestamp: new Date().toISOString()
        });
      }

      // 2. Get orderbook summary (imbalance, spread, walls)
      const orderbook = OrderbookManager.getOrderbookSummary(symbol, 50);

      // 3. Calculate spread - PRIORITIZE orderbook over ticker for accurate bid/ask
      let bid = ticker.bid || ticker.price || 0;
      let ask = ticker.ask || ticker.price || 0;

      if (orderbook && orderbook.bestBid && orderbook.bestAsk) {
        // Use orderbook bid/ask (more accurate than ticker which Bybit rounds)
        // bestBid/bestAsk are numbers (prices), not objects
        bid = orderbook.bestBid;
        ask = orderbook.bestAsk;
      }

      const spread = bid > 0 && ask > 0 ? ((ask - bid) / bid * 100) : 0;

      // Calculate price - use ticker, fallback to orderbook mid-price
      let price = ticker.price;
      if (!price && bid > 0 && ask > 0) {
        price = (bid + ask) / 2; // Orderbook mid-price fallback
      }

      // 4. Get imbalance (default to 1.0 if no orderbook)
      const imbalance = orderbook?.imbalance ?? 1.0;

      // 5. Get order flow from 60s trade aggregation
      const orderFlowNet60s = OrderbookManager.getOrderFlow60s(symbol);

      // 6. Return live market state
      return res.json({
        ok: true,
        symbol,
        live: {
          price: price,
          bid: bid,
          ask: ask,
          spread: parseFloat(spread.toFixed(4)),
          spreadPercent: spread.toFixed(4),
          imbalance: parseFloat(imbalance.toFixed(2)),
          orderFlowNet60s: orderFlowNet60s,
          volume24h: ticker.volume24h || 0,
          change24h: ticker.change24h || 0,
          lastUpdate: ticker.timestamp || new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [API] Error fetching live market for ${req.params.symbol}:`, error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        symbol: req.params.symbol,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // GET /api/tracked-symbols - List of symbols with orderbook data
  // ============================================================
  app.get("/api/tracked-symbols", (req, res) => {
    try {
      // Get all symbols that have orderbook data
      const trackedSymbols = OrderbookManager.getAllTrackedSymbols();

      return res.json({
        ok: true,
        count: trackedSymbols.length,
        symbols: trackedSymbols,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [API] Error fetching tracked symbols:`, error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/symbol/:symbol/orderbook - Orderbook details
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

  // GET /api/symbol/:symbol/health - Symbol activity health check
  app.get("/api/symbol/:symbol/health", async (req, res) => {
    try {
      const { symbol } = req.params;
      const health = OrderbookManager.getSymbolHealth(symbol);

      return res.json({
        ok: true,
        symbol,
        health,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [API] Error fetching health for ${req.params.symbol}:`, error.message);
      return res.status(500).json({
        ok: false,
        error: error.message,
        symbol: req.params.symbol,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ================================================================
  // REGIME ENGINE API ENDPOINTS
  // ================================================================

  // GET /api/regime/global - Global market regime state
  app.get("/api/regime/global", async (req, res) => {
    try {
      if (!global.regimeEngine) {
        return res.status(503).json({
          ok: false,
          error: "Regime Engine not initialized"
        });
      }

      const globalRegime = global.regimeEngine.getGlobalRegime();

      return res.json({
        ok: true,
        regime: globalRegime,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/regime/overview - All symbols regime summary
  app.get("/api/regime/overview", async (req, res) => {
    try {
      if (!global.regimeEngine) {
        return res.status(503).json({
          ok: false,
          error: "Regime Engine not initialized"
        });
      }

      const overview = global.regimeEngine.getRegimeOverview();

      return res.json({
        ok: true,
        overview,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/symbol/:symbol/regime - Per-symbol regime details
  app.get("/api/symbol/:symbol/regime", async (req, res) => {
    try {
      if (!global.regimeEngine) {
        return res.status(503).json({
          ok: false,
          error: "Regime Engine not initialized"
        });
      }

      const symbol = req.params.symbol.toUpperCase();
      const symbolRegime = global.regimeEngine.getSymbolRegime(symbol);

      if (!symbolRegime) {
        return res.status(404).json({
          ok: false,
          error: `No regime data for ${symbol}`,
          symbol,
          timestamp: new Date().toISOString()
        });
      }

      return res.json({
        ok: true,
        symbol,
        regime: symbolRegime,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
        symbol: req.params.symbol,
        timestamp: new Date().toISOString()
      });
    }
  });

  // POST /api/regime/check-trade - Check if trade is allowed
  app.post("/api/regime/check-trade", async (req, res) => {
    try {
      if (!global.regimeEngine) {
        return res.status(503).json({
          ok: false,
          error: "Regime Engine not initialized"
        });
      }

      const { symbol, side } = req.body;

      if (!symbol || !side) {
        return res.status(400).json({
          ok: false,
          error: "Missing required fields: symbol, side"
        });
      }

      const tradeCheck = global.regimeEngine.isTradeAllowed(symbol.toUpperCase(), side.toUpperCase());

      return res.json({
        ok: true,
        symbol: symbol.toUpperCase(),
        side: side.toUpperCase(),
        ...tradeCheck,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ================================================================
  // END REGIME ENGINE API ENDPOINTS
  // ================================================================

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

  // Register WebSocket event callback for adaptive intervals
  OrderbookManager.setWebSocketEventCallback(() => {
    featureEngine.trackWebSocketEvent();
  });
  console.log("✅ FeatureEngine adaptive interval tracking registered");

  // GET /api/diagnostics - COMPREHENSIVE SYSTEM HEALTH CHECK
  app.get("/api/diagnostics", async (req, res) => {
    try {
      const { runFullDiagnostics } = await import('../diagnostics/systemHealth.js');
      const report = await runFullDiagnostics(featureEngine);

      res.json({
        status: "success",
        data: report,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [DIAGNOSTICS] Error:", error);
      res.status(500).json({
        status: "error",
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

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

  // GET /api/features/walls/stats - Wall detection statistics
  app.get("/api/features/walls/stats", async (req, res) => {
    try {
      const overview = featureEngine.getFeaturesOverview();
      const wallStats = {
        totalSymbols: overview.length,
        symbolsWithWalls: overview.filter(s => s.spoofingScore > 0).length,
        symbolsWithHighImbalance: overview.filter(s => Math.abs(s.tobImbalance) > 0.5).length,
        avgSpoofingScore: overview.reduce((sum, s) => sum + s.spoofingScore, 0) / overview.length,
        maxSpoofingScore: Math.max(...overview.map(s => s.spoofingScore)),
        topSpoofingSymbols: overview
          .filter(s => s.spoofingScore > 0)
          .sort((a, b) => b.spoofingScore - a.spoofingScore)
          .slice(0, 10)
          .map(s => ({ symbol: s.symbol, spoofingScore: s.spoofingScore, tobImbalance: s.tobImbalance })),
        // Add sample of wall data to debug
        sampleSymbolWallData: overview.slice(0, 3).map(s => {
          const fullData = featureEngine.getFeatureState(s.symbol);
          return {
            symbol: s.symbol,
            hasBidWall: fullData?.walls?.hasBidWall,
            hasAskWall: fullData?.walls?.hasAskWall,
            spoofingScore: fullData?.walls?.spoofingScore,
            currentPrice: fullData?.walls?.metadata?.currentPrice,
            totalBidWalls: fullData?.walls?.metadata?.totalBidWalls,
            totalAskWalls: fullData?.walls?.metadata?.totalAskWalls,
            bidWallStrength: fullData?.walls?.bidWallStrength,
            askWallStrength: fullData?.walls?.askWallStrength
          };
        })
      };
      res.json({
        status: "success",
        data: wallStats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [FEATURES/WALLS/STATS] Error:", error);
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
      const features = featureEngine.getFeatureState(symbol);
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
  // SCORING ENGINE API
  // ============================================================

  // GET /api/symbol/:symbol/score - Get score for single symbol
  app.get("/api/symbol/:symbol/score", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();

      // Lazy import scoring engine
      const { scoringEngine } = await import('../scoring/scoringEngine.js');

      const scoreState = scoringEngine.getScoreState(symbol);

      if (!scoreState) {
        return res.status(404).json({
          ok: false,
          error: `No score data for symbol: ${symbol}`,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        ok: true,
        symbol,
        score: scoreState,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [SCORE/${req.params.symbol}] Error:`, error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/scanner/hotlist - Get scanner hotlist (top scoring symbols)
  app.get("/api/scanner/hotlist", async (req, res) => {
    try {
      // Query params
      const side = (req.query.side || 'BOTH').toUpperCase();
      const minScore = parseFloat(req.query.minScore) || 40;
      const limit = parseInt(req.query.limit) || 20;
      const ignoreGlobalRegime = req.query.ignoreGlobalRegime === 'true'; // For dashboard viewing

      // Validate side
      if (!['BOTH', 'LONG', 'SHORT'].includes(side)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid side parameter. Must be: BOTH, LONG, or SHORT",
          timestamp: new Date().toISOString()
        });
      }

      // Lazy import scoring engine
      const { scoringEngine } = await import('../scoring/scoringEngine.js');

      const hotlist = scoringEngine.getScannerHotlist({
        side,
        minScore,
        limit,
        ignoreGlobalRegime
      });

      res.json({
        ok: true,
        hotlist,
        filters: { side, minScore, limit, ignoreGlobalRegime },
        count: hotlist.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [SCANNER/HOTLIST] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/scoring/stats - Get scoring statistics
  app.get("/api/scoring/stats", async (req, res) => {
    try {
      const { scoringEngine } = await import('../scoring/scoringEngine.js');

      const stats = scoringEngine.getStats();

      res.json({
        ok: true,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [SCORING/STATS] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // STATE MACHINE API
  // ============================================================

  // GET /api/states/overview - Get State Machine overview with statistics
  app.get("/api/states/overview", async (req, res) => {
    try {
      if (!global.stateMachine) {
        return res.status(503).json({
          ok: false,
          error: "State Machine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const overview = global.stateMachine.getStatesOverview();
      const stats = global.stateMachine.getStateStatistics();

      res.json({
        ok: true,
        summary: stats,
        entries: overview,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [STATE/OVERVIEW] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/symbol/:symbol/state - Get detailed state for one symbol
  app.get("/api/symbol/:symbol/state", async (req, res) => {
    try {
      if (!global.stateMachine) {
        return res.status(503).json({
          ok: false,
          error: "State Machine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const symbol = req.params.symbol.toUpperCase();
      const state = global.stateMachine.getSymbolState(symbol);

      if (!state) {
        return res.status(404).json({
          ok: false,
          error: `No state data for symbol: ${symbol}`,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        ok: true,
        symbol,
        state,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [STATE/${req.params.symbol}] Error:`, error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/symbol/:symbol/events - Get event log history for one symbol
  app.get("/api/symbol/:symbol/events", async (req, res) => {
    try {
      if (!global.stateMachine) {
        return res.status(503).json({
          ok: false,
          error: "State Machine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const symbol = req.params.symbol.toUpperCase();
      const limit = parseInt(req.query.limit) || 50;

      const events = global.stateMachine.readEventLog(symbol, limit);

      res.json({
        ok: true,
        symbol,
        events,
        count: events.length,
        limit,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [STATE/EVENTS/${req.params.symbol}] Error:`, error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // RISK ENGINE API
  // ============================================================

  // GET /api/risk/overview - Get complete risk snapshot
  app.get("/api/risk/overview", async (req, res) => {
    try {
      if (!global.riskEngine) {
        return res.status(503).json({
          ok: false,
          error: "Risk Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const snapshot = global.riskEngine.getRiskSnapshot();

      res.json({
        ok: true,
        data: snapshot,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [RISK/OVERVIEW] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/risk/limits - Get risk configuration limits
  app.get("/api/risk/limits", async (req, res) => {
    try {
      if (!global.riskEngine) {
        return res.status(503).json({
          ok: false,
          error: "Risk Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const config = global.riskEngine.getRiskConfig();

      res.json({
        ok: true,
        limits: config,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [RISK/LIMITS] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/positions - Get all active positions
  app.get("/api/positions", async (req, res) => {
    try {
      if (!global.riskEngine) {
        return res.status(503).json({
          ok: false,
          error: "Risk Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const positionTracker = await import('../risk/positionTracker.js');
      const positions = positionTracker.getAllPositions(true); // active only
      const summary = positionTracker.getPortfolioSummary();

      res.json({
        ok: true,
        positions,
        summary,
        count: positions.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [POSITIONS] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/positions/enhanced - Get positions with TP/SL data (MUST be before :symbol route!)
  app.get("/api/positions/enhanced", async (req, res) => {
    console.log("🔍 [POSITIONS/ENHANCED] Endpoint called");
    try {
      console.log("🔍 [POSITIONS/ENHANCED] Checking engines...");
      console.log("🔍 [POSITIONS/ENHANCED] global.riskEngine exists:", !!global.riskEngine);
      console.log("🔍 [POSITIONS/ENHANCED] global.tpslEngine exists:", !!global.tpslEngine);

      if (!global.riskEngine || !global.tpslEngine) {
        console.log("❌ [POSITIONS/ENHANCED] Engines not initialized!");
        return res.status(503).json({
          ok: false,
          error: "Risk Engine or TP/SL Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      // Get positions from Risk Engine (which has persistent positionTracker)
      console.log("🔍 [POSITIONS/ENHANCED] Getting risk snapshot...");
      const riskData = global.riskEngine.getRiskSnapshot();
      console.log("🔍 [POSITIONS/ENHANCED] Risk snapshot received:", !!riskData);
      console.log("🔍 [POSITIONS/ENHANCED] Risk snapshot keys:", Object.keys(riskData || {}));

      const positions = riskData.positions || [];

      console.log(`[POSITIONS/ENHANCED] Risk snapshot has ${positions.length} positions`);
      if (positions.length > 0) {
        console.log(`[POSITIONS/ENHANCED] First position:`, positions[0]);
      }

      // Enrich positions with TP/SL data
      const enrichedPositions = positions.map(pos => {
        const tpslState = global.tpslEngine.getTpslState(pos.symbol, pos.side);
        return {
          ...pos,
          tpsl: tpslState || null
        };
      });

      const summary = riskData.portfolio || {};

      res.json({
        ok: true,
        positions: enrichedPositions,
        summary,
        count: enrichedPositions.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [POSITIONS/ENHANCED] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/positions/:symbol - Get positions for specific symbol
  app.get("/api/positions/:symbol", async (req, res) => {
    try {
      if (!global.riskEngine) {
        return res.status(503).json({
          ok: false,
          error: "Risk Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const symbol = req.params.symbol.toUpperCase();
      const positionTracker = await import('../risk/positionTracker.js');

      const longPos = positionTracker.getPosition(symbol, "LONG");
      const shortPos = positionTracker.getPosition(symbol, "SHORT");

      const positions = [];
      if (longPos && longPos.isOpen) positions.push(longPos);
      if (shortPos && shortPos.isOpen) positions.push(shortPos);

      res.json({
        ok: true,
        symbol,
        positions,
        count: positions.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [POSITIONS/${req.params.symbol}] Error:`, error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/trades_log/:date - Get daily trade history
  app.get("/api/trades_log/:date", async (req, res) => {
    try {
      if (!global.riskEngine) {
        return res.status(503).json({
          ok: false,
          error: "Risk Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const dateKey = req.params.date; // YYYY-MM-DD format
      const dailyStats = global.riskEngine.getDailyStats();

      // For now, return daily stats (full trade log will be in future phases)
      res.json({
        ok: true,
        date: dateKey,
        stats: dailyStats,
        trades: [], // TODO: Implement trade log persistence
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [TRADES_LOG/${req.params.date}] Error:`, error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // TP/SL ENGINE API
  // ============================================================

  // GET /api/tpsl/overview - Get all active TP/SL states
  app.get("/api/tpsl/overview", async (req, res) => {
    try {
      if (!global.tpslEngine) {
        return res.status(503).json({
          ok: false,
          error: "TP/SL Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const allStates = global.tpslEngine.getAllTpslStates();

      res.json({
        ok: true,
        tpslStates: allStates,
        count: allStates.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [TPSL/OVERVIEW] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // GET /api/tpsl/:symbol - Get TP/SL state for specific symbol
  app.get("/api/tpsl/:symbol", async (req, res) => {
    try {
      if (!global.tpslEngine) {
        return res.status(503).json({
          ok: false,
          error: "TP/SL Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const symbol = req.params.symbol.toUpperCase();
      const side = req.query.side || "LONG"; // Default to LONG if not specified

      const tpslState = global.tpslEngine.getTpslState(symbol, side);

      if (!tpslState) {
        return res.status(404).json({
          ok: false,
          error: `No TP/SL state for ${symbol} ${side}`,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        ok: true,
        symbol,
        side,
        tpslState,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ [TPSL/${req.params.symbol}] Error:`, error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // POST /api/risk/test-position - Create test position (for testing only)
  app.post("/api/risk/test-position", async (req, res) => {
    try {
      if (!global.riskEngine) {
        return res.status(503).json({
          ok: false,
          error: "Risk Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const { symbol, side, entryPrice, qty, leverage } = req.body;

      if (!symbol || !side || !entryPrice || !qty) {
        return res.status(400).json({
          ok: false,
          error: "Missing required fields: symbol, side, entryPrice, qty",
          timestamp: new Date().toISOString()
        });
      }

      console.log(`[TEST-POSITION] Creating position: ${symbol} ${side} @${entryPrice}`);
      console.log(`[TEST-POSITION] global.riskEngine exists:`, !!global.riskEngine);
      console.log(`[TEST-POSITION] createTestPosition exists:`, typeof global.riskEngine.createTestPosition);

      // Create test position through Risk Engine (uses same positionTracker instance)
      const position = global.riskEngine.createTestPosition({
        symbol,
        side,
        entryPrice,
        qty,
        leverage: leverage || 1
      });

      // Trigger TP/SL Engine to create state
      if (global.tpslEngine) {
        try {
          await global.tpslEngine.onPositionOpened({
            symbol,
            side: side.toUpperCase(),
            entryPrice: parseFloat(entryPrice),
            qty: parseFloat(qty)
          });

          // Update position tracker with calculated TP/SL prices
          const tpslState = global.tpslEngine.getTpslState(symbol, side.toUpperCase());
          if (tpslState && global.riskEngine.updatePositionTpSl) {
            global.riskEngine.updatePositionTpSl(symbol, side.toUpperCase(), {
              stopLossPrice: tpslState.stopLossPrice,
              takeProfit1Price: tpslState.tp1Price,
              takeProfit2Price: tpslState.tp2Price
            });
            console.log(`✅ [TEST-POSITION] TP/SL prices synced to position tracker`);
          }
        } catch (tpslError) {
          console.warn("⚠️  [TEST-POSITION] TP/SL Engine error:", tpslError.message);
        }
      }

      res.json({
        ok: true,
        position,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [TEST-POSITION] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // PHASE 10: EXECUTION ENGINE ENDPOINTS
  // ============================================================

  // Get execution engine overview
  app.get("/api/execution/overview", (req, res) => {
    try {
      if (!global.executionEngine) {
        return res.status(503).json({
          ok: false,
          error: "Execution Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const state = global.executionEngine.getExecutionState();
      const pendingOrders = global.executionEngine.getPendingOrders();

      res.json({
        ok: true,
        state,
        pendingOrders,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [EXECUTION/OVERVIEW] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Get today's orders (filtered)
  app.get("/api/execution/orders", async (req, res) => {
    try {
      const { symbol, status, source, side } = req.query;

      const orderRouter = await import('../execution/orderRouter.js');
      const filters = {};
      if (symbol) filters.symbol = symbol;
      if (status) filters.status = status;
      if (source) filters.source = source;
      if (side) filters.side = side;

      const orders = await orderRouter.default.getFilteredOrders(filters);

      res.json({
        ok: true,
        orders,
        count: orders.length,
        filters,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [EXECUTION/ORDERS] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Panic close all positions
  app.post("/api/execution/panic-close-all", async (req, res) => {
    try {
      if (!global.executionEngine) {
        return res.status(503).json({
          ok: false,
          error: "Execution Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const { reason } = req.body;
      await global.executionEngine.panicCloseAll(reason || "Manual panic close");

      res.json({
        ok: true,
        message: "Panic close initiated for all positions",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [EXECUTION/PANIC-CLOSE-ALL] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Panic close specific symbol
  app.post("/api/execution/panic-close-symbol", async (req, res) => {
    try {
      if (!global.executionEngine) {
        return res.status(503).json({
          ok: false,
          error: "Execution Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const { symbol, reason } = req.body;
      if (!symbol) {
        return res.status(400).json({
          ok: false,
          error: "Missing required field: symbol",
          timestamp: new Date().toISOString()
        });
      }

      await global.executionEngine.panicCloseSymbol(symbol, reason || "Manual panic close");

      res.json({
        ok: true,
        message: `Panic close initiated for ${symbol}`,
        symbol,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [EXECUTION/PANIC-CLOSE-SYMBOL] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Manual order submission (for testing)
  app.post("/api/execution/submit-order", async (req, res) => {
    try {
      if (!global.executionEngine) {
        return res.status(503).json({
          ok: false,
          error: "Execution Engine not initialized",
          timestamp: new Date().toISOString()
        });
      }

      const orderRequest = req.body;
      const result = await global.executionEngine.submitOrder(orderRequest);

      res.json({
        ok: result !== null,
        order: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [EXECUTION/SUBMIT-ORDER] Error:", error);
      res.status(500).json({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================================
  // START SERVER
  // ============================================================
  app.listen(port, "0.0.0.0", async () => {
    console.log("=".repeat(60));
    console.log("🚀 DEBUG: Monitor API successfully started");
    console.log(`🟢 ENGINE-API running on port ${port}`);
    console.log(`➡️  http://localhost:${port}/api/monitor/summary`);
    console.log(`➡️  http://localhost:${port}/api/monitor/24h-status`);
    console.log(`➡️  http://localhost:${port}/api/monitor/test-fetch`);
    console.log("=".repeat(60));

    // Start 24h data refresh with robust error handling
    console.log("⏳ About to call start24hDataRefresh()...");
    start24hDataRefresh();
    console.log("✅ start24hDataRefresh() call completed");
    console.log("=".repeat(60));

    // Initialize and start Feature Engine
    console.log("🔧 Initializing Feature Engine...");
    try {
      await featureEngine.init();
      console.log("✅ Feature Engine initialized successfully");

      await featureEngine.start();
      console.log("✅ Feature Engine started - processing symbols");

      // Resolve promise AFTER FeatureEngine is ready
      resolve();
    } catch (error) {
      console.error("❌ Failed to initialize Feature Engine:", error);
      reject(error);
    }
    console.log("=".repeat(60));
  });
  });
}

// ============================================================
// EXPORTS FOR EXTERNAL USE
// ============================================================
export {
  start24hDataRefresh,
  stop24hDataRefresh,
  get24hDataStatus,
  fetch24hData
};
