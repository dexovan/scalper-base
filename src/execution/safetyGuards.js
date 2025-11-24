// =======================================
// safetyGuards.js — PHASE 10 (Execution Engine)
// =======================================
// Validates all order requests before execution
// Prevents catastrophic losses through multi-layer safety checks

import CONFIG from "../config/index.js";

/**
 * Validate order request against all safety rules
 * @param {Object} orderRequest - The order to validate
 * @param {Object} marketSnapshot - Current market data (bid/ask/spread)
 * @param {Object} riskSnapshot - Current risk state
 * @param {Object} regimeState - Current regime state
 * @returns {Object} { ok: boolean, reasons: [], warnings: [], adjustedOrder?: OrderRequest }
 */
export function validateOrderRequest(orderRequest, marketSnapshot, riskSnapshot, regimeState) {
  const reasons = [];
  const warnings = [];
  let adjustedOrder = null;

  // ========================================
  // 1. SPREAD CHECK
  // ========================================
  const spreadPct = marketSnapshot.spreadPct || 0;
  if (spreadPct > CONFIG.execution.maxSpreadPct) {
    reasons.push(`Spread too wide: ${(spreadPct * 100).toFixed(2)}% > ${(CONFIG.execution.maxSpreadPct * 100).toFixed(2)}%`);
  }

  // ========================================
  // 2. SLIPPAGE CHECK (for LIMIT orders)
  // ========================================
  if (orderRequest.type === "LIMIT" && orderRequest.price) {
    const bestPrice = orderRequest.side === "BUY" ? marketSnapshot.bestAsk : marketSnapshot.bestBid;
    if (bestPrice) {
      const slippagePct = Math.abs(orderRequest.price - bestPrice) / bestPrice;
      if (slippagePct > CONFIG.execution.maxSlippagePct) {
        reasons.push(`Slippage too high: ${(slippagePct * 100).toFixed(2)}% > ${(CONFIG.execution.maxSlippagePct * 100).toFixed(2)}%`);
      }
    }
  }

  // ========================================
  // 3. NOTIONAL CHECK
  // ========================================
  const price = orderRequest.price || marketSnapshot.lastPrice;
  const notional = price * orderRequest.qty;

  if (notional < CONFIG.execution.minNotionalUsd) {
    reasons.push(`Notional too small: $${notional.toFixed(2)} < $${CONFIG.execution.minNotionalUsd}`);
  }

  if (notional > CONFIG.execution.maxNotionalUsd) {
    // Auto-adjust qty if possible
    const maxQty = CONFIG.execution.maxNotionalUsd / price;
    warnings.push(`Notional too large: $${notional.toFixed(2)} > $${CONFIG.execution.maxNotionalUsd}, adjusting qty to ${maxQty.toFixed(4)}`);
    adjustedOrder = { ...orderRequest, qty: maxQty };
  }

  // ========================================
  // 4. RISK BLOCKADES
  // ========================================
  if (!orderRequest.reduceOnly) {
    // Opening new positions
    if (!riskSnapshot.allowNewPositions) {
      reasons.push(`Risk: New positions blocked (${riskSnapshot.blockReason || 'unknown'})`);
    }

    if (orderRequest.side === "BUY" && !riskSnapshot.allowNewLong) {
      reasons.push(`Risk: New LONG positions blocked`);
    }

    if (orderRequest.side === "SELL" && !riskSnapshot.allowNewShort) {
      reasons.push(`Risk: New SHORT positions blocked`);
    }
  }

  // ========================================
  // 5. REGIME BLOCKADES
  // ========================================
  if (!orderRequest.reduceOnly && regimeState) {
    // Block new positions in certain regimes
    const blockingRegimes = ["GLOBAL_PANIC", "BLOWOFF", "DUMP"];
    if (blockingRegimes.includes(regimeState.current)) {
      reasons.push(`Regime: Cannot open positions during ${regimeState.current}`);
    }

    // Warning for risky regimes
    const riskyRegimes = ["PREPUMP", "PUMPING"];
    if (riskyRegimes.includes(regimeState.current)) {
      warnings.push(`Regime: Opening position during ${regimeState.current} - use caution`);
    }
  }

  // ========================================
  // 6. TICK SIZE & PRECISION SAFETY
  // ========================================
  const tickSize = marketSnapshot.tickSize || 0.01;
  const minMove = tickSize * 3; // Minimum 3 ticks between entry and SL

  if (orderRequest.type === "LIMIT" && orderRequest.price) {
    // Ensure price is on valid tick
    const remainder = orderRequest.price % tickSize;
    if (remainder > 0.0000001) { // float precision safety
      const adjustedPrice = Math.round(orderRequest.price / tickSize) * tickSize;
      warnings.push(`Price not on tick boundary, adjusting ${orderRequest.price} → ${adjustedPrice}`);
      if (!adjustedOrder) adjustedOrder = { ...orderRequest };
      adjustedOrder.price = adjustedPrice;
    }
  }

  // ========================================
  // 7. SAFE MODE CHECK
  // ========================================
  if (riskSnapshot.safeMode && !orderRequest.reduceOnly) {
    reasons.push(`System in SAFE MODE - only reduceOnly orders allowed`);
  }

  // ========================================
  // 8. MINIMUM QTY CHECK
  // ========================================
  const minQty = marketSnapshot.minQty || 0.001;
  if (orderRequest.qty < minQty) {
    reasons.push(`Qty too small: ${orderRequest.qty} < ${minQty}`);
  }

  // ========================================
  // FINAL RESULT
  // ========================================
  const ok = reasons.length === 0;

  return {
    ok,
    reasons,
    warnings,
    adjustedOrder: adjustedOrder || orderRequest,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check if market is healthy enough for trading
 * @param {Object} marketSnapshot
 * @returns {boolean}
 */
export function isMarketHealthy(marketSnapshot) {
  if (!marketSnapshot.bestBid || !marketSnapshot.bestAsk) {
    return false;
  }

  if (marketSnapshot.spreadPct > CONFIG.execution.maxSpreadPct * 2) {
    return false; // Spread is 2x max - market is broken
  }

  if (!marketSnapshot.lastPrice || marketSnapshot.lastPrice <= 0) {
    return false;
  }

  return true;
}

/**
 * Calculate safe order price with slippage protection
 * @param {string} side - BUY or SELL
 * @param {Object} marketSnapshot
 * @param {number} maxSlippagePct
 * @returns {number} Safe limit price
 */
export function calculateSafePrice(side, marketSnapshot, maxSlippagePct = null) {
  const slippage = maxSlippagePct || CONFIG.execution.maxSlippagePct;

  if (side === "BUY") {
    // Buy at ask + slippage buffer
    const basePrice = marketSnapshot.bestAsk || marketSnapshot.lastPrice;
    return basePrice * (1 + slippage);
  } else {
    // Sell at bid - slippage buffer
    const basePrice = marketSnapshot.bestBid || marketSnapshot.lastPrice;
    return basePrice * (1 - slippage);
  }
}

/**
 * Validate order quantity against market constraints
 * @param {number} qty
 * @param {Object} marketSnapshot
 * @returns {Object} { ok: boolean, reason?: string, adjustedQty?: number }
 */
export function validateQuantity(qty, marketSnapshot) {
  const minQty = marketSnapshot.minQty || 0.001;
  const maxQty = marketSnapshot.maxQty || 1000000;
  const qtyStep = marketSnapshot.qtyStep || 0.001;

  if (qty < minQty) {
    return { ok: false, reason: `Qty ${qty} < minQty ${minQty}` };
  }

  if (qty > maxQty) {
    return { ok: false, reason: `Qty ${qty} > maxQty ${maxQty}` };
  }

  // Round to valid step
  const remainder = qty % qtyStep;
  if (remainder > 0.0000001) {
    const adjustedQty = Math.floor(qty / qtyStep) * qtyStep;
    return { ok: true, adjustedQty, reason: `Qty rounded to step: ${qty} → ${adjustedQty}` };
  }

  return { ok: true };
}

// Export all functions
export default {
  validateOrderRequest,
  isMarketHealthy,
  calculateSafePrice,
  validateQuantity,
};
