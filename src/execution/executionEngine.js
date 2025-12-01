// =======================================
// executionEngine.js — PHASE 10 (Execution Engine)
// =======================================
// Main execution engine - orchestrates order submission, fill tracking, panic close
// Event-driven architecture for State Machine integration

import fs from "fs/promises";
import path from "path";
import CONFIG from "../config/index.js";
import paths from "../config/paths.js";
import orderRouter from "./orderRouter.js";
import simulatedExchange from "./simulatedExchange.js";
import * as accountState from "../risk/accountState.js";

// =======================================
// EXECUTION ENGINE STATE
// =======================================
const executionState = {
  mode: CONFIG.execution.mode,
  safeMode: false,
  safeModeReason: null,
  pendingOrders: new Map(), // clientOrderId -> ExecutionOrder
  lastErrorAt: null,
  lastErrorMessage: null,
  initAt: null,
};

// =======================================
// EVENT EMITTER (for State Machine integration)
// =======================================
const eventListeners = new Map();

function emitEvent(eventType, eventData) {
  const listeners = eventListeners.get(eventType) || [];
  listeners.forEach(callback => {
    try {
      callback(eventData);
    } catch (error) {
      console.error(`❌ Event listener error [${eventType}]:`, error.message);
    }
  });
}

export function addEventListener(eventType, callback) {
  if (!eventListeners.has(eventType)) {
    eventListeners.set(eventType, []);
  }
  eventListeners.get(eventType).push(callback);
}

/**
 * Handle TPSL_TP1_HIT event - execute partial close (50%)
 * @param {Object} tpslEvent - Event from TPSL engine with symbol, side, partialCloseQty
 */
export async function handleTpslTp1Hit(tpslEvent) {
  const { symbol, side, partialCloseQty } = tpslEvent;

  console.log(`💰 [EXEC] TPSL_TP1_HIT received for ${symbol} - closing ${partialCloseQty} qty`);

  try {
    // Import bybitOrderExecutor dynamically
    const { partialClosePosition } = await import('./bybitOrderExecutor.js');

    // Convert side format (LONG -> Buy, SHORT -> Sell)
    const orderSide = side === 'LONG' ? 'Buy' : 'Sell';

    // Execute partial close
    const success = await partialClosePosition(symbol, orderSide, partialCloseQty);

    if (success) {
      console.log(`✅ [EXEC] Partial close successful for ${symbol}`);
    } else {
      console.error(`❌ [EXEC] Partial close failed for ${symbol}`);
    }

  } catch (error) {
    console.error(`❌ [EXEC] Error handling TPSL_TP1_HIT: ${error.message}`);
  }
}

// =======================================
// INITIALIZATION
// =======================================
export function initExecutionEngine(config = {}) {
  console.log("💹 [EXEC] Initializing Execution Engine...");

  // Override config if provided
  if (config.mode) {
    executionState.mode = config.mode;
  }

  executionState.safeMode = false;
  executionState.safeModeReason = null;
  executionState.pendingOrders.clear();
  executionState.initAt = new Date().toISOString();

  console.log(`💹 [EXEC] Mode: ${executionState.mode}`);
  console.log(`💹 [EXEC] Safe Mode: ${executionState.safeMode}`);
  console.log("✅ [EXEC] Execution Engine initialized");

  // Start snapshot save timer (every 10 seconds)
  setInterval(() => {
    saveExecutionSnapshot().catch(err => {
      console.error("❌ Failed to save execution snapshot:", err.message);
    });
  }, 10000);
}

// =======================================
// SUBMIT ORDER (Main entry point)
// =======================================
export async function submitOrder(request) {
  console.log(`💹 [EXEC] submitOrder: ${request.symbol} ${request.side} ${request.action}`);

  // Check safe mode
  if (executionState.safeMode && !request.reduceOnly) {
    console.warn(`⚠️  [EXEC] Safe mode active - rejecting non-reduceOnly order`);
    emitEvent("EXECUTION_ORDER_REJECTED", {
      symbol: request.symbol,
      side: request.side,
      reason: `Safe mode: ${executionState.safeModeReason}`,
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  // ========================================
  // Convert request to OrderRequest format
  // ========================================
  const orderRequest = buildOrderRequest(request);

  // ========================================
  // Get market snapshot
  // ========================================
  const marketSnapshot = getMarketSnapshot(request.symbol);

  // ========================================
  // Get risk snapshot
  // ========================================
  const riskSnapshot = getRiskSnapshot();

  // ========================================
  // Get regime state
  // ========================================
  const regimeState = getRegimeState(request.symbol);

  // ========================================
  // Route order through orderRouter
  // ========================================
  try {
    const executionOrder = await orderRouter.routeOrder(
      orderRequest,
      marketSnapshot,
      riskSnapshot,
      regimeState
    );

    // ========================================
    // Handle result based on status
    // ========================================
    if (executionOrder.status === "REJECTED") {
      console.warn(`⚠️  [EXEC] Order rejected: ${executionOrder.rejectionReasons.join(", ")}`);

      emitEvent("EXECUTION_ORDER_REJECTED", {
        symbol: executionOrder.symbol,
        side: executionOrder.side,
        reasons: executionOrder.rejectionReasons,
        warnings: executionOrder.warnings,
        timestamp: executionOrder.createdAt,
      });

      return executionOrder;
    }

    if (executionOrder.status === "NEW") {
      // Pending order - add to tracking
      executionState.pendingOrders.set(executionOrder.clientOrderId, executionOrder);

      emitEvent("EXECUTION_ORDER_PLACED", {
        symbol: executionOrder.symbol,
        side: executionOrder.side,
        type: executionOrder.type,
        price: executionOrder.price,
        qty: executionOrder.qty,
        clientOrderId: executionOrder.clientOrderId,
        exchangeOrderId: executionOrder.exchangeOrderId,
        timestamp: executionOrder.createdAt,
      });

      console.log(`✅ [EXEC] Order placed: ${executionOrder.clientOrderId}`);
      return executionOrder;
    }

    if (executionOrder.status === "FILLED") {
      // Immediate fill
      console.log(`✅ [EXEC] Order filled: ${executionOrder.clientOrderId} @ ${executionOrder.avgFillPrice}`);

      emitEvent("EXECUTION_ORDER_FILLED", {
        symbol: executionOrder.symbol,
        side: executionOrder.side,
        qty: executionOrder.filledQty,
        avgFillPrice: executionOrder.avgFillPrice,
        clientOrderId: executionOrder.clientOrderId,
        exchangeOrderId: executionOrder.exchangeOrderId,
        timestamp: executionOrder.filledAt,
      });

      // Emit position event
      handlePositionEvent(executionOrder, request.action);

      return executionOrder;
    }

    return executionOrder;

  } catch (error) {
    console.error(`❌ [EXEC] Order submission failed:`, error.message);

    executionState.lastErrorAt = new Date().toISOString();
    executionState.lastErrorMessage = error.message;

    // Activate safe mode on critical errors
    if (CONFIG.execution.safeModeOnNetworkErrors) {
      activateSafeMode(`Network error: ${error.message}`);
    }

    return null;
  }
}

// =======================================
// BUILD ORDER REQUEST
// =======================================
function buildOrderRequest(request) {
  // Convert LONG/SHORT to BUY/SELL
  let side;
  if (request.action === "OPEN") {
    side = request.side === "LONG" ? "BUY" : "SELL";
  } else if (request.action === "CLOSE") {
    side = request.side === "LONG" ? "SELL" : "BUY"; // Opposite
  } else if (request.action === "REVERSE") {
    // Close current + open opposite
    side = request.side === "LONG" ? "SELL" : "BUY";
  } else if (request.side === "LONG" || request.side === "SHORT") {
    // Direct side mapping when no action specified
    side = request.side === "LONG" ? "BUY" : "SELL";
  } else {
    // Already BUY/SELL
    side = request.side;
  }

  // Generate client order ID
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  const clientOrderId = `${CONFIG.execution.clientOrderIdPrefix}-${timestamp}-${random}`;

  // Calculate qty from qtyUsd or use qtyContracts or qty
  let qty = request.qtyContracts || request.qty || 0;
  if (request.qtyUsd && !qty) {
    const marketSnapshot = getMarketSnapshot(request.symbol);
    const price = marketSnapshot.lastPrice || 0;
    qty = price > 0 ? request.qtyUsd / price : 0;
  }

  return {
    symbol: request.symbol,
    side,
    type: request.preferredType || "MARKET",
    price: request.limitPrice || null,
    triggerPrice: request.triggerPrice || null,
    qty,
    reduceOnly: request.reduceOnly || request.action === "CLOSE",
    timeInForce: request.timeInForce || "GTC",
    clientOrderId,
    source: request.source || "STATE_MACHINE",
    mode: executionState.mode,
  };
}

// =======================================
// HANDLE FILL UPDATE (from WS or manual)
// =======================================
export function handleFillUpdate(fillUpdate) {
  const { clientOrderId, filledQty, avgFillPrice, status } = fillUpdate;

  const pendingOrder = executionState.pendingOrders.get(clientOrderId);
  if (!pendingOrder) {
    console.warn(`⚠️  [EXEC] Fill update for unknown order: ${clientOrderId}`);
    return;
  }

  // Update order
  pendingOrder.filledQty = filledQty;
  pendingOrder.avgFillPrice = avgFillPrice;
  pendingOrder.status = status;

  if (status === "FILLED") {
    pendingOrder.filledAt = new Date().toISOString();
    executionState.pendingOrders.delete(clientOrderId);

    emitEvent("EXECUTION_ORDER_FILLED", {
      symbol: pendingOrder.symbol,
      side: pendingOrder.side,
      qty: filledQty,
      avgFillPrice,
      clientOrderId,
      exchangeOrderId: pendingOrder.exchangeOrderId,
      timestamp: pendingOrder.filledAt,
    });

    // Emit position event
    handlePositionEvent(pendingOrder, "OPEN"); // Assume open for now
  }

  if (status === "CANCELED") {
    executionState.pendingOrders.delete(clientOrderId);

    emitEvent("EXECUTION_ORDER_CANCELED", {
      symbol: pendingOrder.symbol,
      side: pendingOrder.side,
      clientOrderId,
      timestamp: new Date().toISOString(),
    });
  }
}

// =======================================
// HANDLE POSITION EVENTS
// =======================================
function handlePositionEvent(executionOrder, action) {
  if (action === "OPEN") {
    // 🔥 Get position data from accountState for rich event
    let leverage = 1;
    let featureState = null;
    let regimeState = null;

    try {
      const posData = accountState.getPositionBySymbol(executionOrder.symbol);
      if (posData) {
        leverage = posData.leverage || 1;
      }

      // Try to get feature and regime state from global context
      if (global.featureEngine) {
        featureState = global.featureEngine.getFeatureState?.(executionOrder.symbol);
      }
      if (global.regimeEngine) {
        regimeState = global.regimeEngine.getRegimeState?.(executionOrder.symbol);
      }
    } catch (err) {
      // Silently continue - not critical
    }

    emitEvent("EXECUTION_POSITION_OPENED", {
      symbol: executionOrder.symbol,
      side: executionOrder.side === "BUY" ? "LONG" : "SHORT",
      entryPrice: executionOrder.avgFillPrice,
      qty: executionOrder.filledQty,
      notionalUsd: executionOrder.avgFillPrice * executionOrder.filledQty,
      leverage: leverage,
      featureState: featureState,
      regimeState: regimeState,
      timestamp: executionOrder.filledAt,
    });
  } else if (action === "CLOSE") {
    emitEvent("EXECUTION_POSITION_CLOSED", {
      symbol: executionOrder.symbol,
      side: executionOrder.side === "SELL" ? "LONG" : "SHORT", // Opposite
      exitPrice: executionOrder.avgFillPrice,
      qty: executionOrder.filledQty,
      timestamp: executionOrder.filledAt,
    });
  }
}

// =======================================
// PANIC CLOSE
// =======================================
export async function panicCloseAll(reason) {
  console.warn(`⚠️  [EXEC] PANIC CLOSE ALL: ${reason}`);

  activateSafeMode(reason);

  // Get all active positions (from positionTracker if available)
  const positions = getActivePositions();

  for (const position of positions) {
    await panicCloseSymbol(position.symbol, reason);
  }

  emitEvent("EXECUTION_PANIC_CLOSE_ALL", {
    reason,
    positionCount: positions.length,
    timestamp: new Date().toISOString(),
  });
}

export async function panicCloseSymbol(symbol, reason) {
  console.warn(`⚠️  [EXEC] PANIC CLOSE ${symbol}: ${reason}`);

  // Cancel all pending orders for symbol
  const pendingOrdersForSymbol = Array.from(executionState.pendingOrders.values())
    .filter(order => order.symbol === symbol);

  for (const order of pendingOrdersForSymbol) {
    if (executionState.mode === "LIVE") {
      // Cancel on exchange
      // await bybitPrivateRest.cancelOrder(symbol, order.exchangeOrderId);
    }
    executionState.pendingOrders.delete(order.clientOrderId);
  }

  // Get current position
  const position = getPosition(symbol);
  if (!position || position.qty === 0) {
    console.log(`ℹ️  [EXEC] No position to close for ${symbol}`);
    return;
  }

  // Submit MARKET reduceOnly close order
  await submitOrder({
    symbol,
    side: position.side, // LONG or SHORT
    action: "CLOSE",
    qtyContracts: Math.abs(position.qty),
    preferredType: "MARKET",
    reduceOnly: true,
    source: "PANIC_CLOSE",
  });

  emitEvent("EXECUTION_PANIC_CLOSE_SYMBOL", {
    symbol,
    reason,
    timestamp: new Date().toISOString(),
  });
}

// =======================================
// SAFE MODE
// =======================================
export function activateSafeMode(reason) {
  executionState.safeMode = true;
  executionState.safeModeReason = reason;
  console.warn(`⚠️  [EXEC] SAFE MODE ACTIVATED: ${reason}`);

  emitEvent("EXECUTION_SAFE_MODE_ACTIVATED", {
    reason,
    timestamp: new Date().toISOString(),
  });
}

export function deactivateSafeMode() {
  executionState.safeMode = false;
  executionState.safeModeReason = null;
  console.log(`✅ [EXEC] Safe mode deactivated`);

  emitEvent("EXECUTION_SAFE_MODE_DEACTIVATED", {
    timestamp: new Date().toISOString(),
  });
}

// =======================================
// GETTERS
// =======================================
export function getExecutionState() {
  return {
    mode: executionState.mode,
    safeMode: executionState.safeMode,
    safeModeReason: executionState.safeModeReason,
    pendingOrdersCount: executionState.pendingOrders.size,
    lastErrorAt: executionState.lastErrorAt,
    lastErrorMessage: executionState.lastErrorMessage,
    initAt: executionState.initAt,
  };
}

export function getPendingOrders() {
  return Array.from(executionState.pendingOrders.values());
}

// =======================================
// HELPER FUNCTIONS (use global state from other engines)
// =======================================
function getMarketSnapshot(symbol) {
  // Get from global.marketData if available
  if (global.marketData?.getSnapshot) {
    return global.marketData.getSnapshot(symbol);
  }

  // Fallback
  return {
    symbol,
    bestBid: 50000,
    bestAsk: 50001,
    lastPrice: 50000.5,
    spreadPct: 0.002,
    tickSize: 0.1,
    minQty: 0.001,
    maxQty: 100,
    qtyStep: 0.001,
  };
}

function getRiskSnapshot() {
  if (global.riskEngine?.getRiskSnapshot) {
    const snapshot = global.riskEngine.getRiskSnapshot();
    if (snapshot && snapshot.riskFlags) {
      return {
        allowNewPositions: snapshot.riskFlags.riskAllowNewPositions,
        allowNewLong: snapshot.riskFlags.riskAllowNewLong,
        allowNewShort: snapshot.riskFlags.riskAllowNewShort,
        safeMode: snapshot.riskFlags.riskForceCloseAll || false,
        blockReason: snapshot.riskFlags.dailyLossLimitHit ? 'Daily loss limit hit' : null,
      };
    }
  }

  return {
    allowNewPositions: true,
    allowNewLong: true,
    allowNewShort: true,
    safeMode: false,
  };
}

function getRegimeState(symbol) {
  if (global.regimeEngine?.getSymbolRegime) {
    return global.regimeEngine.getSymbolRegime(symbol);
  }

  return { current: "NORMAL" };
}

function getActivePositions() {
  if (global.positionTracker?.getAllPositions) {
    return global.positionTracker.getAllPositions();
  }

  return [];
}

function getPosition(symbol) {
  if (global.positionTracker?.getPosition) {
    return global.positionTracker.getPosition(symbol);
  }

  return null;
}

// =======================================
// PERSISTENCE
// =======================================
async function saveExecutionSnapshot() {
  try {
    const snapshotPath = path.join(paths.DATA_DIR, "system", "execution_snapshot.json");    const snapshot = {
      ...getExecutionState(),
      pendingOrders: getPendingOrders(),
      timestamp: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (error) {
    console.error("❌ Failed to save execution snapshot:", error.message);
  }
}

// Export all functions
export default {
  initExecutionEngine,
  submitOrder,
  handleFillUpdate,
  panicCloseAll,
  panicCloseSymbol,
  activateSafeMode,
  deactivateSafeMode,
  getExecutionState,
  getPendingOrders,
  addEventListener,
  handleTpslTp1Hit,
};
