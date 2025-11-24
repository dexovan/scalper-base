// =======================================
// orderRouter.js — PHASE 10 (Execution Engine)
// =======================================
// Routes orders to SIM/DRY_RUN/LIVE venues
// JSON Lines logging for audit trail

import fs from "fs/promises";
import path from "path";
import CONFIG from "../config/index.js";
import paths from "../config/paths.js";
import safetyGuards from "./safetyGuards.js";
import simulatedExchange from "./simulatedExchange.js";
import bybitPrivateRest from "../connectors/bybitPrivateRest.js";

// Debug: Check if paths imported correctly
if (!paths || !paths.DATA_DIR) {
  console.error("❌ [ORDER ROUTER] paths import failed:", { paths, DATA_DIR: paths?.DATA_DIR });
}

/**
 * Route order to appropriate venue based on execution mode
 * @param {Object} orderRequest
 * @param {Object} marketSnapshot
 * @param {Object} riskSnapshot
 * @param {Object} regimeState
 * @returns {Promise<Object>} ExecutionOrder result
 */
export async function routeOrder(orderRequest, marketSnapshot, riskSnapshot, regimeState) {
  const startTime = Date.now();

  // ========================================
  // STEP 1: Safety validation
  // ========================================
  const validation = safetyGuards.validateOrderRequest(orderRequest, marketSnapshot, riskSnapshot, regimeState);

  if (!validation.ok) {
    const rejectedOrder = {
      clientOrderId: orderRequest.clientOrderId,
      exchangeOrderId: null,
      status: "REJECTED",
      symbol: orderRequest.symbol,
      side: orderRequest.side,
      type: orderRequest.type,
      price: orderRequest.price,
      qty: orderRequest.qty,
      filledQty: 0,
      avgFillPrice: 0,
      reduceOnly: orderRequest.reduceOnly,
      source: orderRequest.source,
      mode: CONFIG.execution.mode,
      rejectionReasons: validation.reasons,
      warnings: validation.warnings,
      createdAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
    };

    // Log rejected order
    await logOrder(rejectedOrder);

    return rejectedOrder;
  }

  // Use adjusted order if validation made changes
  const finalOrderRequest = validation.adjustedOrder;

  // ========================================
  // STEP 2: Route to venue based on mode
  // ========================================
  let executionResult;

  try {
    switch (CONFIG.execution.mode) {
      case "SIM":
        executionResult = await routeToSim(finalOrderRequest, marketSnapshot);
        break;

      case "DRY_RUN":
        executionResult = await routeToDryRun(finalOrderRequest, marketSnapshot);
        break;

      case "LIVE":
        executionResult = await routeToLive(finalOrderRequest, marketSnapshot);
        break;

      default:
        throw new Error(`Unknown execution mode: ${CONFIG.execution.mode}`);
    }
  } catch (error) {
    // Execution error
    const errorOrder = {
      clientOrderId: orderRequest.clientOrderId,
      exchangeOrderId: null,
      status: "REJECTED",
      symbol: orderRequest.symbol,
      side: orderRequest.side,
      type: orderRequest.type,
      price: orderRequest.price,
      qty: orderRequest.qty,
      filledQty: 0,
      avgFillPrice: 0,
      reduceOnly: orderRequest.reduceOnly,
      source: orderRequest.source,
      mode: CONFIG.execution.mode,
      rejectionReasons: [error.message],
      warnings: validation.warnings,
      createdAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
    };

    await logOrder(errorOrder);
    return errorOrder;
  }

  // ========================================
  // STEP 3: Build ExecutionOrder result
  // ========================================
  const executionOrder = {
    ...executionResult,
    warnings: validation.warnings,
    latencyMs: Date.now() - startTime,
    notionalUsd: executionResult.avgFillPrice * executionResult.filledQty,
  };

  // ========================================
  // STEP 4: Log order to JSON Lines file
  // ========================================
  await logOrder(executionOrder);

  return executionOrder;
}

/**
 * Route to simulated exchange (SIM mode)
 * @param {Object} orderRequest
 * @param {Object} marketSnapshot
 * @returns {Promise<Object>}
 */
async function routeToSim(orderRequest, marketSnapshot) {
  const simResult = simulatedExchange.placeOrderSim(orderRequest, marketSnapshot);

  return {
    clientOrderId: simResult.clientOrderId,
    exchangeOrderId: simResult.exchangeOrderId,
    status: simResult.status,
    symbol: simResult.symbol,
    side: simResult.side,
    type: simResult.type,
    price: simResult.price,
    qty: simResult.qty,
    filledQty: simResult.filledQty,
    avgFillPrice: simResult.avgFillPrice,
    reduceOnly: simResult.reduceOnly,
    source: simResult.source,
    mode: "SIM",
    createdAt: simResult.createdAt,
    filledAt: simResult.filledAt,
  };
}

/**
 * Route to dry run mode (simulated but logged as if real)
 * @param {Object} orderRequest
 * @param {Object} marketSnapshot
 * @returns {Promise<Object>}
 */
async function routeToDryRun(orderRequest, marketSnapshot) {
  // Same as SIM but marked as DRY_RUN
  const simResult = simulatedExchange.placeOrderSim(orderRequest, marketSnapshot);

  return {
    ...simResult,
    mode: "DRY_RUN",
  };
}

/**
 * Route to live exchange (Bybit)
 * @param {Object} orderRequest
 * @param {Object} marketSnapshot
 * @returns {Promise<Object>}
 */
async function routeToLive(orderRequest, marketSnapshot) {
  const result = await bybitPrivateRest.placeOrder(orderRequest);

  if (!result.ok) {
    throw new Error(result.error || "Bybit order placement failed");
  }

  // For MARKET orders, assume immediate fill (will be confirmed by WS)
  // For LIMIT orders, status is NEW until filled
  const isFilled = orderRequest.type === "MARKET";

  return {
    clientOrderId: result.clientOrderId,
    exchangeOrderId: result.exchangeOrderId,
    status: isFilled ? "FILLED" : "NEW",
    symbol: orderRequest.symbol,
    side: orderRequest.side,
    type: orderRequest.type,
    price: orderRequest.price,
    qty: orderRequest.qty,
    filledQty: isFilled ? orderRequest.qty : 0,
    avgFillPrice: isFilled ? (orderRequest.side === "BUY" ? marketSnapshot.bestAsk : marketSnapshot.bestBid) : 0,
    reduceOnly: orderRequest.reduceOnly,
    source: orderRequest.source,
    mode: "LIVE",
    createdAt: result.timestamp,
    filledAt: isFilled ? result.timestamp : null,
  };
}

/**
 * Log order to JSON Lines file (one JSON object per line)
 * @param {Object} executionOrder
 */
async function logOrder(executionOrder) {
  try {
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const logDir = path.join(paths.DATA_DIR, "orders");
    const logFile = path.join(logDir, `day-${date}.json`);

    // Ensure directory exists
    await fs.mkdir(logDir, { recursive: true });

    // Append JSON line
    const logLine = JSON.stringify(executionOrder) + "\n";
    await fs.appendFile(logFile, logLine, "utf8");
  } catch (error) {
    console.error("❌ Failed to log order:", error.message);
    // Don't throw - logging failure shouldn't stop execution
  }
}

/**
 * Read orders from log file
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<Array>} Array of orders
 */
export async function readOrderLog(date) {
  try {
    const logFile = path.join(paths.DATA_DIR, "orders", `day-${date}.json`);
    const content = await fs.readFile(logFile, "utf8");

    // Parse JSON Lines
    const lines = content.trim().split("\n");
    const orders = lines.map(line => JSON.parse(line));

    return orders;
  } catch (error) {
    if (error.code === "ENOENT") {
      return []; // No orders for this date
    }
    throw error;
  }
}

/**
 * Get today's orders
 * @returns {Promise<Array>}
 */
export async function getTodaysOrders() {
  const today = new Date().toISOString().split("T")[0];
  return readOrderLog(today);
}

/**
 * Get orders filtered by criteria
 * @param {Object} filters - { symbol?, status?, source?, side? }
 * @returns {Promise<Array>}
 */
export async function getFilteredOrders(filters = {}) {
  const orders = await getTodaysOrders();

  return orders.filter(order => {
    if (filters.symbol && order.symbol !== filters.symbol) return false;
    if (filters.status && order.status !== filters.status) return false;
    if (filters.source && order.source !== filters.source) return false;
    if (filters.side && order.side !== filters.side) return false;
    return true;
  });
}

// Export all functions
export default {
  routeOrder,
  readOrderLog,
  getTodaysOrders,
  getFilteredOrders,
};
