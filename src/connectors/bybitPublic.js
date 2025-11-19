// =======================================================
// src/connectors/bybitPublic.js
// FULL PUBLIC WS CONNECTOR (SET C: tickers + trades + ob50)
// Phase 2.4 – Dynamic Subscription Architecture
// =======================================================

import WebSocket from "ws";
import EventEmitter from "events";
import fetch from "node-fetch";
import CONFIG from "../config/index.js";

// -----------------------------------------------
// REST: fetchInstrumentsUSDTPerp  (TVOJ POSTOJEĆI KOD)
// -----------------------------------------------
export async function fetchInstrumentsUSDTPerp() {
  const endpoint = `${CONFIG.bybit.restBase}/v5/market/instruments-info`;
  const url = `${endpoint}?category=linear`;

  const fetchedAt = new Date().toISOString();

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return {
        success: false,
        fetchedAt,
        symbols: [],
        error: `HTTP ${res.status}`,
      };
    }

    const data = await res.json();

    if (data.retCode !== 0) {
      return {
        success: false,
        fetchedAt,
        symbols: [],
        error: `Bybit error: ${data.retMsg}`,
      };
    }

    const items = data.result.list || [];

    const mapped = items
      .filter((i) => i.quoteCoin === "USDT" && i.contractType === "LinearPerpetual")
      .map((i) => {
        return {
          symbol: i.symbol,
          baseAsset: i.baseCoin,
          quoteAsset: i.quoteCoin,
          contractType: i.contractType,
          status: i.status,
          tickSize: Number(i.priceFilter?.tickSize || 0),
          minOrderQty: Number(i.lotSizeFilter?.minOrderQty || 0),
          lotSize: Number(i.lotSizeFilter?.qtyStep || 0),
          maxLeverage: Number(i.leverageFilter?.maxLeverage || 1),
          raw: i,
        };
      });

    return {
      success: true,
      fetchedAt,
      symbols: mapped,
    };
  } catch (err) {
    return {
      success: false,
      fetchedAt,
      symbols: [],
      error: err.message,
    };
  }
}

// =======================================================
// WS PART (Dynamic Subscription)
// =======================================================

// Global emitter – Engine, Universe, OrderbookWatcher slušaju ovde
export const publicEmitter = new EventEmitter();

// WS status for health system
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

// Topic builder
function buildTopics(symbol) {
  return [
    // SET C FULL MICROSTRUCTURE
    { topic: `tickers.${symbol}` },
    { topic: `publicTrade.${symbol}` },
    { topic: `orderbook.50.${symbol}` },
  ];
}

// Send safely (if connected)
function wsSend(obj) {
  if (WS.socket && WS.connected) {
    WS.socket.send(JSON.stringify(obj));
  }
}

// ==============================================================
// Subscribe / Unsubscribe
// ==============================================================

export function subscribeSymbols(symbols = []) {
  if (!Array.isArray(symbols)) return;

  for (const s of symbols) {
    SUBS.tickers.add(s);
    SUBS.trades.add(s);
    SUBS.orderbook.add(s);
  }

  if (WS.connected) {
    const topics = symbols.flatMap(buildTopics);
    wsSend({ op: "subscribe", args: topics.map(t => t.topic) });
    console.log("📡 WS SUBSCRIBED:", topics.map(t => t.topic));
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
    wsSend({ op: "unsubscribe", args: topics.map(t => t.topic) });
    console.log("📡 WS UNSUBSCRIBED:", topics.map(t => t.topic));
  }
}

// ==============================================================
// Reconnect
// ==============================================================
function scheduleReconnect() {
  WS.reconnectAttempts++;

  const delay = Math.min(
    CONFIG.bybit.wsReconnectDelayMs * WS.reconnectAttempts,
    15000
  );

  console.log(`🔁 WS reconnect in ${delay}ms...`);

  setTimeout(() => {
    initPublicConnection();
  }, delay);
}

// ==============================================================
// INIT WS
// ==============================================================
export function initPublicConnection() {
  const url = CONFIG.bybit.wsPublic;

  console.log("🔌 Connecting to Bybit Public WS:", url);

  if (WS.socket) {
    try {
      WS.socket.close();
    } catch {}
  }

  const ws = new WebSocket(url);
  WS.socket = ws;

  ws.on("open", () => {
    WS.connected = true;
    WS.lastConnectedAt = new Date().toISOString();
    WS.reconnectAttempts = 0;

    console.log("🟢 WS CONNECTED");

    // Re-subscribe active topics
    const allSymbols = new Set([
      ...SUBS.tickers,
      ...SUBS.trades,
      ...SUBS.orderbook,
    ]);

    const topics = [...allSymbols].flatMap(buildTopics);
    if (topics.length > 0) {
      wsSend({ op: "subscribe", args: topics.map(t => t.topic) });
      console.log("📡 WS RESTORED SUBSCRIPTIONS:", topics.map(t => t.topic));
    }
  });

  ws.on("message", (raw) => {
    WS.lastMessageAt = new Date().toISOString();

    try {
      const msg = JSON.parse(raw);

      // Emit for Engine, OrderbookWatcher, TickFlow
      publicEmitter.emit("ws", msg);

    } catch (err) {
      console.error("❌ WS parse error:", err);
    }
  });

  ws.on("error", (err) => {
    WS.lastErrorAt = new Date().toISOString();
    WS.lastErrorMessage = err.message;
    console.error("❌ WS ERROR:", err.message);
  });

  ws.on("close", () => {
    WS.connected = false;
    console.log("🔴 WS DISCONNECTED");
    scheduleReconnect();
  });
}

// ==============================================================
// GETTER for health monitor
// ==============================================================
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
