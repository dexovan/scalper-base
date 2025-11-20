// src/connectors/bybitPublic.js
import WebSocket from "ws";
import EventEmitter from "events";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import CONFIG from "../config/index.js";
import * as OrderbookManager from "../microstructure/OrderbookManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data");
const TICKER_FILE = path.join(DATA_DIR, "latest_tickers.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory ticker storage
const latestTickers = new Map();
const latestTradePrices = new Map(); // Track latest trade prices for fallback

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
    topics.push(`orderbook.1.${s}`); // L1 orderbook data
  }
  return topics;
}

// Write ticker data to shared file
function writeTickersToFile() {
  try {
    const tickerData = {};
    latestTickers.forEach((ticker, symbol) => {
      tickerData[symbol] = ticker;
    });

    fs.writeFileSync(TICKER_FILE, JSON.stringify(tickerData, null, 2));
    console.log(`📝 Wrote ${Object.keys(tickerData).length} tickers to file`);
  } catch (error) {
    console.error("❌ Error writing ticker file:", error.message);
  }
}

async function getAllSymbols() {
  // First try config override (backward compatibility)
  if (CONFIG.custom?.primeSymbols) {
    console.log("🎯 Using config override Prime symbols:", CONFIG.custom.primeSymbols);
    return CONFIG.custom.primeSymbols;
  }

  // Try to use Universe v2 Prime + Normal symbols with smart selection for scalping
  try {
    const { getSymbolsByCategory } = await import("../market/universe_v2.js");

    // Get Prime symbols (always include)
    const primeSymbols = await getSymbolsByCategory("Prime");
    console.log("🔍 Raw Prime symbols from Universe v2:", primeSymbols.length);

    // Get Normal symbols for smart selection
    const normalSymbols = await getSymbolsByCategory("Normal");
    console.log("🔍 Raw Normal symbols from Universe v2:", normalSymbols.length);

    // Smart selection for scalping - prioritize by known high-volume/volatile pairs
    const scalpingPrioritySymbols = [
      // Major volume leaders
      "SOLUSDT", "XRPUSDT", "DOGEUSDT", "PEPEUSDT", "SHIBUSDT",
      // DeFi high movers
      "UNIUSDT", "AAVEUSDT", "COMPUSDT", "SUSHIUSDT", "1INCHUSDT",
      // Layer 1s with volume
      "MATICUSDT", "FTMUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT",
      // Memes with volatility
      "FLOKIUSDT", "BONKUSDT", "WIFUSDT", "BOMEUSDT", "RENDERUSDT",
      // AI & Gaming tokens
      "FETUSDT", "AGIXUSDT", "SANDUSDT", "MANAUSDT", "AXSUSDT",
      // Recent hot tokens
      "ARBUSDT", "OPUSDT", "SUIUSDT", "TAIUSDT", "JUPUSDT"
    ];

    // Create priority-based selection for scalping
    const allNormalSymbolNames = normalSymbols.map(s => typeof s === 'string' ? s : s.symbol);

    // Step 1: Find priority symbols that exist in our universe
    const availablePrioritySymbols = scalpingPrioritySymbols.filter(symbol =>
      allNormalSymbolNames.includes(symbol)
    );

    // Step 2: Get remaining symbols (exclude priority ones)
    const remainingSymbols = allNormalSymbolNames.filter(symbol =>
      !scalpingPrioritySymbols.includes(symbol)
    );

    // Step 3: Create final selection - priority first, then fill remaining slots
    const targetNormalCount = 294;
    const scalpingOrderedSymbols = [
      ...availablePrioritySymbols, // Priority symbols first
      ...remainingSymbols.slice(0, targetNormalCount - availablePrioritySymbols.length) // Fill remaining
    ];

    // Step 4: Convert back to metadata objects for consistency
    const selectedNormals = scalpingOrderedSymbols.map(symbolName =>
      normalSymbols.find(s => (typeof s === 'string' ? s : s.symbol) === symbolName)
    ).filter(Boolean).slice(0, targetNormalCount);    const allSymbols = [...primeSymbols, ...selectedNormals];

    if (allSymbols.length > 0) {
      // Extract symbol names from metadata objects
      const symbolNames = allSymbols.map(s => typeof s === 'string' ? s : s.symbol);
      console.log(`🎯 Using ${symbolNames.length} symbols for SCALPING (${primeSymbols.length} Prime + ${selectedNormals.length} Normal):`);
      console.log(`📈 Priority symbols included: ${availablePrioritySymbols.length}/${scalpingPrioritySymbols.length}`);
      console.log(`🔥 Top symbols (priority first):`, symbolNames.slice(0, 20), '...');
      return symbolNames;
    }
  } catch (error) {
    console.warn("⚠️ Could not load symbols from Universe v2:", error.message);
  }

  // Fallback to hardcoded list
  const fallback = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
  console.log("🔄 Using fallback symbols:", fallback);
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
  const allSymbols = symbolsOverride || await getAllSymbols();
  console.log("🔍 [DEBUG] Final symbols for WebSocket:", allSymbols.length, 'symbols');

  const topics = buildTopics(allSymbols);

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

      // Store ticker data for Monitor API
      let price = parseFloat(payload.lastPrice || payload.price || 0);

      // If ticker price is 0 or null, use latest trade price as fallback
      if (price === 0 && latestTradePrices.has(symbol)) {
        price = latestTradePrices.get(symbol);
        console.log(`🔄 Using trade price fallback for ${symbol}: $${price}`);
      }

      const tickerData = {
        symbol,
        price: price,
        change24h: parseFloat(payload.price24hPcnt || 0) * 100,
        volume24h: parseFloat(payload.volume24h || 0),
        timestamp: nowISO()
      };

      latestTickers.set(symbol, tickerData);
      console.log(`💰 Ticker ${symbol}: $${tickerData.price} (${latestTickers.size} total)`);

      // Write to file periodically (every ticker update)
      writeTickersToFile();

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
        // Store latest trade price for fallback
        const tradePrice = parseFloat(t.p || t.price || 0);

        // Normalize trade event for OrderbookManager
        const tradeEvent = {
          price: tradePrice,
          qty: parseFloat(t.v || t.qty || 0),
          side: t.S || t.side || "UNKNOWN",
          tradeId: t.i || t.tradeId || Date.now().toString(),
          ts: parseInt(t.T || t.timestamp || Date.now())
        };

        // Send to microstructure system
        OrderbookManager.onTradeEvent(symbol, tradeEvent);
        if (tradePrice > 0) {
          latestTradePrices.set(symbol, tradePrice);

          // If we have no ticker price or ticker price is 0, update ticker with trade price
          const currentTicker = latestTickers.get(symbol);
          if (!currentTicker || currentTicker.price === 0) {
            const updatedTicker = {
              symbol,
              price: tradePrice,
              change24h: currentTicker?.change24h || 0,
              volume24h: currentTicker?.volume24h || 0,
              timestamp: nowISO()
            };
            latestTickers.set(symbol, updatedTicker);
            console.log(`🚀 Updated ${symbol} ticker from trade: $${tradePrice}`);
            writeTickersToFile();
          }
        }

        emitter.emit("event", {
          type: "trade",
          timestamp: nowISO(),
          symbol,
          payload: t,
        });
      }

    } else if (kind === "orderbook" && symbol) {
      // Orderbook data processing
      const orderbookData = Array.isArray(msg.data) ? msg.data[0] : msg.data;

      if (orderbookData) {
        // Normalize orderbook event for OrderbookManager
        const orderbookEvent = {
          bids: (orderbookData.b || orderbookData.bids || []).map(level => ({
            price: parseFloat(level[0] || level.price || 0),
            qty: parseFloat(level[1] || level.qty || 0)
          })),
          asks: (orderbookData.a || orderbookData.asks || []).map(level => ({
            price: parseFloat(level[0] || level.price || 0),
            qty: parseFloat(level[1] || level.qty || 0)
          })),
          lastUpdateId: orderbookData.u || orderbookData.updateId || null,
          ts: parseInt(orderbookData.ts || orderbookData.timestamp || Date.now())
        };

        // Send to microstructure system
        OrderbookManager.onOrderbookEvent(symbol, orderbookEvent);

        emitter.emit("event", {
          type: "orderbook",
          timestamp: nowISO(),
          symbol,
          payload: orderbookData,
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
  console.log("🔍 [DEBUG] initPublicConnection called, ws exists:", !!ws, "connected:", wsStatus.connected);

  if (ws && wsStatus.connected && !options.forceRestart) {
    console.log("ℹ️ [BYBIT-WS] Already connected, skipping init.");
    return;
  }

  if (options.forceRestart && ws) {
    console.log("🔄 [BYBIT-WS] Force restart requested, closing existing connection...");
    closePublicConnection();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log("🔍 [DEBUG] Proceeding with WebSocket connection...");

  // Initialize OrderbookManager microstructure system
  OrderbookManager.initMicrostructure();
  console.log("✅ OrderbookManager microstructure initialized");

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

  // Reinitialize with force restart to get updated symbols
  await initPublicConnection({ forceRestart: true });
}/**
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
