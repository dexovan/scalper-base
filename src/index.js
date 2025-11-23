/**
 * src/index.js
 * AI Scalper Engine – Phase 2 (Universe + WS Dynamic Subscription)
 */

import {
  initUniverse,
  refreshUniversePeriodically,
  getSymbolsByCategory,
  getUniverseSnapshot
} from "./market/universe_v2.js";

import {
  initPublicConnection,
  onPublicEvent
} from "./connectors/bybitPublic.js";

import { publicEmitter } from "./connectors/bybitPublic.js";

import { initEventHub } from "./ws/eventHub.js";

import { saveTicker, saveTrade, getStorageStats } from "./utils/dataStorage.js";

import CONFIG from "./config/index.js";

import metrics from "./core/metrics.js";

// WS metrics – shared module
import * as wsMetrics from "./monitoring/wsMetrics.js";

// Parallel metrics WS connector (stable)
import { BybitPublicWS } from "./connectors/bybit/publicWS.js";

// Phase 2 VARIJANTA B - Event handling for parsed ticker/trade data

// Monitor API server (Opcija A)
import { startMonitorApiServer, attachRealtimeListeners } from "./http/monitorApi.js";

async function startEngine() {
  console.log("====================================================");
  console.log("🚀 AI Scalper Engine – Phase 2 Booting...");
  console.log("📁 KORAK 2: File Storage Implementation Active!");
  console.log("====================================================");

  console.log("🔍 DEBUG: About to initialize Universe and WebSocket...");

  metrics.markDecision();
  metrics.heartbeat();

  // --------------------------
  // UNIVERSE INIT
  // --------------------------
  console.log("🌍 [ENGINE] About to call initUniverse()...");
  await initUniverse();
  console.log("🌍 [ENGINE] initUniverse() completed!");

  // Verify universe loaded
  const universeCheck = await getUniverseSnapshot();
  console.log("🌍 [ENGINE] Universe verification:", {
    totalSymbols: universeCheck?.stats?.totalSymbols || 0,
    fetchedAt: universeCheck?.fetchedAt || 'N/A',
    symbolCount: Object.keys(universeCheck?.symbols || {}).length
  });

  // MAIN WS (dynamic)
  console.log("🔍 DEBUG: Calling initPublicConnection...");
  await initPublicConnection(); // koristi CONFIG.custom.primeSymbols

  console.log("🔍 DEBUG: Initializing EventHub...");
  initEventHub();

  const primeSymbols = getSymbolsByCategory("Prime");
  if (primeSymbols.length > 0) {
    subscribeSymbols(primeSymbols);
    console.log("📡 PRIME subscribed:", primeSymbols);
  }

  // =====================================================
  // PHASE 2 VARIJANTA B - EVENT HANDLER
  // =====================================================
  onPublicEvent((evt) => {
    // evt = { type: "ticker" | "trade", timestamp, symbol, payload }

    if (evt.type === "ticker") {
      // FULLY DISABLED: Console.log spam fills logs at 50,000+ logs/second = GIGABYTES/hour!
      // Even 0.01% sampling still generates too many logs (193MB in minutes!)
      // All ticker processing happens silently now

      // const lastPrice = evt.payload.lastPrice || evt.payload.price || "";
      // console.log("[TICKER]", evt.symbol, lastPrice);

      // DISABLED: Tickers disk storage fills disk too fast
      // KORAK 2: Save ticker data to CSV file
      // saveTicker(evt.symbol, evt.payload);

    } else if (evt.type === "trade") {
      // FULLY DISABLED: Console.log spam fills logs at hundreds of logs/second!
      // Even 0.1% sampling still generates too many logs (193MB in minutes!)
      // All trade processing happens silently now

      // const side = evt.payload.S;
      // const price = evt.payload.p;
      // const qty = evt.payload.v;
      // const tickDir = evt.payload.L;
      // console.log("[TRADE]", evt.symbol, `${side} at $${price} (size: ${qty}) [${tickDir}]`);

      // DISABLED: Trades disk storage fills disk too fast (15GB+ in days!)
      // KORAK 2: Save trade data to CSV file
      // saveTrade(evt.symbol, evt.payload);
    }
  });

  // DISABLED: Universe refresh writes to disk every 15s (500+ symbols × 1KB = 500KB+ per write = 2MB/min = 2.9GB/day!)
  // refreshUniversePeriodically();
  console.log("⚠️ [ENGINE] Universe periodic refresh DISABLED - preventing disk fill");

  // KORAK 2: Display storage stats
  const storageStats = await getStorageStats();
  if (storageStats) {
    console.log("📁 Data Storage Stats:");
    console.log(`   Date: ${storageStats.date}`);
    console.log(`   Ticker files: ${storageStats.todayFiles?.tickers || 0}`);
    console.log(`   Trade files: ${storageStats.todayFiles?.trades || 0}`);
    console.log(`   Ticker size: ${(storageStats.todaySizes?.tickers / 1024).toFixed(1)} KB`);
    console.log(`   Trade size: ${(storageStats.todaySizes?.trades / 1024).toFixed(1)} KB`);
  }

  console.log("=====================================================");
  console.log("🌍 Universe service started.");
  console.log("📡 Public WS active.");
  console.log("🧠 AI Event Hub active.");
  console.log("💾 File Storage active.");
  console.log("⚡ Engine running normally.");

  // =====================================================
  // METRICS-WEBSOCKET INSTANCE
  // =====================================================
  console.log("=============================");
  console.log("📡 METRICS: Creating WS...");
  console.log("=============================");

  const metricsWS = new BybitPublicWS();

  console.log("📡 METRICS: Calling connect() now...");

  metricsWS.connect({
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],
    channels: ["tickers", "publicTrade"],

    // MUST HAVE THE RAW MESSAGE
    onEvent: (msg) => {
      wsMetrics.wsMarkMessage();

      // OPTIONAL DEBUG
      // console.log("[METRICS-WS] EVENT:", msg.topic);
    }
  });

  console.log("📡 [WS-METRICS] Connector launched with topics:", metricsWS.subscriptions);

  console.log("⚡ Engine running normally.");

  console.log("🚀 DEBUG: Ready to start Monitor API…");

  // Attach real-time listeners for dashboard
  console.log("🔗 DEBUG: About to call attachRealtimeListeners with publicEmitter:", typeof publicEmitter);
  attachRealtimeListeners(publicEmitter);
  console.log("📡 Real-time dashboard listeners attached");

  startMonitorApiServer(8090);
  console.log("🚀 DEBUG: Monitor API successfully started");

  metrics.heartbeat();
}

startEngine().catch((err) => {
  console.error("❌ ENGINE CRASHED:", err);
  metrics.markError();
});
