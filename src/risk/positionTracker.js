// ================================================================
// src/risk/positionTracker.js
// POSITION TRACKER - Tracks all open positions, PnL, MFE/MAE
// ================================================================

/**
 * PositionState structure
 * @typedef {Object} PositionState
 * @property {string} symbol - Symbol name (e.g., BTCUSDT)
 * @property {string} side - "LONG" or "SHORT"
 * @property {number} leverage - Position leverage
 * @property {number} entryPrice - Average entry price
 * @property {number} qty - Position size (contracts)
 * @property {number} notionalValue - Position value in USDT
 * @property {number} marginUsed - Margin required for position
 * @property {number} stopLossPrice - Stop loss price (null if none)
 * @property {number} takeProfit1Price - First TP target
 * @property {number} takeProfit2Price - Second TP target
 * @property {number} maxFavorableExcursion - Best unrealized profit reached
 * @property {number} maxAdverseExcursion - Worst unrealized loss reached
 * @property {number} unrealizedPnl - Current unrealized PnL
 * @property {number} unrealizedPnlPct - Unrealized PnL as %
 * @property {number} realizedPnl - Realized PnL from partial closes
 * @property {string} openedAt - ISO timestamp when opened
 * @property {string} updatedAt - ISO timestamp of last update
 * @property {boolean} isActive - Is position still open
 */

// Internal state: Map<positionKey, PositionState>
// positionKey format: "BTCUSDT_LONG" or "ETHUSDT_SHORT"
const positions = new Map();

/**
 * Initialize position tracker
 */
export function initPositionTracker() {
  positions.clear();
  console.log("[PositionTracker] Initialized - ready to track positions");
}

/**
 * Load positions from tpslEngine snapshot
 * When tpslEngine loads states from disk, we need to create corresponding positions
 * @param {Map} tpslStatesMap - Map of tpslStates from tpslEngine
 */
export function loadPositionsFromTpslSnapshot(tpslStatesMap) {
  if (!tpslStatesMap || tpslStatesMap.size === 0) {
    console.log("[PositionTracker] No tpslStates to load");
    return;
  }

  console.log(`[PositionTracker] Loading ${tpslStatesMap.size} positions from tpslEngine snapshot...`);

  let loadedCount = 0;
  for (const [key, tpslState] of tpslStatesMap.entries()) {
    // tpslState has: symbol, side, entryPrice, breakEvenPrice, quickTpPrice, tp1Price, tp2Price, stopLossPrice
    const { symbol, side, entryPrice } = tpslState;

    // Check if position already exists
    if (positions.has(key)) {
      if (symbol === "LTCUSDT") {
        console.log(`[PositionTracker] Position ${key} already exists, skipping...`);
      }
      continue;
    }

    // Create position from tpslState
    const now = new Date().toISOString();
    const position = {
      symbol,
      side,
      leverage: 1,  // Default leverage (could be in tpslState if needed)
      entryPrice,
      qty: 1,  // Qty unknown from tpslState - set to 1 as placeholder
      notionalValue: entryPrice * 1,
      marginUsed: entryPrice * 1,
      stopLossPrice: tpslState.stopLossPrice || null,
      takeProfit1Price: tpslState.tp1Price || null,
      takeProfit2Price: tpslState.tp2Price || null,
      maxFavorableExcursion: 0,
      maxAdverseExcursion: 0,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      realizedPnl: 0,
      openedAt: now,
      updatedAt: now,
      isActive: true
    };

    positions.set(key, position);
    loadedCount++;

    if (symbol === "LTCUSDT") {
      console.log(`[PositionTracker] Loaded LTC position from snapshot: ${key}, entry=${entryPrice}`);
    }
  }

  console.log(`[PositionTracker] Loaded ${loadedCount} positions from tpslEngine snapshot`);
}

/**
 * Generate position key
 * @param {string} symbol
 * @param {string} side - "LONG" or "SHORT"
 * @returns {string}
 */
function getPositionKey(symbol, side) {
  return `${symbol}_${side}`;
}

/**
 * Open new position or add to existing (pyramiding)
 * @param {Object} event - Position open event
 * @returns {PositionState}
 */
export function onNewPositionOpened(event) {
  const {
    symbol,
    side,
    entryPrice,
    qty,
    leverage = 1,
    stopLossPrice = null,
    takeProfit1Price = null,
    takeProfit2Price = null
  } = event;

  const key = getPositionKey(symbol, side);
  const now = new Date().toISOString();

  // Check if position already exists (pyramiding)
  const existing = positions.get(key);

  if (existing && existing.isActive) {
    // Pyramiding: average entry price
    const totalQty = existing.qty + qty;
    const totalNotional = (existing.entryPrice * existing.qty) + (entryPrice * qty);
    const avgEntry = totalNotional / totalQty;

    existing.entryPrice = avgEntry;
    existing.qty = totalQty;
    existing.notionalValue = avgEntry * totalQty;
    existing.marginUsed = (avgEntry * totalQty) / leverage;
    existing.updatedAt = now;

    console.log(`[PositionTracker] Added to ${key}: qty=${qty}, newTotal=${totalQty}, avgEntry=${avgEntry.toFixed(4)}`);
    return { ...existing };
  }

  // New position
  const notionalValue = entryPrice * qty;
  const marginUsed = notionalValue / leverage;

  const position = {
    symbol,
    side,
    leverage,
    entryPrice,
    qty,
    notionalValue,
    marginUsed,
    stopLossPrice,
    takeProfit1Price,
    takeProfit2Price,
    maxFavorableExcursion: 0,
    maxAdverseExcursion: 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    realizedPnl: 0,
    openedAt: now,
    updatedAt: now,
    isActive: true
  };

  positions.set(key, position);
  console.log(`[PositionTracker] Opened ${key}: entry=${entryPrice}, qty=${qty}, notional=${notionalValue.toFixed(2)}`);

  return { ...position };
}

/**
 * Update position with current market price
 * Calculates unrealized PnL, MFE, MAE
 * @param {string} symbol
 * @param {string} side
 * @param {number} currentPrice
 */
export function onPositionPriceUpdate(symbol, side, currentPrice) {
  const key = getPositionKey(symbol, side);
  const position = positions.get(key);

  if (!position || !position.isActive) {
    return null; // No active position
  }

  // Calculate unrealized PnL
  let pnl = 0;
  if (side === "LONG") {
    pnl = (currentPrice - position.entryPrice) * position.qty;
  } else if (side === "SHORT") {
    pnl = (position.entryPrice - currentPrice) * position.qty;
  }

  position.unrealizedPnl = pnl;
  position.unrealizedPnlPct = (pnl / position.notionalValue) * 100;

  // Update MFE (Maximum Favorable Excursion)
  if (pnl > position.maxFavorableExcursion) {
    position.maxFavorableExcursion = pnl;
  }

  // Update MAE (Maximum Adverse Excursion)
  if (pnl < position.maxAdverseExcursion) {
    position.maxAdverseExcursion = pnl;
  }

  position.updatedAt = new Date().toISOString();

  // Debug log (sample 0.1% to avoid spam)
  if (Math.random() < 0.001) {
    console.log(`[PositionTracker] ${key} @ ${currentPrice}: PnL=${pnl.toFixed(2)} (${position.unrealizedPnlPct.toFixed(2)}%), MFE=${position.maxFavorableExcursion.toFixed(2)}, MAE=${position.maxAdverseExcursion.toFixed(2)}`);
  }

  return { ...position };
}

/**
 * Close position (full or partial)
 * @param {Object} event - Position close event
 * @returns {Object} Closed position summary
 */
export function onPositionClosed(event) {
  const { symbol, side, closePrice, qtyClose } = event;
  const key = getPositionKey(symbol, side);
  const position = positions.get(key);

  if (!position || !position.isActive) {
    console.warn(`[PositionTracker] Cannot close ${key} - not found or already closed`);
    return null;
  }

  // Calculate realized PnL
  let realizedPnl = 0;
  if (side === "LONG") {
    realizedPnl = (closePrice - position.entryPrice) * qtyClose;
  } else if (side === "SHORT") {
    realizedPnl = (position.entryPrice - closePrice) * qtyClose;
  }

  position.realizedPnl += realizedPnl;

  // Full close vs partial close
  if (qtyClose >= position.qty) {
    // Full close
    position.isActive = false;
    position.qty = 0;
    position.unrealizedPnl = 0;
    position.unrealizedPnlPct = 0;
    console.log(`[PositionTracker] CLOSED ${key}: Realized PnL=${realizedPnl.toFixed(2)}, MFE=${position.maxFavorableExcursion.toFixed(2)}, MAE=${position.maxAdverseExcursion.toFixed(2)}`);
  } else {
    // Partial close
    position.qty -= qtyClose;
    position.notionalValue = position.entryPrice * position.qty;
    position.marginUsed = position.notionalValue / position.leverage;
    console.log(`[PositionTracker] Partial close ${key}: ${qtyClose} contracts, remaining=${position.qty}, realized=${realizedPnl.toFixed(2)}`);
  }

  position.updatedAt = new Date().toISOString();

  return {
    symbol,
    side,
    realizedPnl,
    closePrice,
    qtyClose,
    mfe: position.maxFavorableExcursion,
    mae: position.maxAdverseExcursion,
    closedAt: position.updatedAt
  };
}

/**
 * Update TP/SL prices for a position
 * @param {string} symbol
 * @param {string} side
 * @param {Object} tpslPrices - { stopLossPrice, takeProfit1Price, takeProfit2Price }
 */
export function updatePositionTpSl(symbol, side, tpslPrices) {
  const key = getPositionKey(symbol, side);
  const position = positions.get(key);

  if (!position || !position.isActive) {
    console.warn(`[PositionTracker] Cannot update TP/SL - position not found: ${key}`);
    return;
  }

  position.stopLossPrice = tpslPrices.stopLossPrice ?? position.stopLossPrice;
  position.takeProfit1Price = tpslPrices.takeProfit1Price ?? position.takeProfit1Price;
  position.takeProfit2Price = tpslPrices.takeProfit2Price ?? position.takeProfit2Price;
  position.updatedAt = new Date().toISOString();

  console.log(`[PositionTracker] Updated TP/SL for ${key}: SL=${position.stopLossPrice}, TP1=${position.takeProfit1Price}, TP2=${position.takeProfit2Price}`);
}

/**
 * Get all positions
 * @param {boolean} activeOnly - Return only active positions
 * @returns {PositionState[]}
 */
export function getAllPositions(activeOnly = false) {
  const result = [];

  for (const position of positions.values()) {
    if (!activeOnly || position.isActive) {
      result.push({ ...position });
    }
  }

  return result;
}

/**
 * Get position for specific symbol and side
 * @param {string} symbol
 * @param {string} side
 * @returns {PositionState|null}
 */
export function getPosition(symbol, side) {
  const key = getPositionKey(symbol, side);
  const position = positions.get(key);
  return position ? { ...position } : null;
}

/**
 * Get all positions for a symbol (both LONG and SHORT)
 * @param {string} symbol
 * @returns {PositionState[]}
 */
export function getPositionsForSymbol(symbol) {
  const result = [];

  const longPos = getPosition(symbol, "LONG");
  const shortPos = getPosition(symbol, "SHORT");

  if (longPos && longPos.isActive) result.push(longPos);
  if (shortPos && shortPos.isActive) result.push(shortPos);

  return result;
}

/**
 * Calculate total portfolio metrics
 * @returns {Object} Portfolio summary
 */
export function getPortfolioSummary() {
  let totalUnrealized = 0;
  let totalRealized = 0;
  let totalMargin = 0;
  let activeCount = 0;
  let maxMFE = 0;
  let maxMAE = 0;

  for (const position of positions.values()) {
    if (position.isActive) {
      totalUnrealized += position.unrealizedPnl;
      totalMargin += position.marginUsed;
      activeCount++;

      if (position.maxFavorableExcursion > maxMFE) {
        maxMFE = position.maxFavorableExcursion;
      }
      if (position.maxAdverseExcursion < maxMAE) {
        maxMAE = position.maxAdverseExcursion;
      }
    }
    totalRealized += position.realizedPnl;
  }

  return {
    activePositions: activeCount,
    totalUnrealizedPnl: totalUnrealized,
    totalRealizedPnl: totalRealized,
    totalMarginUsed: totalMargin,
    maxMFE,
    maxMAE
  };
}

/**
 * Clear all positions (for testing/reset)
 */
export function clearAllPositions() {
  const count = positions.size;
  positions.clear();
  console.log(`[PositionTracker] Cleared ${count} positions`);
}

/**
 * Get position tracker state for persistence
 * @returns {Object}
 */
export function getTrackerState() {
  return {
    positions: Array.from(positions.entries()),
    summary: getPortfolioSummary()
  };
}
