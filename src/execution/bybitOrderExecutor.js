// 🎯 BYBIT ORDER EXECUTOR – BALANCED MAKER-FIRST MODE
// ✅ Phase 1: Leverage validation + TP/SL retry + auto-close protection
// ✅ Phase 2: Pullback check + 6s momentum recheck
// ✅ Phase 3: 3x leverage, $18 margin, 0.35% TP / 0.30% SL
// ✅ Phase 4A: Fee-first validation (0.02% buffer for balanced mode)
// ✅ Phase 4B: MAKER_FIRST limit entry with intelligent fallback
// ✅ BALANCED MODE: 6s maker wait, 90% range threshold, 50% momentum

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RestClientV5 } from 'bybit-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================================================
// 1) MANUAL .env LOADER (PM2 compatibility)
// =====================================================
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim();
      process.env[key.trim()] = value;
    }
  });
  console.log('✅ [EXECUTOR] Manually loaded .env');
} else {
  console.warn('⚠️  [EXECUTOR] .env file not found, using existing env vars');
}

// =====================================================
// 2) BYBIT CLIENT INIT
// =====================================================
const bybitClient = new RestClientV5({
  key: process.env.BYBIT_API_KEY,
  secret: process.env.BYBIT_API_SECRET,
  testnet: false
});

// =====================================================
// 3) POSITION TRACKER (dashboard sync)
// =====================================================
let positionTracker = null;

export function setPositionTracker(tracker) {
  positionTracker = tracker;
  console.log('✅ [EXECUTOR] Position tracker registered');
}

function updatePosition(symbol, data) {
  if (positionTracker) {
    positionTracker.updatePosition(symbol, data);
  }
}

function removePosition(symbol) {
  if (positionTracker) {
    positionTracker.removePosition(symbol);
  }
}

// =====================================================
// 4) BALANCED MAKER-FIRST EXECUTION CONFIG
// =====================================================
const EXECUTION_CONFIG = {
  entryMode: 'MAKER_FIRST_BALANCED', // Primary execution mode

  // BALANCED MODE – agresivniji za više trejdova
  makerFirst: {
    fallbackDelayMs: 6000,           // 6s wait (was 12-15s)
    maxWaitMs: 7000,                 // Max 7s total
    pollIntervalMs: 2000,            // Poll every 2s
    maxPriceDriftPercent: 0.15,      // Relaxed to 0.15% (was 0.10%)
    maxSpreadPercent: 0.20,          // Relaxed to 0.20% (was 0.15%)
    minMomentumPercent: 50           // Relaxed to 50% (was 55%)
  },

  // Phase 2: Entry timing – BALANCED parameters
  pullbackCheck: {
    enabled: true,
    pullbackWindowMinutes: 5,
    longTopPercentThreshold: 0.90,   // 90% instead of 85% (more aggressive)
    shortBottomPercentThreshold: 0.10,
    recheckDelayMs: 6000,            // 6s instead of 12s (faster)
    minInitialMomentum: 0.50,        // 50% instead of 55% (more trades)
    minRecheckMomentum: 0.50
  },

  // Phase 3: Risk management
  leverage: 3,
  marginPerTrade: 18,

  // Phase 1: Protection parameters
  tpslRetries: 3,
  tpslRetryDelayMs: 2000,
  autoCloseOnTpslFailure: true
};

console.log(`🟣 [EXECUTOR] MODE: ${EXECUTION_CONFIG.entryMode}`);
console.log(`⏱️  [EXECUTOR] Maker wait: ${EXECUTION_CONFIG.makerFirst.fallbackDelayMs}ms`);
console.log(`📊 [EXECUTOR] Timing: ${EXECUTION_CONFIG.pullbackCheck.recheckDelayMs}ms delay, ${EXECUTION_CONFIG.pullbackCheck.minInitialMomentum * 100}% momentum, ${EXECUTION_CONFIG.pullbackCheck.longTopPercentThreshold * 100}% range`);

// =====================================================
// 5) HELPER: Sleep
// =====================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================
// 6) BYBIT API WRAPPERS
// =====================================================

/**
 * Place market order
 */
async function placeMarketOrder(symbol, side, qty) {
  try {
    const response = await bybitClient.submitOrder({
      category: 'linear',
      symbol,
      side,
      orderType: 'Market',
      qty: String(qty),
      timeInForce: 'IOC',
      positionIdx: 0
    });

    if (response?.retCode !== 0) {
      throw new Error(`Market order failed: ${response?.retMsg || 'Unknown error'}`);
    }

    console.log(`✅ [MARKET] ${side} ${qty} ${symbol} → OrderID: ${response.result?.orderId}`);
    return response.result;
  } catch (err) {
    console.error(`❌ [MARKET] Failed: ${err.message}`);
    throw err;
  }
}

/**
 * Place limit order (post-only for maker rebate)
 */
async function placeLimitOrder(symbol, side, qty, price, postOnly = true) {
  try {
    const response = await bybitClient.submitOrder({
      category: 'linear',
      symbol,
      side,
      orderType: 'Limit',
      qty: String(qty),
      price: String(price),
      timeInForce: postOnly ? 'PostOnly' : 'GTC',
      positionIdx: 0
    });

    if (response?.retCode !== 0) {
      throw new Error(`Limit order failed: ${response?.retMsg || 'Unknown error'}`);
    }

    console.log(`✅ [LIMIT] ${side} ${qty} ${symbol} @ ${price} (PostOnly=${postOnly}) → OrderID: ${response.result?.orderId}`);
    return response.result;
  } catch (err) {
    console.error(`❌ [LIMIT] Failed: ${err.message}`);
    throw err;
  }
}

/**
 * Get order status
 */
async function getOrderStatus(symbol, orderId) {
  try {
    const response = await bybitClient.getActiveOrders({
      category: 'linear',
      symbol,
      orderId
    });

    if (response?.retCode !== 0) {
      throw new Error(`Get order status failed: ${response?.retMsg || 'Unknown error'}`);
    }

    const orders = response.result?.list || [];
    if (orders.length === 0) {
      // Order not in active list → check if it was filled
      const historyResponse = await bybitClient.getHistoricOrders({
        category: 'linear',
        symbol,
        orderId,
        limit: 1
      });

      if (historyResponse?.retCode === 0) {
        const histOrders = historyResponse.result?.list || [];
        if (histOrders.length > 0) {
          return histOrders[0];
        }
      }

      return null; // Order not found
    }

    return orders[0];
  } catch (err) {
    console.error(`❌ [ORDER-STATUS] Failed: ${err.message}`);
    return null;
  }
}

/**
 * Cancel order
 */
async function cancelOrder(symbol, orderId) {
  try {
    const response = await bybitClient.cancelOrder({
      category: 'linear',
      symbol,
      orderId
    });

    if (response?.retCode !== 0) {
      throw new Error(`Cancel order failed: ${response?.retMsg || 'Unknown error'}`);
    }

    console.log(`✅ [CANCEL] OrderID ${orderId} cancelled`);
    return true;
  } catch (err) {
    console.error(`❌ [CANCEL] Failed: ${err.message}`);
    return false;
  }
}

/**
 * Set leverage (Phase 1: throws error on failure)
 */
async function setLeverage(symbol, leverage) {
  try {
    const response = await bybitClient.setLeverage({
      category: 'linear',
      symbol,
      buyLeverage: String(leverage),
      sellLeverage: String(leverage)
    });

    if (response?.retCode !== 0) {
      throw new Error(`Set leverage failed: ${response?.retMsg || 'Unknown error'}`);
    }

    console.log(`✅ [LEVERAGE] ${symbol} set to ${leverage}x`);
    return true;
  } catch (err) {
    console.error(`❌ [LEVERAGE] Failed for ${symbol}: ${err.message}`);
    throw err; // Phase 1: throw to prevent trading with wrong leverage
  }
}

/**
 * Set TP/SL (Phase 1: retry 3x, auto-close on failure)
 */
async function setTakeProfitStopLoss(symbol, side, tp, sl) {
  const maxAttempts = EXECUTION_CONFIG.tpslRetries;
  const delayMs = EXECUTION_CONFIG.tpslRetryDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await bybitClient.setTradingStop({
        category: 'linear',
        symbol,
        positionIdx: 0,
        takeProfit: String(tp),
        stopLoss: String(sl)
      });

      if (response?.retCode !== 0) {
        throw new Error(`Set TP/SL failed: ${response?.retMsg || 'Unknown error'}`);
      }

      console.log(`✅ [TP/SL] ${symbol} → TP: ${tp}, SL: ${sl} (attempt ${attempt}/${maxAttempts})`);
      return true;
    } catch (err) {
      console.error(`❌ [TP/SL] Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);

      if (attempt < maxAttempts) {
        console.log(`⏳ [TP/SL] Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      } else {
        console.error(`💀 [TP/SL] All ${maxAttempts} attempts failed`);

        if (EXECUTION_CONFIG.autoCloseOnTpslFailure) {
          console.log(`🚨 [AUTO-CLOSE] Closing position without protection...`);
          await closePosition(symbol, side);
        }

        throw err;
      }
    }
  }
}

/**
 * Close position immediately
 */
async function closePosition(symbol, side) {
  try {
    const closeSide = side === 'Buy' ? 'Sell' : 'Buy';

    const response = await bybitClient.submitOrder({
      category: 'linear',
      symbol,
      side: closeSide,
      orderType: 'Market',
      qty: '0', // Close full position
      timeInForce: 'IOC',
      positionIdx: 0,
      reduceOnly: true
    });

    if (response?.retCode !== 0) {
      throw new Error(`Close position failed: ${response?.retMsg || 'Unknown error'}`);
    }

    console.log(`✅ [CLOSE] Position ${symbol} closed`);
    removePosition(symbol);
    return true;
  } catch (err) {
    console.error(`❌ [CLOSE] Failed: ${err.message}`);
    return false;
  }
}

// =====================================================
// 7) GET LIVE MARKET STATE (from engine API)
// =====================================================
async function getLiveMarketState(symbol) {
  try {
    const response = await fetch(`http://localhost:8090/api/market-state/${symbol}`);
    if (!response.ok) {
      throw new Error(`Engine API returned ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (err) {
    console.error(`❌ [MARKET-STATE] Failed to fetch for ${symbol}: ${err.message}`);
    return null;
  }
}

// =====================================================
// 8) PHASE 2: PULLBACK CHECK (BALANCED MODE)
// =====================================================
async function checkPricePullback(symbol, direction, currentPrice) {
  if (!EXECUTION_CONFIG.pullbackCheck.enabled) {
    return { passed: true, reason: 'Pullback check disabled' };
  }

  const config = EXECUTION_CONFIG.pullbackCheck;
  const marketState = await getLiveMarketState(symbol);

  if (!marketState || !marketState.candles || marketState.candles.length === 0) {
    console.warn(`⚠️  [PULLBACK] No candle data for ${symbol}, skipping check`);
    return { passed: true, reason: 'No candle data' };
  }

  const recentCandles = marketState.candles.slice(-config.pullbackWindowMinutes);
  const highs = recentCandles.map(c => parseFloat(c.high));
  const lows = recentCandles.map(c => parseFloat(c.low));
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const rangeSize = rangeHigh - rangeLow;

  if (rangeSize === 0) {
    console.warn(`⚠️  [PULLBACK] Range size is 0 for ${symbol}, skipping check`);
    return { passed: true, reason: 'Zero range size' };
  }

  const pricePosition = (currentPrice - rangeLow) / rangeSize;

  console.log(`📊 [PULLBACK] ${symbol} price position in ${config.pullbackWindowMinutes}min range: ${(pricePosition * 100).toFixed(1)}%`);

  if (direction === 'LONG' && pricePosition > config.longTopPercentThreshold) {
    return {
      passed: false,
      reason: `LONG rejected: price at ${(pricePosition * 100).toFixed(1)}% (>${config.longTopPercentThreshold * 100}% threshold)`,
      pricePosition
    };
  }

  if (direction === 'SHORT' && pricePosition < config.shortBottomPercentThreshold) {
    return {
      passed: false,
      reason: `SHORT rejected: price at ${(pricePosition * 100).toFixed(1)}% (<${config.shortBottomPercentThreshold * 100}% threshold)`,
      pricePosition
    };
  }

  return { passed: true, pricePosition };
}

// =====================================================
// 9) PHASE 2: MOMENTUM RECHECK (BALANCED MODE)
// =====================================================
async function recheckMomentum(symbol, direction, initialMomentum) {
  if (!EXECUTION_CONFIG.pullbackCheck.enabled) {
    return { passed: true, reason: 'Momentum recheck disabled' };
  }

  const config = EXECUTION_CONFIG.pullbackCheck;

  if (initialMomentum < config.minInitialMomentum) {
    return {
      passed: false,
      reason: `Initial momentum ${(initialMomentum * 100).toFixed(1)}% < ${(config.minInitialMomentum * 100)}% threshold`,
      momentum: initialMomentum
    };
  }

  console.log(`⏳ [TIMING] Waiting ${config.recheckDelayMs}ms to recheck momentum...`);
  await sleep(config.recheckDelayMs);

  const marketState = await getLiveMarketState(symbol);
  if (!marketState || !marketState.orderbook) {
    console.warn(`⚠️  [MOMENTUM] No orderbook data for ${symbol} after delay`);
    return { passed: true, reason: 'No orderbook data after delay' };
  }

  const { bidImbalance, askImbalance } = marketState.orderbook;
  const currentMomentum = direction === 'LONG' ? bidImbalance : askImbalance;

  console.log(`📊 [MOMENTUM] ${symbol} ${direction} momentum after ${config.recheckDelayMs}ms delay: ${(currentMomentum * 100).toFixed(1)}%`);

  if (currentMomentum < config.minRecheckMomentum) {
    return {
      passed: false,
      reason: `Momentum dropped to ${(currentMomentum * 100).toFixed(1)}% (< ${(config.minRecheckMomentum * 100)}% threshold)`,
      momentum: currentMomentum
    };
  }

  console.log(`✅ [TIMING] Momentum confirmed after delay (${(currentMomentum * 100).toFixed(1)}%)`);
  return { passed: true, momentum: currentMomentum };
}

// =====================================================
// 10) MAKER-FIRST: Wait for limit order fill
// =====================================================
async function waitForMakerFill({ symbol, orderId, limitPrice, config }) {
  const startTime = Date.now();
  const maxWait = config.maxWaitMs || 7000;
  const pollInterval = config.pollIntervalMs || 2000;

  console.log(`⏳ [MAKER-WAIT] Waiting up to ${maxWait}ms for order ${orderId} to fill...`);

  while (Date.now() - startTime < maxWait) {
    await sleep(pollInterval);

    const orderStatus = await getOrderStatus(symbol, orderId);

    if (!orderStatus) {
      console.log(`🔍 [MAKER-WAIT] Order ${orderId} not found (possibly filled)`);
      return { filled: true, reason: 'Order not in active list' };
    }

    const status = orderStatus.orderStatus;
    console.log(`🔍 [MAKER-WAIT] Order status: ${status}`);

    if (status === 'Filled') {
      const elapsed = Date.now() - startTime;
      console.log(`✅ [MAKER-FILLED] Order filled in ${elapsed}ms`);
      return { filled: true, avgPrice: parseFloat(orderStatus.avgPrice) };
    }

    if (status === 'Cancelled' || status === 'Rejected') {
      console.log(`❌ [MAKER-WAIT] Order ${status}`);
      return { filled: false, reason: `Order ${status}` };
    }
  }

  console.log(`⏱️  [MAKER-WAIT] Timeout after ${maxWait}ms`);
  return { filled: false, reason: 'Timeout' };
}

// =====================================================
// 11) LEGACY: Market-only execution
// =====================================================
async function executeTradeMarketOnly(ctx) {
  const { symbol, direction, entry, tp, sl, positionSize, leverage } = ctx;

  console.log(`🔥 [MARKET-ONLY] Executing ${direction} ${symbol}`);
  console.log(`   Entry: ${entry}, TP: ${tp}, SL: ${sl}`);
  console.log(`   Position: $${positionSize} @ ${leverage}x leverage`);

  // Phase 1: Set leverage (throws on failure)
  await setLeverage(symbol, leverage);

  // Calculate quantity
  const qty = (positionSize / entry).toFixed(3);
  const side = direction === 'LONG' ? 'Buy' : 'Sell';

  // Place market order
  const orderResult = await placeMarketOrder(symbol, side, qty);

  // Phase 1: Set TP/SL with retry (auto-closes on failure)
  await setTakeProfitStopLoss(symbol, side, tp, sl);

  // Update tracker
  updatePosition(symbol, {
    symbol,
    side: direction,
    entry,
    tp,
    sl,
    qty,
    positionSize,
    leverage,
    orderId: orderResult.orderId,
    status: 'OPEN',
    entryMode: 'MARKET_ONLY',
    timestamp: new Date().toISOString()
  });

  return {
    success: true,
    mode: 'MARKET_ONLY',
    orderId: orderResult.orderId,
    entry,
    tp,
    sl
  };
}

// =====================================================
// 12) BALANCED MAKER-FIRST: Limit entry with fallback
// =====================================================
async function executeTradeMakerFirst(ctx) {
  const { symbol, direction, entry, tp, sl, positionSize, leverage, initialMomentum } = ctx;
  const config = EXECUTION_CONFIG.makerFirst;

  console.log(`🟣 [MAKER-FIRST-BALANCED] Executing ${direction} ${symbol}`);
  console.log(`   Entry: ${entry}, TP: ${tp}, SL: ${sl}`);
  console.log(`   Position: $${positionSize} @ ${leverage}x leverage`);
  console.log(`   Initial momentum: ${(initialMomentum * 100).toFixed(1)}%`);

  // Phase 1: Set leverage (throws on failure)
  await setLeverage(symbol, leverage);

  // Calculate quantity
  const qty = (positionSize / entry).toFixed(3);
  const side = direction === 'LONG' ? 'Buy' : 'Sell';

  // STEP 1: Place post-only limit order at entry price
  const limitResult = await placeLimitOrder(symbol, side, qty, entry, true);
  const orderId = limitResult.orderId;

  // STEP 2: Wait for fill
  const fillResult = await waitForMakerFill({
    symbol,
    orderId,
    limitPrice: entry,
    config
  });

  // STEP 3A: If filled → set TP/SL and done (MAKER REBATE!)
  if (fillResult.filled) {
    console.log(`✅ [MAKER-FILLED] Order filled, setting TP/SL...`);

    await setTakeProfitStopLoss(symbol, side, tp, sl);

    updatePosition(symbol, {
      symbol,
      side: direction,
      entry: fillResult.avgPrice || entry,
      tp,
      sl,
      qty,
      positionSize,
      leverage,
      orderId,
      status: 'OPEN',
      entryMode: 'MAKER_FILLED',
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      mode: 'MAKER_FILLED',
      orderId,
      entry: fillResult.avgPrice || entry,
      tp,
      sl
    };
  }

  // STEP 3B: Not filled → check conditions for fallback
  console.log(`⚠️  [MAKER-FIRST] Limit order not filled, checking fallback conditions...`);

  // Cancel the limit order
  await cancelOrder(symbol, orderId);

  // Get fresh market data
  const marketState = await getLiveMarketState(symbol);
  if (!marketState) {
    console.error(`❌ [MAKER-FIRST] Cannot get market state, skipping trade`);
    return { success: false, reason: 'No market state for fallback check' };
  }

  // Check price drift
  const currentPrice = direction === 'LONG'
    ? parseFloat(marketState.ticker?.ask || entry)
    : parseFloat(marketState.ticker?.bid || entry);

  const priceDrift = Math.abs((currentPrice - entry) / entry);

  console.log(`📊 [FALLBACK-CHECK] Price drift: ${(priceDrift * 100).toFixed(2)}%`);

  if (priceDrift > config.maxPriceDriftPercent / 100) {
    console.log(`❌ [MAKER-FIRST] Price drifted too much (${(priceDrift * 100).toFixed(2)}% > ${config.maxPriceDriftPercent}%), skipping trade`);
    return { success: false, reason: `Price drift ${(priceDrift * 100).toFixed(2)}% exceeds ${config.maxPriceDriftPercent}%` };
  }

  // Check spread
  const spread = marketState.ticker?.spread || 0;
  console.log(`📊 [FALLBACK-CHECK] Spread: ${(spread * 100).toFixed(2)}%`);

  if (spread > config.maxSpreadPercent / 100) {
    console.log(`❌ [MAKER-FIRST] Spread too wide (${(spread * 100).toFixed(2)}% > ${config.maxSpreadPercent}%), skipping trade`);
    return { success: false, reason: `Spread ${(spread * 100).toFixed(2)}% exceeds ${config.maxSpreadPercent}%` };
  }

  // Check momentum
  const { bidImbalance, askImbalance } = marketState.orderbook || {};
  const currentMomentum = direction === 'LONG' ? bidImbalance : askImbalance;

  console.log(`📊 [FALLBACK-CHECK] Current momentum: ${(currentMomentum * 100).toFixed(1)}%`);

  if (currentMomentum < config.minMomentumPercent / 100) {
    console.log(`❌ [MAKER-FIRST] Momentum dropped (${(currentMomentum * 100).toFixed(1)}% < ${config.minMomentumPercent}%), skipping trade`);
    return { success: false, reason: `Momentum ${(currentMomentum * 100).toFixed(1)}% below ${config.minMomentumPercent}%` };
  }

  // ALL CONDITIONS GOOD → Market fallback
  console.log(`✅ [MAKER-FALLBACK] Conditions safe, executing market order...`);

  const marketResult = await placeMarketOrder(symbol, side, qty);
  await setTakeProfitStopLoss(symbol, side, tp, sl);

  updatePosition(symbol, {
    symbol,
    side: direction,
    entry: currentPrice,
    tp,
    sl,
    qty,
    positionSize,
    leverage,
    orderId: marketResult.orderId,
    status: 'OPEN',
    entryMode: 'MAKER_FALLBACK',
    timestamp: new Date().toISOString()
  });

  return {
    success: true,
    mode: 'MAKER_FALLBACK',
    orderId: marketResult.orderId,
    entry: currentPrice,
    tp,
    sl
  };
}

// =====================================================
// 13) MAIN ENTRY POINT
// =====================================================
export async function executeTrade(signal) {
  const startTime = Date.now();

  try {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 [EXECUTOR] Starting trade execution for ${signal.symbol}`);
    console.log(`   Direction: ${signal.direction}`);
    console.log(`   Entry: ${signal.entry}, TP: ${signal.tp}, SL: ${signal.sl}`);
    console.log(`   Initial momentum: ${(signal.initialMomentum * 100).toFixed(1)}%`);
    console.log(`   Mode: ${EXECUTION_CONFIG.entryMode}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const ctx = {
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entry,
      tp: signal.tp,
      sl: signal.sl,
      positionSize: EXECUTION_CONFIG.marginPerTrade * EXECUTION_CONFIG.leverage,
      leverage: EXECUTION_CONFIG.leverage,
      initialMomentum: signal.initialMomentum || 0
    };

    // Phase 2: Pullback check (BALANCED MODE)
    const pullbackCheck = await checkPricePullback(signal.symbol, signal.direction, signal.entry);
    if (!pullbackCheck.passed) {
      console.log(`❌ [EXECUTOR] Trade rejected: ${pullbackCheck.reason}`);
      return { success: false, reason: pullbackCheck.reason };
    }

    // Phase 2: Momentum recheck (BALANCED MODE)
    const momentumCheck = await recheckMomentum(signal.symbol, signal.direction, signal.initialMomentum || 0);
    if (!momentumCheck.passed) {
      console.log(`❌ [EXECUTOR] Trade rejected: ${momentumCheck.reason}`);
      return { success: false, reason: momentumCheck.reason };
    }

    // Execute based on mode
    let result;
    if (EXECUTION_CONFIG.entryMode === 'MAKER_FIRST_BALANCED' || EXECUTION_CONFIG.entryMode === 'MAKER_FIRST') {
      result = await executeTradeMakerFirst(ctx);
    } else {
      result = await executeTradeMarketOnly(ctx);
    }

    const elapsed = Date.now() - startTime;
    console.log(`✅ [EXECUTOR] Trade completed in ${elapsed}ms`);
    console.log(`   Mode: ${result.mode}`);
    console.log(`   Success: ${result.success}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return result;

  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`💀 [EXECUTOR] Fatal error after ${elapsed}ms: ${err.message}`);
    console.error(err.stack);

    return {
      success: false,
      error: err.message
    };
  }
}

// =====================================================
// 14) GET ACTIVE POSITIONS (for monitorApi)
// =====================================================
export async function getActivePositions() {
  try {
    const response = await bybitClient.getPositionInfo({
      category: 'linear',
      settleCoin: 'USDT'
    });

    if (response?.retCode !== 0) {
      throw new Error(`Get positions failed: ${response?.retMsg || 'Unknown error'}`);
    }

    const positions = response.result?.list || [];

    // Filter only positions with size > 0
    const activePositions = positions
      .filter(pos => parseFloat(pos.size) > 0)
      .map(pos => ({
        symbol: pos.symbol,
        side: pos.side,
        size: parseFloat(pos.size),
        entryPrice: parseFloat(pos.avgPrice),
        markPrice: parseFloat(pos.markPrice),
        leverage: parseFloat(pos.leverage),
        unrealisedPnl: parseFloat(pos.unrealisedPnl),
        takeProfit: parseFloat(pos.takeProfit) || null,
        stopLoss: parseFloat(pos.stopLoss) || null,
        createdTime: pos.createdTime
      }));

    return activePositions;
  } catch (err) {
    console.error(`❌ [GET-POSITIONS] Failed: ${err.message}`);
    return [];
  }
}

export default { executeTrade, setPositionTracker, getActivePositions };
