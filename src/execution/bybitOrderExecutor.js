// ============================================================
// BYBIT ORDER EXECUTOR
// Executes trades on Bybit with TP/SL (OCO orders)
// ============================================================

import crypto from 'crypto';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// MANUAL .ENV LOADER (Backup if PM2 env_file fails)
// ============================================================

function loadEnvFile() {
  const envPath = path.join(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) {
    console.warn('⚠️  [ENV] .env file not found at:', envPath);
    return {};
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env = {};

  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });

  console.log(`✅ [ENV] Manually loaded .env file from: ${envPath}`);
  return env;
}

// Load .env manually as fallback
const manualEnv = loadEnvFile();

// ============================================================
// CONFIGURATION
// ============================================================

const EXECUTION_CONFIG = {
  enabled: true,  // 🔥 LIVE TRADING MODE
  apiKey: process.env.BYBIT_API_KEY || manualEnv.BYBIT_API_KEY || '',
  apiSecret: process.env.BYBIT_API_SECRET || manualEnv.BYBIT_API_SECRET || '',
  baseUrl: 'https://api.bybit.com',  // Mainnet
  // baseUrl: 'https://api-testnet.bybit.com',  // Testnet

  // Risk management
  maxPositions: 1,           // Max 1 concurrent position (start conservative)
  minBalance: 20,            // Min USDT balance to trade (lowered for testing)
  defaultLeverage: 5,        // 5x leverage
  defaultMargin: 25,         // $25 per trade (~$125 notional)

  // Order settings
  orderType: 'Market',       // Market orders for instant fill
  timeInForce: 'GTC',        // Good Till Cancel
  reduceOnly: false,
  closeOnTrigger: false
};

// Active positions tracker
const activePositions = new Map(); // symbol -> {orderId, side, size, entry, tp, sl}

// ============================================================
// BYBIT API SIGNATURE
// ============================================================

function createSignature(params, apiSecret) {
  const orderedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});

  const queryString = Object.entries(orderedParams)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
}

// ============================================================
// BYBIT API REQUEST
// ============================================================

async function bybitRequest(endpoint, method = 'GET', params = {}) {
  if (!EXECUTION_CONFIG.apiKey || !EXECUTION_CONFIG.apiSecret) {
    throw new Error('Bybit API credentials not configured');
  }

  const timestamp = Date.now();
  const requestParams = {
    api_key: EXECUTION_CONFIG.apiKey,
    timestamp,
    ...params
  };

  const signature = createSignature(requestParams, EXECUTION_CONFIG.apiSecret);
  requestParams.sign = signature;

  const url = `${EXECUTION_CONFIG.baseUrl}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (method === 'GET') {
    const queryString = new URLSearchParams(requestParams).toString();
    const response = await fetch(`${url}?${queryString}`, options);
    return await response.json();
  } else {
    options.body = JSON.stringify(requestParams);
    const response = await fetch(url, options);
    return await response.json();
  }
}

// ============================================================
// PLACE MARKET ORDER
// ============================================================

async function placeMarketOrder(symbol, side, qty) {
  const params = {
    category: 'linear',
    symbol,
    side,  // 'Buy' or 'Sell'
    orderType: EXECUTION_CONFIG.orderType,
    qty: qty.toString(),
    timeInForce: EXECUTION_CONFIG.timeInForce,
    reduceOnly: EXECUTION_CONFIG.reduceOnly,
    closeOnTrigger: EXECUTION_CONFIG.closeOnTrigger
  };

  console.log(`📤 [BYBIT] Placing ${side} market order: ${symbol} qty=${qty}`);

  const response = await bybitRequest('/v5/order/create', 'POST', params);

  if (response.retCode !== 0) {
    throw new Error(`Bybit order failed: ${response.retMsg}`);
  }

  console.log(`✅ [BYBIT] Order placed: ${response.result.orderId}`);
  return response.result;
}

// ============================================================
// SET TP/SL (Trading Stop)
// ============================================================

async function setTakeProfitStopLoss(symbol, side, positionIdx, takeProfit, stopLoss) {
  const params = {
    category: 'linear',
    symbol,
    takeProfit: takeProfit.toString(),
    stopLoss: stopLoss.toString(),
    tpTriggerBy: 'LastPrice',
    slTriggerBy: 'LastPrice',
    positionIdx: positionIdx || 0  // 0 = one-way mode
  };

  console.log(`📤 [BYBIT] Setting TP/SL: ${symbol} TP=${takeProfit} SL=${stopLoss}`);

  const response = await bybitRequest('/v5/position/trading-stop', 'POST', params);

  if (response.retCode !== 0) {
    console.error(`⚠️  [BYBIT] TP/SL failed: ${response.retMsg}`);
    return null;
  }

  console.log(`✅ [BYBIT] TP/SL set successfully`);
  return response.result;
}

// ============================================================
// GET INSTRUMENT INFO (Price & Qty Precision)
// ============================================================

async function getInstrumentInfo(symbol) {
  try {
    const url = `${EXECUTION_CONFIG.baseUrl}/v5/market/instruments-info?category=linear&symbol=${symbol}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.retCode !== 0 || !data.result?.list?.[0]) {
      throw new Error(`Instrument info failed: ${data.retMsg}`);
    }

    const info = data.result.list[0];
    return {
      tickSize: parseFloat(info.priceFilter.tickSize),
      qtyStep: parseFloat(info.lotSizeFilter.qtyStep),
      minOrderQty: parseFloat(info.lotSizeFilter.minOrderQty),
      maxOrderQty: parseFloat(info.lotSizeFilter.maxOrderQty)
    };
  } catch (error) {
    console.error(`❌ [BYBIT] Instrument info error:`, error.message);
    // Fallback to conservative defaults
    return {
      tickSize: 0.01,
      qtyStep: 0.001,
      minOrderQty: 0.001,
      maxOrderQty: 10000
    };
  }
}

// ============================================================
// ROUND PRICE TO TICK SIZE
// ============================================================

function roundToTickSize(price, tickSize) {
  const rounded = Math.round(price / tickSize) * tickSize;
  // Format with correct decimals to match tickSize
  const decimals = tickSize.toString().split('.')[1]?.length || 0;
  return parseFloat(rounded.toFixed(decimals));
}

// ============================================================
// ROUND QTY TO QTY STEP
// ============================================================

function roundToQtyStep(qty, qtyStep) {
  const rounded = Math.floor(qty / qtyStep) * qtyStep;
  // Format with correct decimals to match qtyStep
  const decimals = qtyStep.toString().split('.')[1]?.length || 0;
  return parseFloat(rounded.toFixed(decimals));
}

// ============================================================
// GET WALLET BALANCE
// ============================================================

async function getWalletBalance() {
  try {
    // DEBUG: Verify credentials before API call
    console.log(`🔍 [BALANCE] Checking credentials before API call...`);
    console.log(`   API Key: ${EXECUTION_CONFIG.apiKey ? `${EXECUTION_CONFIG.apiKey.substring(0, 10)}...` : '❌ EMPTY'}`);
    console.log(`   API Secret: ${EXECUTION_CONFIG.apiSecret ? `${EXECUTION_CONFIG.apiSecret.length} chars` : '❌ EMPTY'}`);

    if (!EXECUTION_CONFIG.apiKey || !EXECUTION_CONFIG.apiSecret) {
      throw new Error('Bybit API credentials not configured');
    }

    // Try UNIFIED account first
    let response = await bybitRequest('/v5/account/wallet-balance', 'GET', {
      accountType: 'UNIFIED'
    });

    console.log('📊 [BYBIT] wallet-balance UNIFIED raw response:', JSON.stringify(response, null, 2));

    if (response.retCode !== 0) {
      console.warn(`⚠️  [BYBIT] UNIFIED balance error: ${response.retMsg} (code: ${response.retCode})`);
      console.warn(`⚠️  [BYBIT] Trying CONTRACT account type...`);

      // Fallback to CONTRACT account
      response = await bybitRequest('/v5/account/wallet-balance', 'GET', {
        accountType: 'CONTRACT'
      });

      console.log('📊 [BYBIT] wallet-balance CONTRACT raw response:', JSON.stringify(response, null, 2));

      if (response.retCode !== 0) {
        throw new Error(`Both UNIFIED and CONTRACT balance failed: ${response.retMsg} (code: ${response.retCode})`);
      }
    }

    // Extract USDT balance from all accounts in list
    const list = response.result?.list || [];
    let balance = 0;

    for (const acc of list) {
      const usdtCoin = acc.coin?.find(c => c.coin === 'USDT');
      if (usdtCoin) {
        const walletBal = parseFloat(usdtCoin.walletBalance || 0);
        balance += walletBal;
        console.log(`   → Found USDT: $${walletBal.toFixed(2)} in account`);
      }
    }

    console.log(`✅ [BYBIT] Total USDT balance: $${balance.toFixed(2)}`);
    return balance;
  } catch (error) {
    console.error(`❌ [BYBIT] Balance check error:`, error.message);
    console.error(`❌ [BYBIT] This might be an API credentials or permission issue`);
    return 0;
  }
}// ============================================================
// EXECUTE TRADE (Main Entry Point)
// ============================================================

export async function executeTrade(signal) {
  const { symbol, direction, entry, tp, sl, confidence } = signal;

  console.log(`\n🎯 [EXECUTOR] Executing trade: ${symbol} ${direction}`);
  console.log(`   Entry: ${entry} | TP: ${tp} | SL: ${sl} | Confidence: ${confidence}%`);

  // DEBUG: Check if API credentials are loaded
  console.log(`🔑 [DEBUG] API Key loaded: ${EXECUTION_CONFIG.apiKey ? `YES (${EXECUTION_CONFIG.apiKey.substring(0, 8)}...)` : 'NO - EMPTY!'}`);
  console.log(`🔑 [DEBUG] API Secret loaded: ${EXECUTION_CONFIG.apiSecret ? `YES (${EXECUTION_CONFIG.apiSecret.length} chars)` : 'NO - EMPTY!'}`);
  console.log(`🔑 [DEBUG] Execution enabled: ${EXECUTION_CONFIG.enabled}`);

  // ===== DRY-RUN MODE =====
  if (!EXECUTION_CONFIG.enabled) {
    console.log(`🔒 [DRY-RUN] Trade would execute but system is in dry-run mode`);
    console.log(`   To enable: Set EXECUTION_CONFIG.enabled = true`);
    return {
      success: true,
      dryRun: true,
      message: 'Dry-run mode - no real trade executed'
    };
  }

  // ===== SAFETY CHECKS =====

  // Check if already in position
  if (activePositions.has(symbol)) {
    console.log(`⚠️  [EXECUTOR] Already in position: ${symbol}`);
    return { success: false, error: 'Already in position' };
  }

  // Check max positions
  if (activePositions.size >= EXECUTION_CONFIG.maxPositions) {
    console.log(`⚠️  [EXECUTOR] Max positions reached: ${activePositions.size}/${EXECUTION_CONFIG.maxPositions}`);
    return { success: false, error: 'Max positions limit' };
  }

  // Check balance
  const balance = await getWalletBalance();
  console.log(`💰 [EXECUTOR] Wallet balance: $${balance.toFixed(2)} USDT (min required: $${EXECUTION_CONFIG.minBalance})`);

  if (balance < EXECUTION_CONFIG.minBalance) {
    console.log(`⚠️  [EXECUTOR] Insufficient balance: ${balance} < ${EXECUTION_CONFIG.minBalance}`);
    return { success: false, error: 'Insufficient balance' };
  }

  // ===== CALCULATE POSITION SIZE =====

  // Get instrument precision requirements
  const instrumentInfo = await getInstrumentInfo(symbol);
  console.log(`📊 [BYBIT] Instrument info: tickSize=${instrumentInfo.tickSize}, qtyStep=${instrumentInfo.qtyStep}`);

  const marginUsdt = EXECUTION_CONFIG.defaultMargin;
  const leverage = EXECUTION_CONFIG.defaultLeverage;
  const positionValue = marginUsdt * leverage; // $25 × 5 = $125

  // Calculate qty and round to qtyStep
  const qtyRaw = positionValue / entry;
  const qty = roundToQtyStep(qtyRaw, instrumentInfo.qtyStep);

  // Validate qty limits
  if (qty < instrumentInfo.minOrderQty) {
    console.log(`⚠️  [EXECUTOR] Order qty too small: ${qty} < ${instrumentInfo.minOrderQty}`);
    return { success: false, error: 'Order qty below minimum' };
  }

  // Round TP/SL to tickSize
  const tpRounded = roundToTickSize(tp, instrumentInfo.tickSize);
  const slRounded = roundToTickSize(sl, instrumentInfo.tickSize);

  console.log(`💰 [EXECUTOR] Position size: ${qty} contracts ($${positionValue} notional)`);
  console.log(`🎯 [EXECUTOR] TP: ${tpRounded} | SL: ${slRounded} (rounded to tickSize)`);

  // ===== PLACE MARKET ORDER =====

  try {
    const side = direction === 'LONG' ? 'Buy' : 'Sell';
    const orderResult = await placeMarketOrder(symbol, side, qty);

    // Track position
    activePositions.set(symbol, {
      orderId: orderResult.orderId,
      side,
      qty,
      entry,
      tp: tpRounded,
      sl: slRounded,
      timestamp: Date.now()
    });

    // Set TP/SL (use rounded values)
    await setTakeProfitStopLoss(symbol, side, 0, tpRounded, slRounded);

    console.log(`✅ [EXECUTOR] Trade executed successfully!`);
    console.log(`   Order ID: ${orderResult.orderId}`);
    console.log(`   Position: ${qty} contracts @ ${entry}`);

    return {
      success: true,
      orderId: orderResult.orderId,
      symbol,
      side,
      qty,
      entry,
      tp,
      sl
    };

  } catch (error) {
    console.error(`❌ [EXECUTOR] Trade failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================
// GET ACTIVE POSITIONS
// ============================================================

export function getActivePositions() {
  return Array.from(activePositions.entries()).map(([symbol, pos]) => ({
    symbol,
    ...pos
  }));
}

// ============================================================
// CLOSE POSITION (Manual close)
// ============================================================

export async function closePosition(symbol) {
  const position = activePositions.get(symbol);
  if (!position) {
    return { success: false, error: 'Position not found' };
  }

  console.log(`🔴 [EXECUTOR] Closing position: ${symbol}`);

  try {
    // Reverse side to close
    const closeSide = position.side === 'Buy' ? 'Sell' : 'Buy';
    const orderResult = await placeMarketOrder(symbol, closeSide, position.qty);

    activePositions.delete(symbol);

    console.log(`✅ [EXECUTOR] Position closed: ${symbol}`);
    return {
      success: true,
      orderId: orderResult.orderId
    };

  } catch (error) {
    console.error(`❌ [EXECUTOR] Close failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================
// CLEANUP OLD POSITIONS (if TP/SL hit but not tracked)
// ============================================================

export function cleanupStalePositions() {
  const now = Date.now();
  const maxAge = 3600000; // 1 hour

  for (const [symbol, pos] of activePositions.entries()) {
    if (now - pos.timestamp > maxAge) {
      console.log(`🧹 [EXECUTOR] Removing stale position: ${symbol}`);
      activePositions.delete(symbol);
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupStalePositions, 300000);

export default {
  executeTrade,
  getActivePositions,
  closePosition,
  config: EXECUTION_CONFIG
};
