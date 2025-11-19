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

import metrics from './core/metrics.js';

// WS metrics – load all functions as one shared module
import * as wsMetrics from "./monitoring/wsMetrics.js";

// Parallel metrics WS connector
import { BybitPublicWS } from "./connectors/bybit/publicWS.js";


async function startEngine() {
  console.log("====================================================");
  console.log("🚀 AI Scalper Engine – Phase 2 Booting...");
  console.log("====================================================");

  metrics.markDecision();
  metrics.heartbeat();

  await initUniverse();

  // MAIN WS (dynamic subscription)
  initPublicConnection();

  initEventHub();

  const primeSymbols = getSymbolsByCategory("Prime");
  if (primeSymbols.length > 0) {
    subscribeSymbols(primeSymbols);
    console.log("📡 PRIME subscribed:", primeSymbols);
  }

  refreshUniversePeriodically();

  console.log("=====================================================");
  console.log("🌍 Universe service started.");
  console.log("📡 Public WS active.");
  console.log("🧠 AI Event Hub active.");
  console.log("⚡ Engine running normally.");


  // -------------------------------------------------------
  //   WS-METRICS CONNECTOR – fixed shared instance
  // -------------------------------------------------------
  console.log("=============================");
  console.log("📡 METRICS: Creating WS...");
  console.log("=============================");

  const metricsWS = new BybitPublicWS();

  console.log("📡 METRICS: Calling connect() now...");
  metricsWS.connect({
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],
    channels: ["tickers", "publicTrade"],
    onEvent: () => wsMetrics.wsMarkMessage()
  });

  console.log("📡 [WS-METRICS] Connector launched with topics:", metricsWS.subscriptions);
  console.log("=====================================================");

  metrics.heartbeat();
}

startEngine().catch((err) => {
  console.error("❌ ENGINE CRASHED:", err);
  metrics.markError();
});
