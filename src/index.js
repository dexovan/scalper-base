/**
 * src/index.js
 * AI Scalper Engine – Phase 2 (Universe + WS Dynamic Subscription)
 */

import {
  initUniverse,
  refreshUniversePeriodically,
  getSymbolsByCategory
} from "./market/universe.js";

import {
  initPublicConnection,
  subscribeSymbols
} from "./connectors/bybitPublic.js";

import { initEventHub } from "./ws/eventHub.js";

import CONFIG from "./config/index.js";

// EngineMetrics tracking
import metrics from './core/metrics.js';

// WS Metrics Connector (parallel to existing engine WS)
import { BybitPublicWS } from "./connectors/bybit/publicWS.js";


async function startEngine() {
  console.log("====================================================");
  console.log("🚀 AI Scalper Engine – Phase 2 Booting...");
  console.log("====================================================");

  // Engine startup - mark decision and heartbeat
  metrics.markDecision();
  metrics.heartbeat();

  // ---------------------------------------------------------
  // 1. Initial Universe fetch
  // ---------------------------------------------------------
  await initUniverse();

  // ---------------------------------------------------------
  // 2. Initialize Public WS (but don't subscribe yet!)
  // ---------------------------------------------------------
  initPublicConnection();

  // ---------------------------------------------------------
  // 3. Init Event Hub BEFORE subscription
  //    (otherwise WS events arrive with no handlers)
  // ---------------------------------------------------------
  initEventHub();

  // ---------------------------------------------------------
  // 4. Subscribe PRIME symbols
  // ---------------------------------------------------------
  const primeSymbols = getSymbolsByCategory("Prime");

  if (primeSymbols.length > 0) {
    subscribeSymbols(primeSymbols);
    console.log("📡 PRIME subscribed:", primeSymbols);
  } else {
    console.log("⚠️ No PRIME symbols found in universe.");
  }

  // ---------------------------------------------------------
  // 5. Start Background Universe Refresh
  // ---------------------------------------------------------
  refreshUniversePeriodically();

  // ---------------------------------------------------------
  // 6. WS Metrics Connector (parallel - does NOT affect engine)
  // ---------------------------------------------------------
  const wsMetrics = new BybitPublicWS();
  wsMetrics.connect({
    symbols: ["BTCUSDT", "ETHUSDT"], // za početak
    channels: ["tickers", "publicTrade"],
    onEvent: (msg) => {
      // Za sada ne diramo eventHub
      // Ovo samo proverava da WS radi i puni wsMetrics
      // console.log("[BybitWS EVENT]", msg.topic);
    },
  });
  console.log("📊 WS Metrics Connector initialized (parallel mode)");

  // ---------------------------------------------------------
  // Boot Complete
  // ---------------------------------------------------------
  console.log("=====================================================");
  console.log("🌍 Universe service started.");
  console.log("📡 Public WS active.");
  console.log("🧠 AI Event Hub active.");
  console.log("⚡ Engine running normally.");
  console.log("=====================================================");

  // Mark engine as fully initialized
  metrics.heartbeat();
}


startEngine().catch((err) => {
  console.error("❌ ENGINE CRASHED:", err);
  metrics.markError();
});
