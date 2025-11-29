// src/microstructure/OrderbookManager.js
import CONFIG from "../config/index.js";
import * as jsonStore from "../storage/jsonStore.js";
import fs from "fs";
import path from "path";

// ================================================================
// STATE & SYMBOL MANAGEMENT
// ================================================================

const state = {
  symbols: {},
};

// Event callback for tracking WebSocket activity (used by FeatureEngine adaptive intervals)
let wsEventCallback = null;

function setWebSocketEventCallback(callback) {
  wsEventCallback = callback;
}

/**
 * MicroSymbolState struktura:
 * {
 *   symbol: string,
 *   lastUpdateAt: string,
 *   priceInfo: {
 *     lastPrice: number|null,
 *     bestBid: number|null,
 *     bestAsk: number|null,
 *     spread: number|null,
 *     lastTradeSide: "BUY"|"SELL"|null,
 *     lastTradeTime: string|null,
 *   },
 *   orderbook: {
 *     bids: Array<{ price: number, qty: number }>,
 *     asks: Array<{ price: number, qty: number }>,
 *     lastUpdateId: string|number|null,
 *     lastUpdateAt: string|null,
 *   },
 *   trades: Array<TradeTick>,
 *   candles: {
 *     [timeframe: string]: Array<Candle>
 *   }
 * }
 */

function ensureSymbolState(symbol) {
  if (!state.symbols[symbol]) {
    state.symbols[symbol] = {
      symbol,
      lastUpdateAt: null,
      lastTickAt: Date.now(), // Activity heartbeat - INITIALIZE with current time to allow grace period for orderbook collection
      priceInfo: {
        lastPrice: null,
        bestBid: null,
        bestAsk: null,
        spread: null,
        lastTradeSide: null,
        lastTradeTime: null,
      },
      orderbook: {
        bids: [],
        asks: [],
        lastUpdateId: null,
        lastUpdateAt: null,
      },
      trades: [],
      candles: {},
    };

    // Inicijalizuj candles za sve timeframe-ove
    const timeframes = CONFIG.microstructure?.candleTimeframes || ["1s", "3s", "5s", "15s"];
    timeframes.forEach(tf => {
      state.symbols[symbol].candles[tf] = [];
    });
  }
  return state.symbols[symbol];
}

// ================================================================
// ORDERBOOK EVENT PROCESSING
// ================================================================

/**
 * Obrađuje orderbook događaj
 * eventData format: { bids: [{price, qty}], asks: [{price, qty}], lastUpdateId, ts }
 * EXPORTED to be called from index.js WebSocket handler
 */
export function onOrderbookEvent(symbol, eventData) {
  try {
    console.log(`[ORDERBOOK HANDLER] ${symbol}: Received event, bids=${eventData.bids?.length || 0}, asks=${eventData.asks?.length || 0}, snapshot=${eventData.isSnapshot}`);

    // Track WebSocket event for adaptive feature engine intervals
    if (wsEventCallback) wsEventCallback();

    const s = ensureSymbolState(symbol);
    const oldLastTickAt = s.lastTickAt;
    const now = new Date().toISOString();

    // Determiniši depth limit na osnovu kategorije simbola
    const depthLimit = getDepthLimitForSymbol(symbol);

    // Update orderbook state
    updateOrderbookState(s, eventData, depthLimit);

    // Update price info
    updatePriceInfo(s);

    // Update timestamps
    s.orderbook.lastUpdateAt = now;
    s.lastUpdateAt = now;
    s.lastTickAt = Date.now(); // Activity heartbeat

    console.log(`[ORDERBOOK HANDLER] ${symbol}: Updated lastTickAt from ${oldLastTickAt} to ${s.lastTickAt} (elapsed: ${s.lastTickAt - oldLastTickAt}ms)`);

    // DISABLED: Orderbook snapshots fill disk too fast (400k+ files in hours)
    // Async store to disk (ne čekamo)
    // storeOrderbookSnapshot(symbol, s.orderbook).catch(err =>
    //   console.error(`Error storing orderbook snapshot for ${symbol}:`, err)
    // );

  } catch (error) {
    console.error(`[ORDERBOOK HANDLER] Error in onOrderbookEvent for ${symbol}:`, error);
  }
}

/**
 * Determiniše depth limit na osnovu kategorije simbola
 */
function getDepthLimitForSymbol(symbol) {
  const limits = CONFIG.microstructure?.maxOrderbookDepth || {
    prime: 100,
    normal: 50,
    wild: 20
  };

  // TODO: Integration sa universe kategorijama
  // Za sada koristimo normal kao default
  const primeSymbols = CONFIG.primeSymbols || ["BTCUSDT", "ETHUSDT"];

  if (primeSymbols.includes(symbol)) {
    return limits.prime;
  }

  // Dodaj logiku za wild kategorizaciju
  const wildPatterns = ["MEME", "SHIB", "DOGE", "PEPE"]; // primer
  const isWild = wildPatterns.some(pattern => symbol.includes(pattern));

  return isWild ? limits.wild : limits.normal;
}

/**
 * Ažurira orderbook state sa novim podacima
 * Podržava i snapshot (full replace) i delta (merge updates)
 */
function updateOrderbookState(symbolState, eventData, depthLimit) {
  const { bids, asks, lastUpdateId, isSnapshot } = eventData;

  if (isSnapshot) {
    // SNAPSHOT: Replace entire orderbook
    if (bids && Array.isArray(bids)) {
      symbolState.orderbook.bids = bids
        .filter(level => level.qty > 0)
        .sort((a, b) => b.price - a.price)
        .slice(0, depthLimit);
    }

    if (asks && Array.isArray(asks)) {
      symbolState.orderbook.asks = asks
        .filter(level => level.qty > 0)
        .sort((a, b) => a.price - b.price)
        .slice(0, depthLimit);
    }
  } else {
    // DELTA: Merge updates into existing orderbook
    // For each update: if qty > 0, update/add level; if qty = 0, remove level

    if (bids && Array.isArray(bids)) {
      const existingBids = symbolState.orderbook.bids || [];
      const bidMap = new Map(existingBids.map(b => [b.price, b.qty]));

      // Apply delta updates
      for (const level of bids) {
        if (level.qty > 0) {
          bidMap.set(level.price, level.qty);
        } else {
          bidMap.delete(level.price);
        }
      }

      // Convert back to array and sort
      symbolState.orderbook.bids = Array.from(bidMap.entries())
        .map(([price, qty]) => ({ price, qty }))
        .sort((a, b) => b.price - a.price)
        .slice(0, depthLimit);
    }

    if (asks && Array.isArray(asks)) {
      const existingAsks = symbolState.orderbook.asks || [];
      const askMap = new Map(existingAsks.map(a => [a.price, a.qty]));

      // Apply delta updates
      for (const level of asks) {
        if (level.qty > 0) {
          askMap.set(level.price, level.qty);
        } else {
          askMap.delete(level.price);
        }
      }

      // Convert back to array and sort
      symbolState.orderbook.asks = Array.from(askMap.entries())
        .map(([price, qty]) => ({ price, qty }))
        .sort((a, b) => a.price - b.price)
        .slice(0, depthLimit);
    }
  }

  // Update ID
  if (lastUpdateId) {
    symbolState.orderbook.lastUpdateId = lastUpdateId;
  }
}

/**
 * Ažurira price info na osnovu orderbook-a
 */
function updatePriceInfo(symbolState) {
  const { bids, asks } = symbolState.orderbook;
  const priceInfo = symbolState.priceInfo;

  // Best bid/ask
  priceInfo.bestBid = bids.length > 0 ? bids[0].price : null;
  priceInfo.bestAsk = asks.length > 0 ? asks[0].price : null;

  // Spread calculation
  if (priceInfo.bestBid && priceInfo.bestAsk) {
    priceInfo.spread = priceInfo.bestAsk - priceInfo.bestBid;
  } else {
    priceInfo.spread = null;
  }
}

// ================================================================
// TRADE EVENT PROCESSING
// ================================================================

/**
 * Obrađuje trade događaj
 * eventData format: { price, qty, side, tradeId, ts }
 */
function onTradeEvent(symbol, eventData) {
  try {
    // Track WebSocket event for adaptive feature engine intervals
    if (wsEventCallback) wsEventCallback();

    const s = ensureSymbolState(symbol);
    const now = new Date().toISOString();

    // Update price info from trade
    s.priceInfo.lastPrice = eventData.price;
    s.priceInfo.lastTradeSide = eventData.side;
    s.priceInfo.lastTradeTime = now;

    // Add to trades array (maintain size limit)
    const maxTrades = CONFIG.microstructure?.maxTradesPerSymbol || 2000;
    s.trades.push({
      price: eventData.price,
      qty: eventData.qty,
      side: eventData.side,
      tradeId: eventData.tradeId,
      timestamp: now,
      ts: eventData.ts
    });

    // Maintain size limit
    if (s.trades.length > maxTrades) {
      s.trades = s.trades.slice(-maxTrades);
    }

    // Update candles from trade
    updateCandlesFromTrade(s, eventData);

    // Update timestamps
    s.lastUpdateAt = now;
    s.lastTickAt = Date.now(); // Activity heartbeat

    // DISABLED: Trades stream fills disk too fast (1.6GB + 299 files in 4 hours!)
    // Async store to disk
    // storeTradeEvent(symbol, eventData).catch(err =>
    //   console.error(`Error storing trade event for ${symbol}:`, err)
    // );

  } catch (error) {
    console.error(`Error processing trade event for ${symbol}:`, error);
  }
}

// ================================================================
// CANDLE PROCESSING
// ================================================================

/**
 * Ažurira candles na osnovu trade-a
 */
function updateCandlesFromTrade(symbolState, tradeData) {
  const timeframes = CONFIG.microstructure?.candleTimeframes || ["1s", "5s", "15s"];
  const tradeTs = tradeData.ts || Date.now();

  // FULLY DISABLED: Console spam (even 0.1% sampling = too much!)
  // if (Math.random() < 0.001) {
  //   console.log(`🕯️ [CANDLE DEBUG] Updating candles for ${symbolState.symbol || 'unknown'}, timeframes: ${timeframes.join(',')}`);
  // }

  timeframes.forEach(tf => {
    updateCandleForTimeframe(symbolState, tf, tradeData, tradeTs);
  });
}

/**
 * Ažurira candle za specifičan timeframe
 */
function updateCandleForTimeframe(symbolState, timeframe, tradeData, tradeTs) {
  const bucketStart = getBucketStart(tradeTs, timeframe);
  const candles = symbolState.candles[timeframe];

  // Pronađi ili kreiraj candle za ovaj bucket
  let candle = candles.find(c => c.bucketStart === bucketStart);

  if (!candle) {
    candle = {
      bucketStart,
      timeframe,
      open: tradeData.price,
      high: tradeData.price,
      low: tradeData.price,
      close: tradeData.price,
      volume: 0,
      trades: 0,
      timestamp: new Date(bucketStart).toISOString()
    };
    candles.push(candle);

    // Sortiraj i ograniči broj candles
    candles.sort((a, b) => a.bucketStart - b.bucketStart);
    if (candles.length > 1000) { // limit na 1000 candles po timeframe
      candles.splice(0, candles.length - 1000);
    }
  }

  // Update OHLCV
  candle.high = Math.max(candle.high, tradeData.price);
  candle.low = Math.min(candle.low, tradeData.price);
  candle.close = tradeData.price;
  candle.volume += tradeData.qty;
  candle.trades += 1;
}

/**
 * Izračunava početak bucket-a za dati timestamp i timeframe
 */
function getBucketStart(timestampMs, timeframe) {
  const intervalMs = parseTimeframe(timeframe);
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

/**
 * Parsira timeframe string u milisekunde
 */
function parseTimeframe(timeframe) {
  const match = timeframe.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid timeframe: ${timeframe}`);

  const [, num, unit] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

  return parseInt(num) * multipliers[unit];
}

// ================================================================
// STORAGE OPERATIONS
// ================================================================

/**
 * Čuva orderbook snapshot na disk
 */
async function storeOrderbookSnapshot(symbol, orderbookData) {
  return jsonStore.writeSnapshot("orderbook", symbol, orderbookData);
}

/**
 * Čuva trade event na disk
 */
async function storeTradeEvent(symbol, tradeData) {
  return jsonStore.appendJsonLine("trades_stream", symbol, tradeData);
}

/**
 * Flush-uje sve snapshots na disk (poziva se periodično)
 */
async function flushSnapshotsToDisk() {
  const promises = [];

  for (const [symbol, symbolState] of Object.entries(state.symbols)) {
    // DISABLED: Orderbook snapshots fill disk too fast (8.8GB + 2.2M files in 4 hours!)
    // Orderbook snapshot
    // promises.push(storeOrderbookSnapshot(symbol, symbolState.orderbook));

    // Candles snapshots
    // DISABLED: Microcandles disk storage fills disk too fast (17GB+ in days!)
    // for (const [timeframe, candles] of Object.entries(symbolState.candles)) {
    //   if (candles.length > 0) {
    //     promises.push(
    //       jsonStore.writeSnapshot("microcandles", symbol, candles, timeframe)
    //     );
    //   }
    // }
  }

  await Promise.allSettled(promises);
}

// ================================================================
// PUBLIC API
// ================================================================

/**
 * Inicijalizuje microstructure sistem
 */
function initMicrostructure() {
  console.log("🔄 Initializing Microstructure OrderbookManager...");

  // Pokreni periodic snapshot writer
  const interval = CONFIG.microstructure?.snapshotWriteIntervalMs || 2000;
  setInterval(() => {
    flushSnapshotsToDisk().catch(err =>
      console.error("🚨 Microstructure snapshot error:", err)
    );
  }, interval);

  console.log(`✅ Microstructure initialized (snapshot interval: ${interval}ms)`);
}

/**
 * Vraća trenutno stanje simbola
 */
function getSymbolMicroState(symbol) {
  const symbolState = state.symbols[symbol];
  return symbolState ? { ...symbolState } : null; // deep copy
}

/**
 * Vraća orderbook summary
 */
function getOrderbookSummary(symbol, depthLimit = 10) {
  const symbolState = state.symbols[symbol];
  if (!symbolState) return null;

  const { bids, asks, lastUpdateAt } = symbolState.orderbook;
  const { bestBid, bestAsk, spread } = symbolState.priceInfo;

  // Convert {price, qty} objects to [price, qty] arrays for compatibility
  const bidsArray = bids.slice(0, depthLimit).map(level => [level.price, level.qty]);
  const asksArray = asks.slice(0, depthLimit).map(level => [level.price, level.qty]);

  // Calculate orderbook imbalance (ratio of bid volume to ask volume)
  const bidVolume = bids.slice(0, depthLimit).reduce((sum, level) => sum + level.qty, 0);
  const askVolume = asks.slice(0, depthLimit).reduce((sum, level) => sum + level.qty, 0);
  const imbalance = askVolume > 0 ? bidVolume / askVolume : 1.0;

  return {
    symbol,
    bestBid,
    bestAsk,
    spread,
    imbalance,
    bids: bidsArray,
    asks: asksArray,
    lastUpdateAt
  };
}

/**
 * Vraća recent trades
 */
function getRecentTrades(symbol, limit = 100) {
  const symbolState = state.symbols[symbol];
  if (!symbolState) return [];

  return symbolState.trades.slice(-limit);
}

/**
 * Računa net order flow za poslednjih 60 sekundi
 * Vraća: buy_volume - sell_volume (pozitivno = buying pressure, negativno = selling pressure)
 */
function getOrderFlow60s(symbol) {
  const symbolState = state.symbols[symbol];
  if (!symbolState || !symbolState.trades || symbolState.trades.length === 0) {
    return null;
  }

  const now = Date.now();
  const cutoff = now - 60000; // 60 seconds ago

  let buyVolume = 0;
  let sellVolume = 0;
  let recentTradesCount = 0;

  // Filter trades from last 60 seconds and calculate net flow
  for (const trade of symbolState.trades) {
    const tradeTime = trade.ts || new Date(trade.timestamp).getTime();

    if (tradeTime >= cutoff) {
      recentTradesCount++;
      const volume = trade.price * trade.qty; // USD volume

      if (trade.side === "Buy" || trade.side === "BUY") {
        buyVolume += volume;
      } else if (trade.side === "Sell" || trade.side === "SELL") {
        sellVolume += volume;
      }
    }
  }

  // Debug log for EPTUSDT only (sample 1% to avoid spam)
  if (symbol === "EPTUSDT" && Math.random() < 0.01) {
    console.log(`📊 [ORDER FLOW DEBUG] ${symbol}: ${recentTradesCount} trades in 60s, buy=$${buyVolume.toFixed(2)}, sell=$${sellVolume.toFixed(2)}, net=$${(buyVolume - sellVolume).toFixed(2)}`);
  }

  return buyVolume - sellVolume;
}

/**
 * Vraća candles za timeframe
 */
function getCandles(symbol, timeframe, limit = 100) {
  const symbolState = state.symbols[symbol];
  if (!symbolState || !symbolState.candles[timeframe]) return [];

  return symbolState.candles[timeframe].slice(-limit);
}

/**
 * Lista svih aktivnih simbola (samo oni sa orderbook ili trade podacima)
 */
function getActiveSymbols() {
  const activeSymbols = [];

  for (const [symbol, symbolState] of Object.entries(state.symbols)) {
    // Simbol je aktivan samo ako ima orderbook podatke ILI trade podatke
    const hasOrderbook = symbolState.orderbook &&
                        symbolState.orderbook.bids &&
                        symbolState.orderbook.bids.length > 0 &&
                        symbolState.orderbook.asks &&
                        symbolState.orderbook.asks.length > 0;

    const hasTrades = symbolState.trades && symbolState.trades.length > 0;

    if (hasOrderbook || hasTrades) {
      activeSymbols.push(symbol);
    }
  }

  return activeSymbols;
}

/**
 * Get statistics for dashboard
 */
function getStats() {
  const activeSymbols = Object.keys(state.symbols);
  let totalOrderbookUpdates = 0;
  let totalTradeUpdates = 0;

  // Calculate total updates
  for (const [symbol, symbolState] of Object.entries(state.symbols)) {
    if (symbolState.orderbook.lastUpdateAt) {
      totalOrderbookUpdates++;
    }
    if (symbolState.trades && symbolState.trades.length > 0) {
      totalTradeUpdates += symbolState.trades.length;
    }
  }

  return {
    activeSymbols: activeSymbols.length,
    totalOrderbookUpdates,
    totalTradeUpdates,
    lastUpdateAt: Date.now()
  };
}

// ================================================================
// STATS PERSISTENCE
// ================================================================

let statsWriteInterval = null;

/**
 * Start periodic stats writing to file for dashboard access
 */
function startStatsPersistence() {
  const statsPath = path.join(process.cwd(), 'data', 'stats.json');

  // Write stats every 2 seconds
  statsWriteInterval = setInterval(() => {
    try {
      const stats = getStats();
      fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    } catch (err) {
      console.error('[OrderbookManager] Failed to write stats:', err.message);
    }
  }, 2000);

  console.log('[OrderbookManager] Stats persistence started, writing to data/stats.json every 2s');
}

/**
 * Stop stats persistence
 */
function stopStatsPersistence() {
  if (statsWriteInterval) {
    clearInterval(statsWriteInterval);
    statsWriteInterval = null;
    console.log('[OrderbookManager] Stats persistence stopped');
  }
}

// ================================================================
// SYMBOL HEALTH CHECK (for Regime Engine)
// ================================================================

/**
 * Proverava zdravlje simbola na osnovu activity heartbeat-a
 * @param {string} symbol
 * @returns {Object} { isActive, staleness, lastTickAt, timeSinceLastTick }
 */
function getSymbolHealth(symbol) {
  const s = state.symbols[symbol];
  if (!s || !s.lastTickAt) {
    return {
      isActive: false,
      staleness: "UNKNOWN",
      lastTickAt: null,
      timeSinceLastTick: null
    };
  }

  const now = Date.now();
  const timeSinceLastTick = now - s.lastTickAt;

  let staleness = "FRESH";
  let isActive = true;

  if (timeSinceLastTick > 120000) {  // 120s (2min) - tolerate REST-only symbols
    staleness = "STALE";
    isActive = false;
  } else if (timeSinceLastTick > 30000) {  // 30s degraded
    staleness = "DEGRADED";
  }

  return {
    isActive,
    staleness,
    lastTickAt: s.lastTickAt,
    timeSinceLastTick
  };
}

// ================================================================
// SYMBOL ACTIVITY TOUCH (for REST-only symbols)
// ================================================================

/**
 * Mark symbol as active even without WebSocket tick
 * Used by FeatureEngine when processing REST API data
 */
function touchSymbolActivity(symbol) {
  let s = state.symbols[symbol];

  if (!s) {
    // Initialize minimal state if symbol doesn't exist
    s = {
      symbol,
      lastTickAt: Date.now(),
      lastUpdateAt: Date.now(),
      orderbook: { bids: [], asks: [], lastUpdateAt: Date.now() },
      trades: [],
      candles: { '1m': [] }
    };
    state.symbols[symbol] = s;
  } else {
    // Just update tick timestamp
    s.lastTickAt = Date.now();
  }
}

// ================================================================
// GET ALL TRACKED SYMBOLS (for signal scanner)
// ================================================================

/**
 * Returns list of all symbols being tracked with orderbook data
 * @returns {string[]} Array of symbol names
 */
function getAllTrackedSymbols() {
  return Object.keys(state.symbols).filter(symbol => {
    const s = state.symbols[symbol];
    return s.orderbook && (s.orderbook.bids.length > 0 || s.orderbook.asks.length > 0);
  });
}

// ================================================================
// EXPORTS
// ================================================================

export {
  initMicrostructure,
  onOrderbookEvent,
  onTradeEvent,
  getSymbolMicroState,
  getOrderbookSummary,
  getRecentTrades,
  getOrderFlow60s,
  getCandles,
  getActiveSymbols,
  getSymbolHealth,
  touchSymbolActivity,
  setWebSocketEventCallback,
  getStats,
  startStatsPersistence,
  stopStatsPersistence,
  flushSnapshotsToDisk,
  getAllTrackedSymbols
};

export default {
  initMicrostructure,
  onOrderbookEvent,
  onTradeEvent,
  getSymbolMicroState,
  getOrderbookSummary,
  getRecentTrades,
  getOrderFlow60s,
  getCandles,
  getActiveSymbols,
  getSymbolHealth,
  touchSymbolActivity,
  setWebSocketEventCallback,
  getStats,
  startStatsPersistence,
  stopStatsPersistence,
  flushSnapshotsToDisk,
  getAllTrackedSymbols
};

