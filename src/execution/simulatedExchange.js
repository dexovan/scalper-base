// =======================================
// simulatedExchange.js — PHASE 10 (Execution Engine)
// =======================================
// Simulates exchange behavior for SIM and DRY_RUN modes
// Instant fills with realistic slippage and order lifecycle

import CONFIG from "../config/index.js";

// In-memory storage for simulated orders
const simOrders = new Map(); // clientOrderId -> SimOrder
let simOrderCounter = 1;

/**
 * SimOrder structure
 * {
 *   clientOrderId: string,
 *   exchangeOrderId: string,
 *   symbol: string,
 *   side: "BUY" | "SELL",
 *   type: "MARKET" | "LIMIT",
 *   price: number | null,
 *   qty: number,
 *   filledQty: number,
 *   avgFillPrice: number,
 *   status: "NEW" | "FILLED" | "CANCELED",
 *   reduceOnly: boolean,
 *   createdAt: string,
 *   filledAt: string | null,
 * }
 */

/**
 * Place order in simulated exchange
 * @param {Object} orderRequest
 * @param {Object} marketSnapshot
 * @returns {Object} SimOrder with fill result
 */
export function placeOrderSim(orderRequest, marketSnapshot) {
  const exchangeOrderId = `SIM-${String(simOrderCounter++).padStart(8, "0")}`;
  const createdAt = new Date().toISOString();

  // Create base sim order
  const simOrder = {
    clientOrderId: orderRequest.clientOrderId,
    exchangeOrderId,
    symbol: orderRequest.symbol,
    side: orderRequest.side,
    type: orderRequest.type,
    price: orderRequest.price,
    qty: orderRequest.qty,
    filledQty: 0,
    avgFillPrice: 0,
    status: "NEW",
    reduceOnly: orderRequest.reduceOnly || false,
    createdAt,
    filledAt: null,
    source: orderRequest.source || "UNKNOWN",
    mode: orderRequest.mode || "SIM",
  };

  // ========================================
  // MARKET ORDER - Instant fill with slippage
  // ========================================
  if (orderRequest.type === "MARKET") {
    const fillPrice = calculateMarketFillPrice(orderRequest.side, marketSnapshot);

    simOrder.filledQty = orderRequest.qty;
    simOrder.avgFillPrice = fillPrice;
    simOrder.status = "FILLED";
    simOrder.filledAt = createdAt; // Instant fill in simulation

    simOrders.set(orderRequest.clientOrderId, simOrder);

    return simOrder;
  }

  // ========================================
  // LIMIT ORDER - Check if immediately fillable
  // ========================================
  if (orderRequest.type === "LIMIT") {
    const isFillable = checkLimitOrderFillable(orderRequest.side, orderRequest.price, marketSnapshot);

    if (isFillable) {
      // Instant fill at limit price
      simOrder.filledQty = orderRequest.qty;
      simOrder.avgFillPrice = orderRequest.price;
      simOrder.status = "FILLED";
      simOrder.filledAt = createdAt;
    } else {
      // Pending (in real system, would wait for price to reach limit)
      simOrder.status = "NEW";
    }

    simOrders.set(orderRequest.clientOrderId, simOrder);
    return simOrder;
  }

  // ========================================
  // STOP_MARKET / TAKE_PROFIT_MARKET
  // ========================================
  // For now, just mark as NEW (would trigger later in real system)
  simOrders.set(orderRequest.clientOrderId, simOrder);
  return simOrder;
}

/**
 * Calculate realistic fill price for MARKET order with slippage
 * @param {string} side - BUY or SELL
 * @param {Object} marketSnapshot
 * @returns {number} Fill price
 */
function calculateMarketFillPrice(side, marketSnapshot) {
  const slippageBps = CONFIG.execution.simSlippageBps || 2; // 0.02% default
  const slippageFactor = slippageBps / 10000;

  if (side === "BUY") {
    // Buy at ask + slippage
    const basePrice = marketSnapshot.bestAsk || marketSnapshot.lastPrice;
    return basePrice * (1 + slippageFactor);
  } else {
    // Sell at bid - slippage
    const basePrice = marketSnapshot.bestBid || marketSnapshot.lastPrice;
    return basePrice * (1 - slippageFactor);
  }
}

/**
 * Check if LIMIT order would fill immediately
 * @param {string} side
 * @param {number} limitPrice
 * @param {Object} marketSnapshot
 * @returns {boolean}
 */
function checkLimitOrderFillable(side, limitPrice, marketSnapshot) {
  if (side === "BUY") {
    // BUY limit fills if limitPrice >= bestAsk
    const bestAsk = marketSnapshot.bestAsk || marketSnapshot.lastPrice;
    return limitPrice >= bestAsk;
  } else {
    // SELL limit fills if limitPrice <= bestBid
    const bestBid = marketSnapshot.bestBid || marketSnapshot.lastPrice;
    return limitPrice <= bestBid;
  }
}

/**
 * Cancel simulated order
 * @param {string} clientOrderId
 * @returns {Object} { ok: boolean, order?: SimOrder, reason?: string }
 */
export function cancelOrderSim(clientOrderId) {
  const simOrder = simOrders.get(clientOrderId);

  if (!simOrder) {
    return { ok: false, reason: `Order ${clientOrderId} not found` };
  }

  if (simOrder.status === "FILLED") {
    return { ok: false, reason: `Order ${clientOrderId} already filled` };
  }

  if (simOrder.status === "CANCELED") {
    return { ok: false, reason: `Order ${clientOrderId} already canceled` };
  }

  // Cancel the order
  simOrder.status = "CANCELED";
  simOrder.canceledAt = new Date().toISOString();

  return { ok: true, order: simOrder };
}

/**
 * Get all open (not filled/canceled) simulated orders
 * @param {string} symbol - Optional symbol filter
 * @returns {Array} Array of open SimOrders
 */
export function getOpenOrdersSim(symbol = null) {
  const openOrders = [];

  for (const [clientOrderId, simOrder] of simOrders.entries()) {
    if (simOrder.status === "NEW") {
      if (!symbol || simOrder.symbol === symbol) {
        openOrders.push(simOrder);
      }
    }
  }

  return openOrders;
}

/**
 * Get specific simulated order
 * @param {string} clientOrderId
 * @returns {Object|null} SimOrder or null
 */
export function getOrderSim(clientOrderId) {
  return simOrders.get(clientOrderId) || null;
}

/**
 * Get all simulated orders (for debugging)
 * @returns {Array} All SimOrders
 */
export function getAllOrdersSim() {
  return Array.from(simOrders.values());
}

/**
 * Clear all simulated orders (for testing/reset)
 */
export function clearAllOrdersSim() {
  simOrders.clear();
  simOrderCounter = 1;
}

/**
 * Manually trigger fill for pending LIMIT order (for testing)
 * @param {string} clientOrderId
 * @param {number} fillPrice
 * @returns {Object} { ok: boolean, order?: SimOrder }
 */
export function fillOrderManually(clientOrderId, fillPrice) {
  const simOrder = simOrders.get(clientOrderId);

  if (!simOrder) {
    return { ok: false, reason: `Order ${clientOrderId} not found` };
  }

  if (simOrder.status !== "NEW") {
    return { ok: false, reason: `Order ${clientOrderId} not in NEW status` };
  }

  simOrder.filledQty = simOrder.qty;
  simOrder.avgFillPrice = fillPrice;
  simOrder.status = "FILLED";
  simOrder.filledAt = new Date().toISOString();

  return { ok: true, order: simOrder };
}

// Export all functions
export default {
  placeOrderSim,
  cancelOrderSim,
  getOpenOrdersSim,
  getOrderSim,
  getAllOrdersSim,
  clearAllOrdersSim,
  fillOrderManually,
};
