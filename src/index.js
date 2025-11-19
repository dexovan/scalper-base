/**
 * src/index.js
 * AI Scalper Engine – Phase 1 (Universe + periodic refresh)
 */

import {
  initUniverse,
  refreshUniversePeriodically
} from "./market/universe.js";

import CONFIG from "./config/index.js";

async function startEngine() {
  console.log("🚀 Starting AI Scalper Engine...");

  // 1. Initial Universe fetch
  await initUniverse();

  // 2. Start periodic background refresh
  refreshUniversePeriodically();

  console.log("🌍 Universe service started.");
  console.log("✅ Engine running");
}

startEngine().catch((err) => {
  console.error("❌ Engine crashed:", err);
});
