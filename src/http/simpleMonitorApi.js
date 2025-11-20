// ============================================================
// src/http/simpleMonitorApi.js
// SIMPLE ISOLATED MONITOR API (NO ENGINE DEPENDENCIES)
// ============================================================

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ONLY SAFE IMPORTS - NO ENGINE DEPENDENCIES
import {
  getUniverseSnapshot,
  getUniverseStats,
  getSymbolMeta,
  getSymbolsByCategory
} from "../market/universe_v2.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// TICKER DATA READER (FROM ENGINE'S SHARED STATE)
// ============================================================
const DATA_DIR = path.resolve(__dirname, "../../data");
const TICKER_FILE = path.join(DATA_DIR, "latest_tickers.json");

function readLatestTickers() {
  try {
    if (!fs.existsSync(TICKER_FILE)) {
      console.log("📄 No ticker file found, returning empty data");
      return {};
    }

    const data = fs.readFileSync(TICKER_FILE, "utf8");
    const tickers = JSON.parse(data);
    console.log(`📊 Read ${Object.keys(tickers).length} tickers from file`);
    return tickers;
  } catch (error) {
    console.error("❌ Error reading ticker file:", error.message);
    return {};
  }
}

// ============================================================
// EXPRESS APP SETUP
// ============================================================
const app = express();
const port = process.env.MONITOR_PORT || 8090;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ============================================================
// API ENDPOINTS
// ============================================================

// Basic symbols endpoint
app.get("/api/symbols", async (req, res) => {
  try {
    console.log("📡 /api/symbols - Fetching symbols from Universe v2");
    const allSymbols = await getSymbolsByCategory("All");

    const response = {
      ok: true,
      count: allSymbols.length,
      symbols: allSymbols,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ Returning ${allSymbols.length} symbols`);
    return res.json(response);
  } catch (error) {
    console.error("❌ Error in /api/symbols:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Enhanced symbols endpoint with ticker data
app.get("/api/monitor/symbols", async (req, res) => {
  try {
    console.log("📡 /api/monitor/symbols - Fetching symbols with ticker data");

    // Get symbols from Universe v2
    const primeSymbols = await getSymbolsByCategory("Prime");
    console.log(`🎯 Found ${primeSymbols.length} Prime symbols`);

    // Read ticker data from shared file
    const tickers = readLatestTickers();
    console.log(`💰 Found ticker data for ${Object.keys(tickers).length} symbols`);

    // Enrich symbols with ticker data
    const enrichedSymbols = primeSymbols.map(symbolMeta => {
      const ticker = tickers[symbolMeta.symbol];

      if (ticker) {
        console.log(`💎 Found ticker for ${symbolMeta.symbol}: $${ticker.price}`);
        return {
          ...symbolMeta,
          price: ticker.price,
          change24h: ticker.change24h,
          volume24h: ticker.volume24h,
          lastUpdate: ticker.timestamp
        };
      } else {
        console.log(`⚠️  No ticker data for ${symbolMeta.symbol}`);
        return {
          ...symbolMeta,
          price: null,
          change24h: null,
          volume24h: null,
          lastUpdate: null
        };
      }
    });

    const response = {
      ok: true,
      count: enrichedSymbols.length,
      symbols: enrichedSymbols,
      timestamp: new Date().toISOString(),
      debug: {
        primeCount: primeSymbols.length,
        tickerCount: Object.keys(tickers).length,
        enrichedCount: enrichedSymbols.filter(s => s.price !== null).length
      }
    };

    console.log(`✅ Returning ${enrichedSymbols.length} enriched Prime symbols`);
    return res.json(response);
  } catch (error) {
    console.error("❌ Error in /api/monitor/symbols:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Universe stats endpoint
app.get("/api/monitor/universe", async (req, res) => {
  try {
    const stats = await getUniverseStats();
    return res.json({
      ok: true,
      ...stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error in /api/monitor/universe:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Storage stats endpoint
app.get("/api/monitor/storage", (req, res) => {
  try {
    // Generate mock storage stats since we don't have access to engine storage
    const storageStats = {
      tickers: {
        count: Object.keys(readLatestTickers()).length,
        lastUpdate: new Date().toISOString()
      },
      trades: {
        count: 0,
        lastUpdate: null
      },
      snapshots: {
        count: 1,
        lastUpdate: new Date().toISOString()
      }
    };

    return res.json({
      ok: true,
      storage: storageStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error in /api/monitor/storage:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Summary endpoint for dashboard compatibility
app.get("/api/monitor/summary", async (req, res) => {
  try {
    const tickers = readLatestTickers();
    const primeSymbols = await getSymbolsByCategory("Prime");

    const summary = {
      symbols: {
        total: primeSymbols.length,
        prime: primeSymbols.length,
        normal: 0,
        wild: 0
      },
      tickers: {
        count: Object.keys(tickers).length,
        lastUpdate: new Date().toISOString()
      },
      status: "online"
    };

    return res.json({
      ok: true,
      summary: summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error in /api/monitor/summary:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get("/api/monitor/health", (req, res) => {
  const tickers = readLatestTickers();

  return res.json({
    ok: true,
    status: "running",
    tickerCount: Object.keys(tickers).length,
    timestamp: new Date().toISOString(),
    port: port
  });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(port, "0.0.0.0", () => {
  console.log("🚀 Simple Monitor API started successfully");
  console.log(`🟢 MONITOR-API running on port ${port}`);
  console.log(`➡️  http://localhost:${port}/api/monitor/symbols`);
  console.log(`📊 Ticker file: ${TICKER_FILE}`);
});
