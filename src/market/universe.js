/* =========================================================
   src/market/universe.js
   AI Scalper – Universe Service (PHASE 2 – CLEAN VERSION)
   ========================================================= */

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import CONFIG from "../config/index.js";
import paths from "../config/paths.js";

// EngineMetrics tracking
import metrics from '../core/metrics.js';

const UNIVERSE_FILE = path.join(paths.SYSTEM_DIR, "universe.json");

/* ---------------------------------------------------------
   In-memory universe state
--------------------------------------------------------- */
let UNIVERSE = {
  fetchedAt: null,
  symbols: {},        // KEY = symbol, VALUE = SymbolMeta
  stats: {
    totalSymbols: 0,
    primeCount: 0,
    normalCount: 0,
    wildCount: 0,
    lastUniverseUpdateAt: null
  }
};

/* ---------------------------------------------------------
   Save universe snapshot to disk
--------------------------------------------------------- */
function saveUniverseToDisk() {
  try {
    fs.writeFileSync(
      UNIVERSE_FILE,
      JSON.stringify(UNIVERSE, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("❌ [UNIVERSE] Failed to save:", err);
  }
}

/* ---------------------------------------------------------
   Categorization logic
--------------------------------------------------------- */
function categorizeSymbol(item) {
  const sym = item.symbol;

  // PRIME from config list
  if (CONFIG.primeSymbols.includes(sym)) return "Prime";

  const vol = Number(item.volume24h || 0);
  const price = Number(item.lastPrice || 0);

  // micro-liquidity detection
  if (vol < 1_000_000) return "Wild";
  if (price < 0.0001) return "Wild";
  if (sym.includes("1000") || sym.includes("10000")) return "Wild";

  return "Normal";
}

/* ---------------------------------------------------------
   Build SymbolMeta
--------------------------------------------------------- */
function buildSymbolMeta(item) {
  return {
    symbol: item.symbol,
    baseAsset: item.baseCoin || item.baseAsset || null,
    quoteAsset: item.quoteCoin || item.quoteAsset || "USDT",
    contractType: item.contractType || "LinearPerpetual",
    status: item.status || "Trading",
    category: categorizeSymbol(item),
    tickSize: Number(item.tickSize || item.priceFilter?.tickSize || 0),
    minOrderQty: Number(item.lotSizeFilter?.minOrderQty || 0),
    lotSize: Number(item.lotSizeFilter?.qtyStep || 0),
    maxLeverage: Number(item.leverageFilter?.maxLeverage || 1),
    isNewListing: false,
    firstSeenAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    raw: item
  };
}

/* ---------------------------------------------------------
   Fetch universe from Bybit REST
--------------------------------------------------------- */
export async function initUniverse() {
  console.log("🌍 [UNIVERSE] Initial fetch...");

  try {
    const url = "https://api.bybit.com/v5/market/tickers?category=linear";
    const res = await fetch(url);
    const json = await res.json();

    if (!json || !json.result || !Array.isArray(json.result.list)) {
      console.error("❌ [UNIVERSE] Bad response:", json);
      return;
    }

    const list = json.result.list;
    const newMap = {};

    let primeCount = 0;
    let normalCount = 0;
    let wildCount = 0;

    for (const item of list) {
      const meta = buildSymbolMeta(item);

      // Stats
      if (meta.category === "Prime") primeCount++;
      else if (meta.category === "Wild") wildCount++;
      else normalCount++;

      newMap[item.symbol] = meta;
    }

    UNIVERSE = {
      fetchedAt: new Date().toISOString(),
      symbols: newMap,
      stats: {
        totalSymbols: list.length,
        primeCount,
        normalCount,
        wildCount,
        lastUniverseUpdateAt: new Date().toISOString()
      }
    };

    saveUniverseToDisk();

    console.log(
      `🌍 [UNIVERSE] Loaded ${list.length} symbols → P:${primeCount} N:${normalCount} W:${wildCount}`
    );

  } catch (err) {
    console.error("❌ [UNIVERSE] Error during fetch:", err);
  }
}

/* ---------------------------------------------------------
   Auto-refresh
--------------------------------------------------------- */
export function refreshUniversePeriodically() {
  console.log("🌍 [UNIVERSE] Auto-refresh enabled...");

  setInterval(async () => {
    try {
      await initUniverse();
      metrics.markDecision(); // Mark universe refresh as decision
      metrics.heartbeat();    // Update heartbeat
    } catch (err) {
      console.error("❌ [UNIVERSE] Refresh failed:", err);
      metrics.markError();
    }
  }, CONFIG.system.universeRefreshIntervalMs);
}

/* ---------------------------------------------------------
   Public getters (FINAL CLEAN)
--------------------------------------------------------- */
export function getUniverseSnapshot() {
  return UNIVERSE;
}

export function getSymbolMeta(symbol) {
  return UNIVERSE.symbols[symbol] || null;
}

export function getSymbolsByCategory(category) {
  return Object.values(UNIVERSE.symbols)
    .filter(meta => meta.category === category)
    .map(meta => meta.symbol);
}

export function getUniverse() {
  return UNIVERSE; // backwards compatibility
}
