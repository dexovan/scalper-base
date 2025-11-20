// src/connectors/bybitPublic.js
import WebSocket from "ws";
import EventEmitter from "events";
import CONFIG from "../config/index.js";

// Globalni event emitter za public evente (ticker/trade/heartbeat)
const emitter = new EventEmitter();

// Export za eventHub.js
export const publicEmitter = emitter;

// ============================
// WS STATUS (za health.js)
// ============================
let ws = null;
let manualClose = false;
let reconnectTimer = null;

const wsStatus = {
  connected: false,
  lastConnectedAt: null,
  lastMessageAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  reconnectAttempts: 0,
};

// Exponential backoff parametri (može iz CONFIG, ali ovde default)
const RECONNECT_BASE_MS =
  CONFIG.bybit?.wsReconnectBaseDelayMs ?? 1000; // 1s
const RECONNECT_MAX_MS =
  CONFIG.bybit?.wsReconnectMaxDelayMs ?? 15000; // 15s

// ============================
// Pomocne funkcije
// ============================

function nowISO() {
  return new Date().toISOString();
}

function buildTopics(symbols = []) {
  const topics = [];
  for (const s of symbols) {
    topics.push(`tickers.${s}`);
    topics.push(`publicTrade.${s}`);
  }
  return topics;
}

async function getPrimeSymbols() {
  // First try config override
  if (CONFIG.custom?.primeSymbols) {
    console.log("🎯 Using config override Prime symbols:", CONFIG.custom.primeSymbols);
    return CONFIG.custom.primeSymbols;
  }

  // Try to use Universe v2 Prime symbols
  try {
    const { getSymbolsByCategory } = await import("../market/universe_v2.js");
    const primeSymbols = getSymbolsByCategory("Prime");
    console.log("🔍 Raw Prime symbols from Universe v2:", primeSymbols);

    if (primeSymbols.length > 0) {
      // Extract symbol names from metadata objects
      const symbolNames = primeSymbols.map(s => typeof s === 'string' ? s : s.symbol);
      console.log(`🎯 Using ${symbolNames.length} Prime symbols from Universe v2:`, symbolNames);
      return symbolNames;
    }
  } catch (error) {
    console.warn("⚠️ Could not load Prime symbols from Universe v2:", error.message);
  }

  // Fallback to hardcoded list
  const fallback = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
  console.log("🔄 Using fallback Prime symbols:", fallback);
  return fallback;
}// ============================
// WS CONNECT / RECONNECT
// ============================

function scheduleReconnect() {
  if (manualClose) return;

  wsStatus.reconnectAttempts += 1;
  const attempt = wsStatus.reconnectAttempts;
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, attempt - 1),
    RECONNECT_MAX_MS
  );

  console.log(
    `🔁 [BYBIT-WS] Reconnect attempt #${attempt} in ${delay}ms...`
  );

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    await connectWS();
  }, delay);
}

async function connectWS(symbolsOverride = null) {
  const wsUrl = CONFIG.bybit?.wsPublic || "wss://stream.bybit.com/v5/public/linear";

  console.log("🔍 [DEBUG] connectWS called, symbolsOverride:", symbolsOverride);
  const primeSymbols = symbolsOverride || await getPrimeSymbols();
  console.log("🔍 [DEBUG] Final primeSymbols for WebSocket:", primeSymbols);

  const topics = buildTopics(primeSymbols);

  console.log("📡 [BYBIT-WS] Connecting to:", wsUrl);
  console.log("📡 [BYBIT-WS] Topics:", topics);

  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("🟢 [BYBIT-WS] Connected");
    wsStatus.connected = true;
    wsStatus.lastConnectedAt = nowISO();
    wsStatus.reconnectAttempts = 0;

    // Subscribe na tickers + publicTrade
    const subMsg = {
      op: "subscribe",
      args: topics,
    };

    ws.send(JSON.stringify(subMsg));
    console.log("📡 [BYBIT-WS] Subscribed:", topics);
  });

  ws.on("message", (raw) => {
    wsStatus.lastMessageAt = nowISO();

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    // Bybit ping/pong handling (ako treba)
    if (msg.op === "ping") {
      ws.send(JSON.stringify({ op: "pong" }));
      return;
    }

    // Ako nema topic/data → ignoriši
    if (!msg.topic || !msg.data) return;

    // Primer topic stringova:
    // tickers.BTCUSDT
    // publicTrade.BTCUSDT
    const topic = msg.topic;
    const [kind, symbolRaw] = topic.split(".");
    const symbol = symbolRaw || null;

    if (kind === "tickers" && symbol) {
      // Bybit v5 tickers: msg.data je objekat ili niz; uzimamo prvi ako je niz
      const payload = Array.isArray(msg.data) ? msg.data[0] : msg.data;

      emitter.emit("event", {
        type: "ticker",
        timestamp: nowISO(),
        symbol,
        payload,
      });

    } else if (kind === "publicTrade" && symbol) {
      // publicTrade data je niz trade-ova
      const trades = Array.isArray(msg.data) ? msg.data : [msg.data];

      for (const t of trades) {
        emitter.emit("event", {
          type: "trade",
          timestamp: nowISO(),
          symbol,
          payload: t,
        });
      }
    }
  });

  ws.on("close", (code, reason) => {
    console.log(
      `🔴 [BYBIT-WS] Closed: code=${code}, reason=${reason?.toString()}`
    );
    wsStatus.connected = false;

    if (!manualClose) {
      scheduleReconnect();
    }
  });

  ws.on("error", (err) => {
    console.log("❌ [BYBIT-WS] Error:", err.message);
    wsStatus.lastErrorAt = nowISO();
    wsStatus.lastErrorMessage = err.message;
  });
}

// ============================
// Public API — WS deo
// ============================

/**
 * Inicijalizuje Bybit public WS konekciju (tickers + trades za PRIME simbole).
 * Možeš proslediti custom listu simbola ako želiš.
 */
export async function initPublicConnection(options = {}) {
  if (ws && wsStatus.connected) {
    console.log("ℹ️ [BYBIT-WS] Already connected, skipping init.");
    return;
  }

  manualClose = false;
  wsStatus.reconnectAttempts = 0;

  const symbolsOverride = options.symbols || null;
  await connectWS(symbolsOverride);
}

/**
 * Graceful shutdown — ako treba pri gašenju engine-a.
 */
export function closePublicConnection() {
  manualClose = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) {
    ws.close();
    ws = null;
  }
}

/**
 * Refresh WebSocket subscription with updated Prime symbols.
 */
export async function refreshWebSocketSubscription() {
  console.log("🔄 [BYBIT-WS] Refreshing subscription with updated Prime symbols...");

  // Close existing connection
  closePublicConnection();

  // Wait a moment for clean shutdown
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Reinitialize with updated symbols
  await initPublicConnection();
}

/**
 * Hook za druge module (Universe, Metrics, itd.)
 * callback({ type, timestamp, symbol, payload })
 */
export function onPublicEvent(callback) {
  emitter.on("event", callback);
}

/**
 * Health integracija — vraća trenutni WS status.
 */
export function getWsStatus() {
  return { ...wsStatus };
}

// ============================
// REST: Instruments (USDT Perp)
// ============================

/**
 * Fetch USDT perpetual instrumenta sa Bybit-a.
 * Koristi Bybit v5 /v5/market/instruments-info endpoint.
 */
export async function fetchInstrumentsUSDTPerp() {
  const restBase = CONFIG.bybit?.restBase || "https://api.bybit.com";

  const url = `${restBase}/v5/market/instruments-info?category=linear`;

  const fetchedAt = nowISO();

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();

    if (json.retCode !== 0) {
      throw new Error(`Bybit error: ${json.retMsg} (${json.retCode})`);
    }

    const list = json.result?.list ?? [];

    const symbols = list.map((item) => {
      const symbol = item.symbol;
      const baseAsset = item.baseCoin || item.baseAsset || null;
      const quoteAsset = item.quoteCoin || item.quoteAsset || "USDT";
      const contractType = item.contractType || item.contractType || "LinearPerpetual";
      const status = item.status || "Unknown";

      const tickSize =
        Number(item.priceFilter?.tickSize ?? item.priceFilter?.tick_size ?? 0);
      const minOrderQty =
        Number(
          item.lotSizeFilter?.minOrderQty ??
          item.lotSizeFilter?.min_trading_qty ??
          0
        );
      const lotSize =
        Number(
          item.lotSizeFilter?.qtyStep ??
          item.lotSizeFilter?.qty_step ??
          0
        );
      const maxLeverage =
        Number(item.leverageFilter?.maxLeverage ?? item.maxLeverage ?? 0);

      return {
        symbol,
        baseAsset,
        quoteAsset,
        contractType,
        status,
        tickSize,
        minOrderQty,
        lotSize,
        maxLeverage,
        raw: item,
      };
    });

    return {
      success: true,
      fetchedAt,
      symbols,
    };
  } catch (err) {
    console.error("❌ [BYBIT-REST] fetchInstrumentsUSDTPerp failed:", err.message);
    return {
      success: false,
      fetchedAt,
      symbols: [],
      error: err.message,
    };
  }
}

// ============================
// MISSING FUNCTIONS FOR INDEX.JS COMPATIBILITY
// ============================

/**
 * Subscribe to symbols (called from index.js)
 */
export function subscribeSymbols(symbols = []) {
  if (!Array.isArray(symbols)) return;

  for (const symbol of symbols) {
    // Add to subscriptions for main WS
    if (ws && wsStatus.connected) {
      const topics = [
        `tickers.${symbol}`,
        `publicTrade.${symbol}`,
        `orderbook.50.${symbol}`
      ];

      try {
        ws.send(JSON.stringify({ op: "subscribe", args: topics }));
        console.log(`📡 [BYBIT-WS] Subscribed to ${symbol}:`, topics);
      } catch (err) {
        console.error(`❌ [BYBIT-WS] Subscribe ${symbol} failed:`, err.message);
      }
    }
  }
}
