/* =========================================================
   src/market/universe.js
   AI Scalper – Universe Service (REFABRIKOVANO, stabilno)
   ========================================================= */

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import CONFIG from "../config/index.js";
import paths from "../config/paths.js";

const UNIVERSE_FILE = path.join(paths.SYSTEM_DIR, "universe.json");

/* ---------------------------------------------------------
   IN-MEMORY CACHE
--------------------------------------------------------- */
let UNIVERSE = {
  fetchedAt: null,
  symbols: [],
  totalSymbols: 0,
  prime: [],
  normal: [],
  wild: []
};

/* ---------------------------------------------------------
   Save universe to disk
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
   Categorization logic
--------------------------------------------------------- */
function categorizeSymbol(item) {
  const symbol = item.symbol;

  // PRIME: ručna lista definisana u configu
  if (CONFIG.primeSymbols.includes(symbol)) return "prime";

  // WILD heuristika – na osnovu volumena i cene
  const vol = Number(item.volume24h || 0);
  const price = Number(item.lastPrice || 0);

  if (vol < 1_000_000) return "wild";     // niska likvidnost
  if (price < 0.0001) return "wild";      // micro-coini
  if (symbol.includes("1000") || symbol.includes("10000")) return "wild";

  return "normal";
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

    if (!json || !json.result || !Array.isArray(json.result.list)) {
      console.error("❌ [UNIVERSE] Bad response:", json);
      return;
    }

    const list = json.result.list;

    const prime = [];
    const normal = [];
    const wild = [];

    for (const item of list) {
      const cat = categorizeSymbol(item);

      if (cat === "prime") prime.push(item.symbol);
      else if (cat === "wild") wild.push(item.symbol);
      else normal.push(item.symbol);
    }

    UNIVERSE = {
      fetchedAt: new Date().toISOString(),
      symbols: list.map(s => s.symbol),
      totalSymbols: list.length,
      prime,
      normal,
      wild
    };

    saveUniverseToDisk();

    console.log(
      `🌍 [UNIVERSE] Loaded ${UNIVERSE.totalSymbols} symbols → P:${prime.length} N:${normal.length} W:${wild.length}`
    );

  } catch (err) {
    console.error("❌ [UNIVERSE] Error during fetch:", err);
  }
}

/* ---------------------------------------------------------
   Auto-refresh (uses configured interval)
--------------------------------------------------------- */
export function refreshUniversePeriodically() {
  console.log("🌍 [UNIVERSE] Auto-refresh enabled...");

  setInterval(async () => {
    await initUniverse();
  }, CONFIG.system.universeRefreshIntervalMs);
}

/* ---------------------------------------------------------
   Exposed getter
--------------------------------------------------------- */
export function getUniverse() {
  return UNIVERSE;
}
