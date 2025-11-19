// src/market/universe.js

import fs from "fs";
import path from "path";
import { fetchInstrumentsUSDTPerp } from "../connectors/bybitPublic.js";
import CONFIG from "../config/index.js";
import paths from "../config/paths.js";

const UNIVERSE_FILE = path.join(paths.SYSTEM_DIR, "universe.json");

// In-memory state
let UniverseState = {
  fetchedAt: null,
  symbols: {}, // key: symbol → SymbolMeta
  stats: {
    totalSymbols: 0,
    primeCount: 0,
    normalCount: 0,
    wildCount: 0,
    lastUniverseUpdateAt: null,
  },
};

// Helper – determine category
function categorizeSymbol(symbol) {
  const primeList = CONFIG.primeSymbols || [];

  if (primeList.includes(symbol)) return "Prime";

  // For Faza 2 → new listings = Wild
  // Later phases may use volume/liquidity data
  const meta = UniverseState.symbols[symbol];
  if (meta && meta.isNewListing) return "Wild";

  return "Normal";
}

// Save snapshot to JSON
function saveUniverseSnapshot() {
  try {
    fs.writeFileSync(
      UNIVERSE_FILE,
      JSON.stringify(UniverseState, null, 2)
    );
  } catch (err) {
    console.error("❌ Error saving universe snapshot:", err);
  }
}

// Initialize universe (first load)
export async function initUniverse() {
  console.log("🌍 [UNIVERSE] Initial fetch...");

  const result = await fetchInstrumentsUSDTPerp();

  if (!result.success) {
    console.error("❌ [UNIVERSE] Failed to fetch instruments:", result.error);
    return;
  }

  const now = new Date().toISOString();
  UniverseState.fetchedAt = now;

  for (const item of result.symbols) {
    const symbol = item.symbol;

    UniverseState.symbols[symbol] = {
      symbol,
      baseAsset: item.baseAsset,
      quoteAsset: item.quoteAsset,
      contractType: item.contractType,
      status: item.status,
      tickSize: item.tickSize,
      minOrderQty: item.minOrderQty,
      lotSize: item.lotSize,
      maxLeverage: item.maxLeverage,
      isNewListing: false,
      firstSeenAt: now,
      lastUpdatedAt: now,
      category: "Normal", // temporary, will update below
    };
  }

  // Initial categorization
  for (const symbol of Object.keys(UniverseState.symbols)) {
    UniverseState.symbols[symbol].category = categorizeSymbol(symbol);
  }

  // Stats
  updateUniverseStats();

  // Save snapshot
  saveUniverseSnapshot();

  console.log(
    `🌍 [UNIVERSE] Loaded ${UniverseState.stats.totalSymbols} symbols`
  );
}

// Periodic refresh (detect new listings)
export function refreshUniversePeriodically() {
  const interval = CONFIG.universeRefreshIntervalMs || 15000;

  setInterval(async () => {
    const result = await fetchInstrumentsUSDTPerp();
    const now = new Date().toISOString();

    if (!result.success) {
      console.error("⚠️ [UNIVERSE] Refresh failed:", result.error);
      return;
    }

    const newList = result.symbols;
    const knownSymbols = Object.keys(UniverseState.symbols);

    // Detect new or updated symbols
    for (const item of newList) {
      const symbol = item.symbol;

      if (!UniverseState.symbols[symbol]) {
        // >>> NEW LISTING DETECTED <<<
        UniverseState.symbols[symbol] = {
          symbol,
          baseAsset: item.baseAsset,
          quoteAsset: item.quoteAsset,
          contractType: item.contractType,
          status: item.status,
          tickSize: item.tickSize,
          minOrderQty: item.minOrderQty,
          lotSize: item.lotSize,
          maxLeverage: item.maxLeverage,
          isNewListing: true,
          firstSeenAt: now,
          lastUpdatedAt: now,
          category: "Wild", // new listings = Wild
        };

        console.log(`🆕 [UNIVERSE] New listing detected: ${symbol}`);
      } else {
        // Existing symbol → update metadata
        const meta = UniverseState.symbols[symbol];
        meta.status = item.status;
        meta.tickSize = item.tickSize;
        meta.minOrderQty = item.minOrderQty;
        meta.lotSize = item.lotSize;
        meta.maxLeverage = item.maxLeverage;
        meta.lastUpdatedAt = now;
      }
    }

    // Re-categorize all symbols after update
    for (const symbol of Object.keys(UniverseState.symbols)) {
      UniverseState.symbols[symbol].category = categorizeSymbol(symbol);
    }

    updateUniverseStats();

    // Save snapshot
    saveUniverseSnapshot();
  }, interval);
}

function updateUniverseStats() {
  const symbols = Object.values(UniverseState.symbols);

  UniverseState.stats.totalSymbols = symbols.length;
  UniverseState.stats.primeCount = symbols.filter((s) => s.category === "Prime").length;
  UniverseState.stats.normalCount = symbols.filter((s) => s.category === "Normal").length;
  UniverseState.stats.wildCount = symbols.filter((s) => s.category === "Wild").length;
  UniverseState.stats.lastUniverseUpdateAt = new Date().toISOString();
}

// Public API

export function getUniverseSnapshot() {
  return JSON.parse(JSON.stringify(UniverseState));
}

export function getSymbolMeta(symbol) {
  return UniverseState.symbols[symbol] || null;
}

export function getSymbolsByCategory(category) {
  return Object.keys(UniverseState.symbols).filter(
    symbol => UniverseState.symbols[symbol].category === category
  );
}
