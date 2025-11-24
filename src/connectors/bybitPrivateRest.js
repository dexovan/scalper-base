// =======================================
// bybitPrivateRest.js — PHASE 10 (Execution Engine)
// =======================================
// Bybit Private REST API for order execution
// HMAC signature authentication, retry logic, error handling

import crypto from "crypto";
import CONFIG from "../config/index.js";

const RECV_WINDOW = 5000; // 5 seconds receive window

/**
 * Generate HMAC SHA256 signature for Bybit API
 * @param {string} timestamp
 * @param {string} apiKey
 * @param {string} recvWindow
 * @param {string} queryString
 * @param {string} apiSecret
 * @returns {string} Signature
 */
function generateSignature(timestamp, apiKey, recvWindow, queryString, apiSecret) {
  const message = timestamp + apiKey + recvWindow + queryString;
  return crypto.createHmac("sha256", apiSecret).update(message).digest("hex");
}

/**
 * Get API credentials from environment
 * @returns {Object} { apiKey, apiSecret, env }
 */
function getCredentials() {
  const apiKey = process.env.BYBIT_API_KEY || CONFIG.bybit.apiKey || "";
  const apiSecret = process.env.BYBIT_API_SECRET || CONFIG.bybit.apiSecret || "";
  const env = process.env.BYBIT_ENV || "TESTNET";

  if (!apiKey || !apiSecret) {
    throw new Error("Bybit API credentials not configured. Set BYBIT_API_KEY and BYBIT_API_SECRET env variables.");
  }

  return { apiKey, apiSecret, env };
}

/**
 * Get base URL based on environment
 * @param {string} env
 * @returns {string}
 */
function getBaseUrl(env) {
  if (env === "MAINNET") {
    return "https://api.bybit.com";
  }
  return "https://api-testnet.bybit.com";
}

/**
 * Make authenticated request to Bybit API
 * @param {string} method - GET or POST
 * @param {string} endpoint
 * @param {Object} params
 * @param {number} retryCount
 * @returns {Promise<Object>}
 */
async function makeRequest(method, endpoint, params = {}, retryCount = 0) {
  const { apiKey, apiSecret, env } = getCredentials();
  const baseUrl = getBaseUrl(env);
  const timestamp = Date.now().toString();
  const recvWindow = RECV_WINDOW.toString();

  let url = `${baseUrl}${endpoint}`;
  let queryString = "";
  let body = null;

  if (method === "GET") {
    // Query parameters in URL
    queryString = new URLSearchParams(params).toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  } else {
    // POST body
    queryString = JSON.stringify(params);
    body = queryString;
  }

  const signature = generateSignature(timestamp, apiKey, recvWindow, queryString, apiSecret);

  const headers = {
    "X-BAPI-API-KEY": apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-SIGN": signature,
    "X-BAPI-RECV-WINDOW": recvWindow,
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
    });

    const data = await response.json();

    // Check Bybit response code
    if (data.retCode !== 0) {
      // Retry on specific errors
      const retryableCodes = [10002, 10006]; // Rate limit, network errors
      if (retryableCodes.includes(data.retCode) && retryCount < CONFIG.execution.maxRetryCount) {
        console.warn(`⚠️  Bybit API error ${data.retCode}, retrying (${retryCount + 1}/${CONFIG.execution.maxRetryCount})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
        return makeRequest(method, endpoint, params, retryCount + 1);
      }

      throw new Error(`Bybit API error: ${data.retMsg} (code: ${data.retCode})`);
    }

    return data.result;
  } catch (error) {
    // Network errors - retry
    if (retryCount < CONFIG.execution.maxRetryCount && (error.code === "ECONNRESET" || error.code === "ETIMEDOUT")) {
      console.warn(`⚠️  Network error, retrying (${retryCount + 1}/${CONFIG.execution.maxRetryCount})...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return makeRequest(method, endpoint, params, retryCount + 1);
    }

    throw error;
  }
}

/**
 * Place order on Bybit
 * @param {Object} orderRequest
 * @returns {Promise<Object>} Order result from Bybit
 */
export async function placeOrder(orderRequest) {
  const params = {
    category: "linear", // Linear perpetuals
    symbol: orderRequest.symbol,
    side: orderRequest.side, // Buy or Sell
    orderType: orderRequest.type, // Market, Limit
    qty: orderRequest.qty.toString(),
    timeInForce: orderRequest.timeInForce || "GTC",
    orderLinkId: orderRequest.clientOrderId, // Client order ID
  };

  // Add price for LIMIT orders
  if (orderRequest.type === "Limit" && orderRequest.price) {
    params.price = orderRequest.price.toString();
  }

  // Add reduceOnly flag
  if (orderRequest.reduceOnly) {
    params.reduceOnly = true;
  }

  // Add trigger price for STOP/TP orders
  if (orderRequest.triggerPrice) {
    params.triggerPrice = orderRequest.triggerPrice.toString();
  }

  try {
    const result = await makeRequest("POST", "/v5/order/create", params);

    return {
      ok: true,
      exchangeOrderId: result.orderId,
      clientOrderId: result.orderLinkId,
      status: "NEW",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Cancel order on Bybit
 * @param {string} symbol
 * @param {string} orderId - Exchange order ID or client order ID
 * @returns {Promise<Object>}
 */
export async function cancelOrder(symbol, orderId) {
  const params = {
    category: "linear",
    symbol,
    orderId,
  };

  try {
    const result = await makeRequest("POST", "/v5/order/cancel", params);

    return {
      ok: true,
      exchangeOrderId: result.orderId,
      status: "CANCELED",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Get open orders from Bybit
 * @param {string} symbol - Optional symbol filter
 * @returns {Promise<Array>} Array of open orders
 */
export async function getOpenOrders(symbol = null) {
  const params = {
    category: "linear",
  };

  if (symbol) {
    params.symbol = symbol;
  }

  try {
    const result = await makeRequest("GET", "/v5/order/realtime", params);
    return result.list || [];
  } catch (error) {
    console.error("❌ Failed to get open orders:", error.message);
    return [];
  }
}

/**
 * Get current position for symbol
 * @param {string} symbol
 * @returns {Promise<Object|null>} Position or null
 */
export async function getPosition(symbol) {
  const params = {
    category: "linear",
    symbol,
  };

  try {
    const result = await makeRequest("GET", "/v5/position/list", params);
    const positions = result.list || [];

    // Find position with size > 0
    const activePosition = positions.find(p => parseFloat(p.size) !== 0);

    if (!activePosition) {
      return null;
    }

    return {
      symbol: activePosition.symbol,
      side: activePosition.side, // Buy or Sell
      size: parseFloat(activePosition.size),
      entryPrice: parseFloat(activePosition.avgPrice),
      markPrice: parseFloat(activePosition.markPrice),
      unrealisedPnl: parseFloat(activePosition.unrealisedPnl),
      leverage: parseFloat(activePosition.leverage),
    };
  } catch (error) {
    console.error("❌ Failed to get position:", error.message);
    return null;
  }
}

/**
 * Get account balance
 * @returns {Promise<Object>} Balance info
 */
export async function getBalance() {
  const params = {
    accountType: "CONTRACT",
  };

  try {
    const result = await makeRequest("GET", "/v5/account/wallet-balance", params);
    const account = result.list?.[0];

    if (!account) {
      return { totalEquity: 0, availableBalance: 0 };
    }

    return {
      totalEquity: parseFloat(account.totalEquity || 0),
      availableBalance: parseFloat(account.availableBalance || 0),
      totalMarginBalance: parseFloat(account.totalMarginBalance || 0),
    };
  } catch (error) {
    console.error("❌ Failed to get balance:", error.message);
    return { totalEquity: 0, availableBalance: 0 };
  }
}

// Export all functions
export default {
  placeOrder,
  cancelOrder,
  getOpenOrders,
  getPosition,
  getBalance,
};
