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

export function initEventHub() {
  console.log("📡 [EVENT-HUB] Initializing...");

  publicEmitter.on("ws", (msg) => {
    if (!msg?.topic || !msg?.data) return;

    const topic = msg.topic;

    // ----------------------
    // TICKER
    // ----------------------
    if (topic.startsWith("tickers.")) {
      const symbol = topic.split(".")[1];
      storeTicker(symbol, msg.data);
      return;
    }

    // ----------------------
    // TRADE FLOW
    // ----------------------
    if (topic.startsWith("publicTrade.")) {
      const symbol = topic.split(".")[1];
      // msg.data is array of trades
      const trade = msg.data[0];
      if (trade) storeTrade(symbol, trade);
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
