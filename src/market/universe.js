/* =========================================================
   src/market/universe.js
   AI Scalper – Universe Service (OPCIJA A)
   ========================================================= */

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import CONFIG from "../config/index.js";
import paths from "../config/paths.js";

const UNIVERSE_FILE = path.join(paths.SYSTEM_DIR, "universe.json");

// In-memory cache
let UNIVERSE = {
  fetchedAt: null,
  symbols: [],
  totalSymbols: 0,
  prime: [],
  normal: [],
  wild: []
};

/* ---------------------------------------------------------
   Helper: Save universe to disk
--------------------------------------------------------- */
function saveUniverseToDisk() {
  try {
    fs.writeFileSync(
      UNIVERSE_FILE,
      JSON.stringify(UNIVERSE, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("❌ [UNIVERSE] Failed to save universe:", err);
  }
}

/* ---------------------------------------------------------
   Helper: Determine category for a symbol
--------------------------------------------------------- */
function categorizeSymbol(s) {
  const symbol = s.symbol;

  if (CONFIG.primeSymbols.includes(symbol)) return "prime";

  // Detect new listings ("Wild")
  const isWild =
    Number(s.volume24h) < 1000000 ||
    Number(s.lastPrice) < 0.0001;

  return isWild ? "wild" : "normal";
}

/* ---------------------------------------------------------
   Fetch universe from Bybit REST
--------------------------------------------------------- */
export async function initUniverse() {
  console.log("🌍 [UNIVERSE] Initial fetch...");

  try {
    const url =
      "https://api.bybit.com/v5/market/tickers?category=linear";

    const response = await fetch(url);
    const json = await response.json();

    if (!json || !json.result || !json.result.list) {
      console.error("❌ [UNIVERSE] Bad response:", json);
      return;
    }

    const symbols = json.result.list;

    // Build full universe object
    const prime = [];
    const normal = [];
    const wild = [];

    for (const s of symbols) {
      const category = categorizeSymbol(s);

      if (category === "prime") prime.push(s.symbol);
      else if (category === "wild") wild.push(s.symbol);
      else normal.push(s.symbol);
    }

    UNIVERSE = {
      fetchedAt: new Date().toISOString(),
      symbols: symbols.map((s) => s.symbol),
      totalSymbols: symbols.length,
      prime,
      normal,
      wild
    };

    console.log(`🌍 [UNIVERSE] Loaded ${UNIVERSE.totalSymbols} symbols`);

    saveUniverseToDisk();

  } catch (err) {
    console.error("❌ [UNIVERSE] Error:", err);
  }
}

/* ---------------------------------------------------------
   Periodic refresh
--------------------------------------------------------- */
export function refreshUniversePeriodically() {
  console.log("🌍 [UNIVERSE] Auto-refresh enabled...");

  setInterval(async () => {
    await initUniverse();
  }, CONFIG.system.universeRefreshIntervalMs);
}

/* ---------------------------------------------------------
   Exposed getter (used by engine)
--------------------------------------------------------- */
export function getUniverse() {
  return UNIVERSE;
}
