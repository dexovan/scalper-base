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

  // 🔥 CRITICAL: Listen to "event" (not "ws" which never happens)
  // index.js emits publicEmitter.emit("event", {type: "ticker", ...})
  publicEmitter.on("event", (eventObj) => {
    // Convert from new format to old format for compatibility
    // Event format from index.js: {type: "ticker", symbol, payload: msg.data, timestamp}
    // Convert to: {topic: "tickers.SYMBOL", data: msg.data}

    if (eventObj?.symbol === "LTCUSDT") {
      console.log(`[EventHub] 📨 Received event for LTC: type=${eventObj.type}, payload keys=${Object.keys(eventObj.payload || {}).join(',')}`);
    }

    if (!eventObj?.type) return;

    let msg = null;
    if (eventObj.type === "ticker") {
      msg = {
        topic: `tickers.${eventObj.symbol}`,
        data: eventObj.payload,
        type: "delta"
      };

      // Debug: log ticker data structure
      if (eventObj.symbol === "LTCUSDT") {
        console.log(`[EventHub] 🔍 LTC ticker data:`, JSON.stringify(msg.data).substring(0, 200));
      }
    } else if (eventObj.type === "trade") {
      msg = {
        topic: `publicTrade.${eventObj.symbol}`,
        data: eventObj.payload,
        type: "delta"
      };
    } else {
      return;
    }

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
