// ================================================================
// src/risk/externalAccountAdapter.js
// EXTERNAL ACCOUNT ADAPTER - Stub for Bybit API integration
// ================================================================

/**
 * Fetch account balance from external exchange (Bybit)
 * @returns {Promise<Object>} Account balance data
 */
export async function fetchAccountBalance() {
  // TODO: Implement Bybit API call in future phases
  throw new Error("NOT_IMPLEMENTED: fetchAccountBalance() - Use SIM or DRY_RUN mode");
}

/**
 * Fetch open positions from external exchange (Bybit)
 * @returns {Promise<Array>} Array of open positions
 */
export async function fetchOpenPositions() {
  // TODO: Implement Bybit API call in future phases
  throw new Error("NOT_IMPLEMENTED: fetchOpenPositions() - Use SIM or DRY_RUN mode");
}

/**
 * Subscribe to position updates from external exchange (Bybit WebSocket)
 * @param {Function} callback - Callback for position updates
 */
export function subscribeToPositionUpdates(callback) {
  // TODO: Implement Bybit WebSocket subscription in future phases
  throw new Error("NOT_IMPLEMENTED: subscribeToPositionUpdates() - Use SIM or DRY_RUN mode");
}

/**
 * Place order on external exchange (Bybit)
 * @param {Object} orderParams - Order parameters
 * @returns {Promise<Object>} Order result
 */
export async function placeOrder(orderParams) {
  // TODO: Implement Bybit API call in future phases
  throw new Error("NOT_IMPLEMENTED: placeOrder() - Use SIM or DRY_RUN mode");
}

/**
 * Cancel order on external exchange (Bybit)
 * @param {string} orderId - Order ID
 * @returns {Promise<Object>} Cancel result
 */
export async function cancelOrder(orderId) {
  // TODO: Implement Bybit API call in future phases
  throw new Error("NOT_IMPLEMENTED: cancelOrder() - Use SIM or DRY_RUN mode");
}

console.log("[ExternalAccountAdapter] Stub loaded - Use SIM or DRY_RUN mode for testing");
