// =======================================================
// src/connectors/bybitPublic.js
// FULL PUBLIC WS CONNECTOR – SET C (tickers, trades, ob50)
// Phase 2.4 – Dynamic Subscription Architecture
// =======================================================

import WebSocket from "ws";
import EventEmitter from "events";
import fetch from "node-fetch";
import CONFIG from "../config/index.js";

export const publicEmitter = new EventEmitter();

// -------------------------------------------------------
// WS STATE
// -------------------------------------------------------
let WS = {
  socket: null,
  connected: false,
  lastConnectedAt: null,
  lastMessageAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  reconnectAttempts: 0,
};

// Active subscriptions
const SUBS = {
  tickers: new Set(),
  trades: new Set(),
  orderbook: new Set(),
};

// -------------------------------------------------------
// Topic builder for Bybit SET C
// -------------------------------------------------------
function buildTopics(symbol) {
  return [
    `tickers.${symbol}`,
    `publicTrade.${symbol}`,
    `orderbook.50.${symbol}`,
  ];
}

// -------------------------------------------------------
// Safe WS send
// -------------------------------------------------------
function wsSend(obj) {
  if (WS.connected && WS.socket) {
    WS.socket.send(JSON.stringify(obj));
  }
}

// -------------------------------------------------------
// Subscribe / Unsubscribe
// -------------------------------------------------------
export function subscribeSymbols(symbols = []) {
  if (!Array.isArray(symbols)) return;

  for (const s of symbols) {
    SUBS.tickers.add(s);
    SUBS.trades.add(s);
    SUBS.orderbook.add(s);
  }

  if (WS.connected) {
    const topics = symbols.flatMap(buildTopics);
    wsSend({ op: "subscribe", args: topics });
    console.log("📡 WS SUBSCRIBED:", topics);
  }
}

export function unsubscribeSymbols(symbols = []) {
  if (!Array.isArray(symbols)) return;

  for (const s of symbols) {
    SUBS.tickers.delete(s);
    SUBS.trades.delete(s);
    SUBS.orderbook.delete(s);
  }

  if (WS.connected) {
    const topics = symbols.flatMap(buildTopics);
    wsSend({ op: "unsubscribe", args: topics });
    console.log("📡 WS UNSUBSCRIBED:", topics);
  }
}

// -------------------------------------------------------
// Reconnect logic
// -------------------------------------------------------
function scheduleReconnect() {
  WS.reconnectAttempts++;
  const delay = Math.min(
    CONFIG.bybit.wsReconnectDelayMs * WS.reconnectAttempts,
    15000
  );

  console.log(`🔁 WS reconnect in ${delay}ms...`);
  setTimeout(() => initPublicConnection(), delay);
}

// -------------------------------------------------------
// INIT WS
// -------------------------------------------------------
export function initPublicConnection() {
  const url = CONFIG.bybit.wsPublic;
  console.log("🔌 Connecting to Bybit Public WS:", url);

  // clean old socket
  if (WS.socket) {
    try { WS.socket.close(); } catch {}
  }

  const ws = new WebSocket(url);
  WS.socket = ws;

  // -------------------------------------
  // OPEN
  // -------------------------------------
  ws.on("open", () => {
    WS.connected = true;
    WS.lastConnectedAt = new Date().toISOString();
    WS.reconnectAttempts = 0;

    console.log("🟢 WS CONNECTED");

    // restore subscriptions
    const topics = [
      ...new Set([
        ...SUBS.tickers,
        ...SUBS.trades,
        ...SUBS.orderbook
      ])
    ].flatMap(buildTopics);

    if (topics.length > 0) {
      wsSend({ op: "subscribe", args: topics });
      console.log("📡 WS RESTORED SUBSCRIPTIONS:", topics);
    }
  });

  // -------------------------------------
  // MESSAGE – forward to EventHub
  // -------------------------------------
  ws.on("message", (raw) => {
    WS.lastMessageAt = new Date().toISOString();

    try {
      const msg = JSON.parse(raw);
      if (msg?.topic) {
        publicEmitter.emit("ws", msg);   // CENTRAL DISPATCH
      }
    } catch (err) {
      console.error("❌ WS parse error:", err);
    }
  });

  // -------------------------------------
  // ERROR
  // -------------------------------------
  ws.on("error", (err) => {
    WS.lastErrorAt = new Date().toISOString();
    WS.lastErrorMessage = err.message;
    console.error("❌ WS ERROR:", err.message);
  });

  // -------------------------------------
  // CLOSE
  // -------------------------------------
  ws.on("close", () => {
    WS.connected = false;
    console.log("🔴 WS DISCONNECTED");
    scheduleReconnect();
  });
}

// -------------------------------------------------------
// HEALTH
// -------------------------------------------------------
export function getWsStatus() {
  return {
    connected: WS.connected,
    lastConnectedAt: WS.lastConnectedAt,
    lastMessageAt: WS.lastMessageAt,
    lastErrorAt: WS.lastErrorAt,
    lastErrorMessage: WS.lastErrorMessage,
    reconnectAttempts: WS.reconnectAttempts,
  };
}
