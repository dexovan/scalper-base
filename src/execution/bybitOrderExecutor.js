// ============================================================
// BYBIT ORDER EXECUTOR
// Executes trades on Bybit with TP/SL (OCO orders)
// ============================================================

import crypto from 'crypto';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as positionTracker from '../risk/positionTracker.js';

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
  maxPositions: 5,           // Max 5 concurrent positions (scalping strategy)
  minBalance: 20,            // Min USDT balance to trade (lowered for testing)
  defaultLeverage: 3,        // 3x leverage (safer than 5x, less liquidation risk)
  defaultMargin: 18,         // $18 per trade (~$54 notional, lower risk per trade)

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
// SET LEVERAGE (Must be called before opening position)
// ============================================================

async function setLeverage(symbol, leverage) {
  const params = {
    category: 'linear',
    symbol,
    buyLeverage: leverage.toString(),
    sellLeverage: leverage.toString()
  };

  console.log(`⚙️  [BYBIT] Setting leverage: ${symbol} → ${leverage}x`);

  const response = await bybitRequest('/v5/position/set-leverage', 'POST', params);

  console.log(`📊 [BYBIT] Leverage API response:`, JSON.stringify(response, null, 2));

  if (response.retCode !== 0) {
    console.error(`❌ [BYBIT] Leverage set FAILED: ${response.retMsg} (code: ${response.retCode})`);
    throw new Error(`Cannot set leverage to ${leverage}x: ${response.retMsg}`);
  }

  console.log(`✅ [BYBIT] Leverage successfully set to ${leverage}x`);
  return response.result;
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

async function setTakeProfitStopLoss(symbol, side, positionIdx, takeProfit, stopLoss, maxRetries = 3) {
  const params = {
    category: 'linear',
    symbol,
    takeProfit: takeProfit.toString(),
    stopLoss: stopLoss.toString(),
    tpTriggerBy: 'LastPrice',
    slTriggerBy: 'LastPrice',
    positionIdx: positionIdx || 0  // 0 = one-way mode
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`📤 [BYBIT] Setting TP/SL (attempt ${attempt}/${maxRetries}): ${symbol} TP=${takeProfit} SL=${stopLoss}`);

    try {
      const response = await bybitRequest('/v5/position/trading-stop', 'POST', params);

      console.log(`📊 [BYBIT] TP/SL Response (attempt ${attempt}):`, JSON.stringify(response, null, 2));

      if (response.retCode === 0) {
        console.log(`✅ [BYBIT] TP/SL set successfully on attempt ${attempt}`);
        return response.result;
      }

      console.error(`⚠️  [BYBIT] TP/SL failed (attempt ${attempt}): ${response.retMsg} (code: ${response.retCode})`);

      if (attempt < maxRetries) {
        console.log(`   Retrying in 1 second...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`❌ [BYBIT] TP/SL request error (attempt ${attempt}):`, error.message);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  console.error(`❌ [BYBIT] TP/SL FAILED after ${maxRetries} attempts!`);
  return null;
}

// ============================================================
// TIMING VALIDATION - Wait for Pullback
// ============================================================

async function checkPricePullback(symbol, direction, entryPrice) {
  try {
    console.log(`⏱️  [TIMING] Checking if price near entry zone top...`);

    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=1&limit=5`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.retCode !== 0 || !data.result?.list) {
      console.warn(`⚠️  [TIMING] Could not fetch recent candles, skipping pullback check`);
      return true; // Don't block trade if can't check
    }

    const recentCandles = data.result.list.slice(0, 5); // Last 5 minutes
    const recentPrices = recentCandles.map(c => parseFloat(c[4])); // Close prices
    const highestRecent = Math.max(...recentPrices);
    const lowestRecent = Math.min(...recentPrices);
    const currentPrice = entryPrice;

    if (direction === 'LONG') {
      // For LONG: check if current price is at the TOP of recent range
      const pricePosition = (currentPrice - lowestRecent) / (highestRecent - lowestRecent);
      console.log(`📊 [TIMING] LONG - Price position in 5min range: ${(pricePosition * 100).toFixed(1)}%`);

      if (pricePosition > 0.85) { // At top 15% of range
        console.warn(`⚠️  [TIMING] Price too close to recent HIGH (${(pricePosition * 100).toFixed(1)}% of range)`);
        console.warn(`   Recent range: ${lowestRecent.toFixed(4)} - ${highestRecent.toFixed(4)}, Entry: ${currentPrice.toFixed(4)}`);
        console.warn(`   ❌ SKIPPING TRADE - Wait for pullback!`);
        return false;
      }

      console.log(`✅ [TIMING] Good entry position for LONG (${(pricePosition * 100).toFixed(1)}% of 5min range)`);
    } else {
      // For SHORT: check if current price is at the BOTTOM of recent range
      const pricePosition = (highestRecent - currentPrice) / (highestRecent - lowestRecent);
      console.log(`📊 [TIMING] SHORT - Price position in 5min range: ${(pricePosition * 100).toFixed(1)}%`);

      if (pricePosition > 0.85) { // At bottom 15% of range
        console.warn(`⚠️  [TIMING] Price too close to recent LOW (${(pricePosition * 100).toFixed(1)}% of range)`);
        console.warn(`   Recent range: ${lowestRecent.toFixed(4)} - ${highestRecent.toFixed(4)}, Entry: ${currentPrice.toFixed(4)}`);
        console.warn(`   ❌ SKIPPING TRADE - Wait for pullback!`);
        return false;
      }

      console.log(`✅ [TIMING] Good entry position for SHORT (${(pricePosition * 100).toFixed(1)}% of 5min range)`);
    }

    return true;
  } catch (error) {
    console.error(`❌ [TIMING] Error checking pullback:`, error.message);
    return true; // Don't block trade on error
  }
}

async function recheckMomentum(symbol, direction, originalBidDepth, originalAskDepth) {
  try {
    console.log(`⏱️  [TIMING] Re-checking momentum after 12 second delay...`);

    // Wait 12 seconds
    await new Promise(resolve => setTimeout(resolve, 12000));

    // Fetch fresh orderbook
    const url = `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${symbol}&limit=25`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.retCode !== 0 || !data.result) {
      console.warn(`⚠️  [TIMING] Could not fetch fresh orderbook, proceeding anyway`);
      return true;
    }

    const bids = data.result.b || [];
    const asks = data.result.a || [];

    const newBidDepth = bids.slice(0, 10).reduce((sum, [price, qty]) => sum + parseFloat(price) * parseFloat(qty), 0);
    const newAskDepth = asks.slice(0, 10).reduce((sum, [price, qty]) => sum + parseFloat(price) * parseFloat(qty), 0);

    const newImbalance = direction === 'LONG'
      ? (newBidDepth / (newBidDepth + newAskDepth))
      : (newAskDepth / (newBidDepth + newAskDepth));

    console.log(`📊 [TIMING] Momentum recheck:`);
    console.log(`   Original: Bid=${originalBidDepth.toFixed(0)} Ask=${originalAskDepth.toFixed(0)}`);
    console.log(`   Current:  Bid=${newBidDepth.toFixed(0)} Ask=${newAskDepth.toFixed(0)}`);
    console.log(`   New imbalance: ${(newImbalance * 100).toFixed(1)}%`);

    if (direction === 'LONG' && newImbalance < 0.55) {
      console.warn(`⚠️  [TIMING] LONG momentum weakened: ${(newImbalance * 100).toFixed(1)}% < 55%`);
      console.warn(`   ❌ SKIPPING TRADE - Momentum lost!`);
      return false;
    }

    if (direction === 'SHORT' && newImbalance < 0.55) {
      console.warn(`⚠️  [TIMING] SHORT momentum weakened: ${(newImbalance * 100).toFixed(1)}% < 55%`);
      console.warn(`   ❌ SKIPPING TRADE - Momentum lost!`);
      return false;
    }

    console.log(`✅ [TIMING] Momentum confirmed after delay (${(newImbalance * 100).toFixed(1)}%)`);
    return true;
  } catch (error) {
    console.error(`❌ [TIMING] Error rechecking momentum:`, error.message);
    return true; // Don't block trade on error
  }
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
  const { symbol, direction, entry, tp, sl, confidence, bidDepth, askDepth } = signal;

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

  // ===== TIMING VALIDATION (Phase 2) =====

  console.log(`\n⏱️  [TIMING] Phase 2 validation: Checking entry timing...`);

  // Step 1: Check if price is at top of recent rally (wait for pullback)
  const pullbackOk = await checkPricePullback(symbol, direction, entry);
  if (!pullbackOk) {
    console.log(`❌ [EXECUTOR] Trade rejected: Price at extreme of recent range`);
    return { success: false, error: 'Entry timing rejected - wait for pullback' };
  }

  // Step 2: Wait 12 seconds and recheck momentum
  const momentumOk = await recheckMomentum(symbol, direction, bidDepth || 0, askDepth || 0);
  if (!momentumOk) {
    console.log(`❌ [EXECUTOR] Trade rejected: Momentum weakened during delay`);
    return { success: false, error: 'Entry timing rejected - momentum lost' };
  }

  console.log(`✅ [TIMING] Entry timing validated - proceeding with trade\n`);

  // ===== SAFETY CHECKS =====

  // Check if already in position
  if (activePositions.has(symbol)) {
    console.log(`⚠️  [EXECUTOR] Already in position: ${symbol}`);
    return { success: false, error: 'Already in position' };
  }

  // Check max positions
  if (activePositions.size >= EXECUTION_CONFIG.maxPositions) {
    console.log(`⚠️  [EXECUTOR] Max positions reached: ${activePositions.size}/${EXECUTION_CONFIG.maxPositions}`);
    console.log(`   Active symbols: ${Array.from(activePositions.keys()).join(', ')}`);
    return { success: false, error: 'Max positions limit' };
  }

  console.log(`📊 [EXECUTOR] Position slots: ${activePositions.size}/${EXECUTION_CONFIG.maxPositions} used`);

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

  // ===== SET LEVERAGE BEFORE ORDER =====

  try {
    await setLeverage(symbol, leverage);
  } catch (error) {
    console.error(`❌ [EXECUTOR] Cannot proceed without setting leverage!`);
    return {
      success: false,
      error: `Leverage setup failed: ${error.message}`
    };
  }

  // ===== PLACE MARKET ORDER =====

  try {
    const side = direction === 'LONG' ? 'Buy' : 'Sell';
    console.log(`📊 [EXECUTOR] Direction: ${direction} → Bybit side: ${side}`);

    const orderResult = await placeMarketOrder(symbol, side, qty);    // Track position
    activePositions.set(symbol, {
      orderId: orderResult.orderId,
      side,
      qty,
      entry,
      tp: tpRounded,
      sl: slRounded,
      timestamp: Date.now()
    });

    // Set TP/SL (use rounded values) - CRITICAL: Must succeed or close position!
    console.log(`🎯 [EXECUTOR] Setting TP/SL: TP=${tpRounded} (${direction === 'LONG' ? 'above' : 'below'} entry), SL=${slRounded} (${direction === 'LONG' ? 'below' : 'above'} entry)`);
    const tpSlResult = await setTakeProfitStopLoss(symbol, side, 0, tpRounded, slRounded);

    if (!tpSlResult) {
      console.error(`🚨 [EXECUTOR] CRITICAL: TP/SL failed after retries!`);
      console.error(`   FORCE CLOSING POSITION to prevent unprotected risk!`);

      // Close position immediately
      try {
        const closeSide = side === 'Buy' ? 'Sell' : 'Buy';
        await placeMarketOrder(symbol, closeSide, qty);
        activePositions.delete(symbol);
        console.log(`🔴 [EXECUTOR] Position force-closed due to TP/SL failure`);
      } catch (closeError) {
        console.error(`❌ [EXECUTOR] FAILED TO CLOSE POSITION:`, closeError.message);
        console.error(`   ⚠️  MANUAL INTERVENTION REQUIRED FOR ${symbol}!`);
      }

      return {
        success: false,
        error: 'TP/SL setup failed - position was closed for safety'
      };
    }

    console.log(`✅ [EXECUTOR] Trade executed successfully!`);
    console.log(`   Order ID: ${orderResult.orderId}`);
    console.log(`   Position: ${qty} contracts @ ${entry}`);
    console.log(`   Expected: ${direction === 'LONG' ? `Price rises to ${tpRounded}` : `Price falls to ${tpRounded}`}`);
    console.log(`📊 [EXECUTOR] Active positions: ${activePositions.size}/${EXECUTION_CONFIG.maxPositions}`);

    // Notify positionTracker for dashboard
    positionTracker.onNewPositionOpened({
      symbol,
      side: direction,  // "LONG" or "SHORT"
      entryPrice: entry,
      qty,
      leverage: EXECUTION_CONFIG.defaultLeverage,
      stopLossPrice: slRounded,
      takeProfit1Price: tpRounded,
      takeProfit2Price: null
    });

    // Trigger immediate sync to update position status
    setTimeout(() => syncPositionsWithBybit(), 2000);

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
// SYNC POSITIONS WITH BYBIT (Check actual open positions)
// ============================================================

async function syncPositionsWithBybit() {
  try {
    console.log(`🔄 [SYNC] Checking Bybit positions...`);

    const response = await bybitRequest('/v5/position/list', 'GET', {
      category: 'linear',
      settleCoin: 'USDT'
    });

    if (response.retCode !== 0) {
      console.error(`⚠️  [SYNC] Failed to fetch positions: ${response.retMsg}`);
      return;
    }

    const openPositions = response.result?.list || [];
    const openSymbols = new Set(
      openPositions
        .filter(p => parseFloat(p.size) > 0)
        .map(p => p.symbol)
    );

    console.log(`📊 [SYNC] Local tracker: ${activePositions.size} positions [${Array.from(activePositions.keys()).join(', ') || 'none'}]`);
    console.log(`📊 [SYNC] Bybit API: ${openSymbols.size} positions [${Array.from(openSymbols).join(', ') || 'none'}]`);

    // Remove closed positions from local tracker
    let removed = 0;
    for (const [symbol, pos] of activePositions.entries()) {
      if (!openSymbols.has(symbol)) {
        console.log(`🧹 [SYNC] Position closed on Bybit: ${symbol} - removing from tracker`);

        // Notify positionTracker that position closed
        positionTracker.onPositionClosed({
          symbol,
          side: pos.side === 'Buy' ? 'LONG' : 'SHORT',
          closedAt: new Date().toISOString(),
          reason: 'TP/SL triggered or manually closed'
        });

        activePositions.delete(symbol);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`✅ [SYNC] Removed ${removed} closed position(s). Now: ${activePositions.size}/${EXECUTION_CONFIG.maxPositions} slots used`);
    } else {
      console.log(`✅ [SYNC] All positions in sync: ${activePositions.size}/${EXECUTION_CONFIG.maxPositions} slots used`);
    }

  } catch (error) {
    console.error(`❌ [SYNC] Position sync error:`, error.message);
  }
}

// ============================================================
// CLEANUP OLD POSITIONS (if TP/SL hit but not tracked)
// ============================================================

export function cleanupStalePositions() {
  const now = Date.now();
  const maxAge = 600000; // 10 minutes (reduced from 1 hour)

  for (const [symbol, pos] of activePositions.entries()) {
    if (now - pos.timestamp > maxAge) {
      console.log(`🧹 [EXECUTOR] Removing stale position: ${symbol} (${Math.floor((now - pos.timestamp) / 60000)}min old)`);
      activePositions.delete(symbol);
    }
  }
}

// Sync with Bybit every 30 seconds
setInterval(syncPositionsWithBybit, 30000);

// Cleanup stale positions every 2 minutes
setInterval(cleanupStalePositions, 120000);

// Initial sync on module load
console.log('🔄 [EXECUTOR] Running initial position sync...');
syncPositionsWithBybit();

export default {
  executeTrade,
  getActivePositions,
  closePosition,
  syncPositionsWithBybit,  // Export for manual triggering
  config: EXECUTION_CONFIG
};
