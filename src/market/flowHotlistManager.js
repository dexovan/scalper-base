// ============================================================
// FLOW HOTLIST MANAGER
// Manages dynamic trade WS subscriptions for top 20-30 symbols
// ============================================================
//
// PURPOSE:
// - Bybit v5 WS can't handle 300+ publicTrade subscriptions (1006 error)
// - We only need real order flow for TOP candidates (high volatility, volume spike)
// - This module maintains a "hot list" of 20-30 symbols that get trade streams
// - Other symbols still work (candles + orderbook), but orderFlowNet60s = 0
//
// ARCHITECTURE:
// 1. Scanner does first pass: scores all symbols based on candles + orderbook
// 2. Scanner sends top 30 symbols to this manager via API
// 3. Manager dynamically subscribes/unsubscribes publicTrade.* topics
// 4. TradeFlowAggregator receives trade data ONLY for hot symbols
// 5. Scanner does second pass: validates signals with real orderFlow

import bybitPublicWS, { tradeFlowAggregator } from "../connectors/bybit/publicWS.js";

// Configuration
const FLOW_LIMIT = 30; // Maximum symbols with trade stream (stay under Bybit limit)

// State
let currentFlowSymbols = new Set(); // Symbols currently subscribed to publicTrade.*

/**
 * Update which symbols get real-time trade data
 * @param {string[]} symbols - Array of symbol names (e.g., ["BTCUSDT", "ETHUSDT"])
 * @returns {Object} Result with changed status, current list, added/removed symbols
 */
function updateFlowSymbols(symbols) {
  // 1) Normalize and limit input
  const next = new Set(
    symbols
      .map(s => s.toUpperCase())
      .filter(Boolean)
      .slice(0, FLOW_LIMIT)
  );

  // 2) Calculate diff
  const toUnsub = [...currentFlowSymbols].filter(s => !next.has(s));
  const toSub   = [...next].filter(s => !currentFlowSymbols.has(s));

  // 3) Early return if no changes
  if (!toSub.length && !toUnsub.length) {
    return {
      changed: false,
      current: [...currentFlowSymbols],
      added: [],
      removed: []
    };
  }

  // 4) Update WS subscription (only for publicTrade.* topics)
  try {
    bybitPublicWS.updateTradeSubscriptions({ add: toSub, remove: toUnsub });
  } catch (error) {
    console.error("❌ [FLOW-HOTLIST] Failed to update WS subscriptions:", error.message);
    return {
      changed: false,
      current: [...currentFlowSymbols],
      added: [],
      removed: [],
      error: error.message
    };
  }

  // 5) Update local state
  currentFlowSymbols = next;

  console.log(`🔥 [FLOW-HOTLIST] Updated: +${toSub.length} -${toUnsub.length} (total: ${currentFlowSymbols.size}/${FLOW_LIMIT})`);

  return {
    changed: true,
    current: [...currentFlowSymbols],
    added: toSub,
    removed: toUnsub
  };
}

/**
 * Get currently active flow symbols
 * @returns {string[]} Array of symbol names with active trade streams
 */
function getCurrentFlowSymbols() {
  return [...currentFlowSymbols];
}

/**
 * Check if symbol has active trade stream
 * @param {string} symbol - Symbol name
 * @returns {boolean}
 */
function isSymbolInHotlist(symbol) {
  return currentFlowSymbols.has(symbol.toUpperCase());
}

/**
 * Get current hotlist size and limit
 * @returns {Object} { current, max, available }
 */
function getHotlistStats() {
  return {
    current: currentFlowSymbols.size,
    max: FLOW_LIMIT,
    available: FLOW_LIMIT - currentFlowSymbols.size
  };
}

export {
  updateFlowSymbols,
  getCurrentFlowSymbols,
  isSymbolInHotlist,
  getHotlistStats,
  tradeFlowAggregator
};
