// src/ws/eventHub.js
import { publicEmitter } from "../connectors/bybitPublic.js";
import { handleTickerEvent } from "./tickerHub.js";
import { handleTradeEvent } from "./tradeFlow.js";
import { handleOrderbookEvent } from "./orderbookWatcher.js";

export function initEventHub() {
  console.log("📡 [EVENT-HUB] Initializing...");

  publicEmitter.on("ws", (msg) => {
    if (!msg || !msg.topic) return;

    const topic = msg.topic;

    // -----------------------------
    // 1. TICKERS
    // -----------------------------
    if (topic.startsWith("tickers.")) {
      const symbol = topic.split(".")[1];
      handleTickerEvent(symbol, msg);
      return;
    }

    // -----------------------------
    // 2. TRADES
    // -----------------------------
    if (topic.startsWith("publicTrade.")) {
      const symbol = topic.split(".")[1];
      handleTradeEvent(symbol, msg);
      return;
    }

    // -----------------------------
    // 3. ORDERBOOK 50
    // -----------------------------
    if (topic.startsWith("orderbook.50.")) {
      const symbol = topic.split(".")[2];
      handleOrderbookEvent(symbol, msg);
      return;
    }
  });

  console.log("📡 [EVENT-HUB] Ready.");
}
