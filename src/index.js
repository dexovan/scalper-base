/**
 * src/index.js
 * AI Scalper Engine – Phase 2 (Universe + WS dynamic subscription)
 */

import {
  initUniverse,
  refreshUniversePeriodically,
  getUniverseSnapshot,
  getSymbolsByCategory
} from "./market/universe.js";

import {
  initPublicConnection,
  subscribeSymbols
} from "./connectors/bybitPublic.js";

import CONFIG from "./config/index.js";

async function startEngine() {
  console.log("🚀 Starting AI Scalper Engine...");

  // 1. Initial Universe fetch
  await initUniverse();

  // 2. Start WS
  initPublicConnection();

  // 3. Subscribe PRIME symbols on startup
  const primeSymbols = getSymbolsByCategory("Prime");

  if (primeSymbols.length > 0) {
    subscribeSymbols(primeSymbols);
    console.log("📡 Subscribed PRIME:", primeSymbols);
  } else {
    console.log("⚠️ No PRIME symbols detected!");
  }

  // 4. Start periodic refresh
  refreshUniversePeriodically();

  console.log("🌍 Universe service started.");
  console.log("📡 Public WS active.");
  console.log("🧠 AI Engine running.");
}

startEngine().catch((err) => {
  console.error("❌ Engine crashed:", err);
});
