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
  subscribeSymbols,
  onPublicEvent
} from "./connectors/bybitPublic.js";

import { initEventHub } from "./ws/eventHub.js";

import CONFIG from "./config/index.js";

import metrics from "./core/metrics.js";

// WS metrics – shared module
import * as wsMetrics from "./monitoring/wsMetrics.js";

// Parallel metrics WS connector (stable)
import { BybitPublicWS } from "./connectors/bybit/publicWS.js";

// Phase 2 VARIJANTA B - Event handling for parsed ticker/trade data

// Monitor API server (Opcija A)
import { startMonitorApiServer } from "./http/monitorApi.js";

async function startEngine() {
  console.log("====================================================");
  console.log("🚀 AI Scalper Engine – Phase 2 Booting...");
  console.log("====================================================");

  metrics.markDecision();
  metrics.heartbeat();

  // --------------------------
  // UNIVERSE INIT
  // --------------------------
  await initUniverse();

  // MAIN WS (dynamic)
  initPublicConnection(); // koristi CONFIG.custom.primeSymbols

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

    // Ovde ZA SADA samo log, kasnije ćemo:
    // - slati u metrics
    // - graditi microstructure
    // - puniti profile itd.
    if (evt.type === "ticker") {
      console.log("[TICKER]", evt.symbol, evt.payload.lastPrice || evt.payload.price || "");
    } else if (evt.type === "trade") {
      // DEBUG: Vidimo šta tačno šalje Bybit
      console.log("[TRADE-RAW]", evt.symbol, "payload:", JSON.stringify(evt.payload, null, 2));

      // Pokušaj različitih naziva polja
      const side = evt.payload.side || evt.payload.S || evt.payload.direction;
      const price = evt.payload.price || evt.payload.p || evt.payload.execPrice;
      const qty = evt.payload.qty || evt.payload.v || evt.payload.size || evt.payload.execQty;

      console.log("[TRADE]", evt.symbol, `${side} at $${price} (size: ${qty})`);
    }
  });

  refreshUniversePeriodically();

  console.log("=====================================================");
  console.log("🌍 Universe service started.");
  console.log("📡 Public WS active.");
  console.log("🧠 AI Event Hub active.");
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
  startMonitorApiServer(8090);
  console.log("🚀 DEBUG: Monitor API successfully started");

  metrics.heartbeat();
}

startEngine().catch((err) => {
  console.error("❌ ENGINE CRASHED:", err);
  metrics.markError();
});
