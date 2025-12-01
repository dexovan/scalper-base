// =======================================================
// src/ws/eventHub.js
// UNIVERSAL WS EVENT DISPATCHER → storage.js
// =======================================================

import { publicEmitter } from "../connectors/bybitPublic.js";
import {
  storeTicker,
  storeTrade,
  storeOrderbook
} from "./storage.js";

// EngineMetrics tracking
import metrics from '../core/metrics.js';

// Risk Engine for price updates
import * as riskEngine from '../risk/riskEngine.js';

export function initEventHub() {
  console.log("📡 [EVENT-HUB] Initializing...");

  publicEmitter.on("ws", (msg) => {
    if (!msg?.topic || !msg?.data) return;

    const topic = msg.topic;

    // Track WS message processing as decisions and heartbeat
    metrics.markDecision();
    metrics.heartbeat();

    // ----------------------
    // TICKER
    // ----------------------
    if (topic.startsWith("tickers.")) {
      const symbol = topic.split(".")[1];
      // DISABLED: Ticker disk storage fills disk too fast
      // storeTicker(symbol, msg.data);

      // 🔥 CRITICAL: Update price for TP/SL/Quick TP checks!
      if (msg.data?.lastPrice) {
        const price = Number(msg.data.lastPrice);
        try {
          riskEngine.onPriceTickForSymbol(symbol, price);
        } catch (err) {
          console.error(`[EventHub] Error processing price tick for ${symbol}: ${err.message}`);
        }
      }
      return;
    }

    // ----------------------
    // TRADE FLOW
    // ----------------------
    if (topic.startsWith("publicTrade.")) {
      const symbol = topic.split(".")[1];
      // msg.data is array of trades
      const trade = msg.data[0];
      if (trade) {
        storeTrade(symbol, trade);
        metrics.markTradeExecuted(); // Track trade data received
      }
      return;
    }

    // ----------------------
    // ORDERBOOK 50
    // ----------------------
    if (topic.startsWith("orderbook.50.")) {
      const symbol = topic.split(".")[2];
      storeOrderbook(symbol, msg.data);
      return;
    }
  });

  console.log("📡 [EVENT-HUB] Ready.");
}
