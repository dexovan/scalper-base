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
import { formatPriceByTick } from '../utils/priceFormatter.js';
import { fetchInstrumentsUSDTPerp } from '../connectors/bybitPublic.js';

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

function updatePosition(symbol, data, tickSize = null) {
  if (!positionTracker) return;

  // Apply tickSize-safe formatting
  if (tickSize) {
    if (data.entry !== undefined) data.entry = Number(formatPriceByTick(data.entry, tickSize));
    if (data.tp !== undefined)    data.tp    = Number(formatPriceByTick(data.tp,    tickSize));
    if (data.sl !== undefined)    data.sl    = Number(formatPriceByTick(data.sl,    tickSize));
  }

  positionTracker.updatePosition(symbol, data);
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
// 5B) HELPER: Get valid quantity for symbol
// =====================================================
async function getValidQuantity(symbol, usdValue, price) {
  try {
    // Get symbol info from Bybit
    const response = await bybitClient.getInstrumentsInfo({
      category: 'linear',
      symbol
    });

    if (response?.retCode !== 0 || !response.result?.list?.[0]) {
      console.warn(`⚠️  [QTY] Cannot get symbol info for ${symbol}, using default precision`);
      const rawQty = usdValue / price;
      return parseFloat(rawQty.toFixed(3));
    }

    const symbolInfo = response.result.list[0];
    const lotSizeFilter = symbolInfo.lotSizeFilter || {};
    const minOrderQty = parseFloat(lotSizeFilter.minOrderQty || '0.001');
    const maxOrderQty = parseFloat(lotSizeFilter.maxOrderQty || '10000');
    const qtyStep = parseFloat(lotSizeFilter.qtyStep || '0.001');

    // Calculate raw quantity
    let qty = usdValue / price;

    // Round down to qtyStep precision
    const precision = qtyStep.toString().split('.')[1]?.length || 0;
    qty = Math.floor(qty / qtyStep) * qtyStep;
    qty = parseFloat(qty.toFixed(precision));

    // Clamp to min/max
    if (qty < minOrderQty) {
      console.warn(`⚠️  [QTY] ${symbol}: Calculated qty ${qty} < min ${minOrderQty}, using min`);
      qty = minOrderQty;
    }
    if (qty > maxOrderQty) {
      console.warn(`⚠️  [QTY] ${symbol}: Calculated qty ${qty} > max ${maxOrderQty}, using max`);
      qty = maxOrderQty;
    }

    console.log(`✅ [QTY] ${symbol}: $${usdValue} @ $${price} = ${qty} (min: ${minOrderQty}, step: ${qtyStep})`);
    return qty;

  } catch (err) {
    console.error(`❌ [QTY] Error getting valid quantity for ${symbol}:`, err.message);
    // Fallback to simple calculation
    const rawQty = usdValue / price;
    return parseFloat(rawQty.toFixed(3));
  }
}

// =====================================================
// 6) BYBIT API WRAPPERS
// =====================================================

/**
 * Place market order
 */
async function placeMarketOrder(symbol, side, qty, tickSize) {
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
async function placeLimitOrder(symbol, side, qty, price, tickSize, postOnly = true) {
  try {
    // Format price according to tickSize
    const formattedPrice = formatPriceByTick(price, tickSize);

    const response = await bybitClient.submitOrder({
      category: 'linear',
      symbol,
      side,
      orderType: 'Limit',
      qty: String(qty),
      price: formattedPrice,
      timeInForce: postOnly ? 'PostOnly' : 'GTC',
      positionIdx: 0
    });

    if (response?.retCode !== 0) {
      throw new Error(`Limit order failed: ${response?.retMsg || 'Unknown error'}`);
    }

    console.log(`✅ [LIMIT] ${side} ${qty} ${symbol} @ ${formattedPrice} (tick=${tickSize}) → OrderID: ${response.result?.orderId}`);
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
    // First check if leverage is already set to avoid "leverage not modified" error
    const posInfo = await bybitClient.getPositionInfo({
      category: 'linear',
      symbol
    });

    if (posInfo?.retCode === 0 && posInfo.result?.list?.length > 0) {
      const position = posInfo.result.list[0];
      const currentLeverage = parseInt(position.leverage || '0');

      if (currentLeverage === leverage) {
        console.log(`✅ [LEVERAGE] ${symbol} already at ${leverage}x, skipping`);
        return true;
      }
    }

    // Leverage needs to be changed
    const response = await bybitClient.setLeverage({
      category: 'linear',
      symbol,
      buyLeverage: String(leverage),
      sellLeverage: String(leverage)
    });

    if (response?.retCode !== 0) {
      // If error is "leverage not modified", treat as non-fatal
      if (response?.retMsg?.includes('leverage not modified')) {
        console.log(`✅ [LEVERAGE] ${symbol} already at ${leverage}x (confirmed by API)`);
        return true;
      }
      throw new Error(`Set leverage failed: ${response?.retMsg || 'Unknown error'}`);
    }

    console.log(`✅ [LEVERAGE] ${symbol} set to ${leverage}x`);
    return true;
  } catch (err) {
    // If error is "leverage not modified", treat as non-fatal
    if (err.message?.includes('leverage not modified')) {
      console.log(`✅ [LEVERAGE] ${symbol} already at target leverage (error caught)`);
      return true;
    }
    console.error(`❌ [LEVERAGE] Failed for ${symbol}: ${err.message}`);
    throw err; // Phase 1: throw to prevent trading with wrong leverage
  }
}

/**
 * Set TP/SL (Phase 1: retry 3x, auto-close on failure)
 */
async function setTakeProfitStopLoss(symbol, side, tp, sl, tickSize) {
  const maxAttempts = EXECUTION_CONFIG.tpslRetries;
  const delayMs = EXECUTION_CONFIG.tpslRetryDelayMs;

  // Format TP/SL before sending to Bybit
  const formattedTP = formatPriceByTick(tp, tickSize);
  const formattedSL = formatPriceByTick(sl, tickSize);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await bybitClient.setTradingStop({
        category: 'linear',
        symbol,
        positionIdx: 0,
        takeProfit: formattedTP,
        stopLoss: formattedSL
      });

      if (response?.retCode !== 0) {
        throw new Error(`Set TP/SL failed: ${response?.retMsg || 'Unknown error'}`);
      }

      console.log(`✅ [TP/SL] ${symbol} → TP: ${formattedTP}, SL: ${formattedSL} (tick=${tickSize})`);
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

    console.log(`🛑 [CLOSE] Closing ${symbol} position (${closeSide})...`);

    const response = await bybitClient.submitOrder({
      category: 'linear',
      symbol,
      side: closeSide,
      orderType: 'Market',
      qty: '0', // Auto-close full size
      timeInForce: 'IOC',
      positionIdx: 0,
      reduceOnly: true
    });

    if (response?.retCode !== 0) {
      throw new Error(`Close position failed: ${response?.retMsg || 'Unknown error'}`);
    }

    console.log(`✅ [CLOSE] Position ${symbol} closed (OrderID ${response.result?.orderId})`);
    removePosition(symbol);
    return true;

  } catch (err) {
    console.error(`❌ [CLOSE] Failed: ${err.message}`);
    return false;
  }
}

// =====================================================
// 7) GET LIVE MARKET STATE (from engine API) - SAFE VERSION v4
// =====================================================
async function getLiveMarketState(symbol) {
  try {
    const response = await fetch(`http://localhost:8090/api/live-market/${symbol}`);
    if (!response.ok) {
      throw new Error(`Engine API returned ${response.status}`);
    }
    const data = await response.json();
    if (!data.ok || !data.live) {
      throw new Error('Invalid response from Engine API');
    }

    const live = data.live;

    // Normalize + protect against null/undefined
    return {
      price:      Number(live.price) || null,
      bid:        Number(live.bid) || Number(live.price) || null,
      ask:        Number(live.ask) || Number(live.price) || null,
      spread:     Number(live.spreadPercent) || 0,
      imbalance:  Number(live.imbalance) || 1.0,
      orderFlow:  Number(live.orderFlowNet60s) || 0
    };
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

  // Fetch candles from correct endpoint
  try {
    const response = await fetch(`http://localhost:8090/api/symbol/${symbol}/candles/1?limit=${config.pullbackWindowMinutes}`);
    if (!response.ok) {
      console.warn(`⚠️  [PULLBACK] Failed to fetch candles for ${symbol}`);
      return { passed: true, reason: 'Failed to fetch candle data' };
    }
    const data = await response.json();

    if (!data.ok || !data.candles || data.candles.length === 0) {
      console.warn(`⚠️  [PULLBACK] No candle data for ${symbol}, skipping check`);
      return { passed: true, reason: 'No candle data' };
    }

    const recentCandles = data.candles.slice(-config.pullbackWindowMinutes);
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
  } catch (error) {
    console.warn(`⚠️  [PULLBACK] Error fetching candles for ${symbol}:`, error.message);
    return { passed: true, reason: 'Error fetching candle data' };
  }
}

// =====================================================
// 9) PHASE 2: MOMENTUM RECHECK (BALANCED MODE)
// =====================================================
async function recheckMomentum(symbol, direction, initialMomentum) {
  console.log(`\n🔍 [DEBUG/MOMENTUM] recheckMomentum called:`);
  console.log(`   Symbol: ${symbol}`);
  console.log(`   Direction: ${direction}`);
  console.log(`   initialMomentum: ${initialMomentum} (type: ${typeof initialMomentum})`);
  console.log(`   config.minInitialMomentum: ${EXECUTION_CONFIG.pullbackCheck.minInitialMomentum}`);

  if (!EXECUTION_CONFIG.pullbackCheck.enabled) {
    return { passed: true, reason: 'Momentum recheck disabled' };
  }

  const config = EXECUTION_CONFIG.pullbackCheck;

  if (initialMomentum < config.minInitialMomentum) {
    console.log(`   ❌ [DEBUG] FAILED: ${initialMomentum} < ${config.minInitialMomentum}`);
    return {
      passed: false,
      reason: `Initial momentum ${(initialMomentum * 100).toFixed(1)}% < ${(config.minInitialMomentum * 100)}% threshold`,
      momentum: initialMomentum
    };
  }
  console.log(`   ✅ [DEBUG] PASSED: ${initialMomentum} >= ${config.minInitialMomentum}`);

  console.log(`⏳ [TIMING] Waiting ${config.recheckDelayMs}ms to recheck momentum...`);
  await sleep(config.recheckDelayMs);

  const marketState = await getLiveMarketState(symbol);
  if (!marketState) {
    console.warn(`⚠️  [MOMENTUM] No market data for ${symbol} after delay`);
    return { passed: true, reason: 'No market data after delay' };
  }

  // Extract momentum from imbalance ratio (imbalance > 1.0 = more bids, < 1.0 = more asks)
  const imbalance = marketState.imbalance || 1.0;
  const currentMomentum = direction === 'LONG'
    ? Math.max(0, (imbalance - 1.0))  // LONG: excess bid pressure
    : Math.max(0, (1.0 - imbalance));  // SHORT: excess ask pressure

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

  // Calculate valid quantity respecting Bybit symbol constraints
  const qty = await getValidQuantity(symbol, positionSize, entry);
  const side = direction === 'LONG' ? 'Buy' : 'Sell';

  // Place market order
  const orderResult = await placeMarketOrder(symbol, side, qty, ctx.tickSize);

  // Phase 1: Set TP/SL with retry (auto-closes on failure)
  await setTakeProfitStopLoss(symbol, side, tp, sl, ctx.tickSize);

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
    tickSize: ctx.tickSize,
    timestamp: new Date().toISOString()
  }, ctx.tickSize);

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

  // Calculate valid quantity respecting Bybit symbol constraints
  const qty = await getValidQuantity(symbol, positionSize, entry);
  const side = direction === 'LONG' ? 'Buy' : 'Sell';

  // STEP 1: Place post-only limit order at entry price
  const limitResult = await placeLimitOrder(symbol, side, qty, entry, ctx.tickSize, true);
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

    await setTakeProfitStopLoss(symbol, side, tp, sl, ctx.tickSize);

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
      tickSize: ctx.tickSize,
      timestamp: new Date().toISOString()
    }, ctx.tickSize);

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
    ? marketState.ask
    : marketState.bid;

  const priceDrift = Math.abs((currentPrice - entry) / entry);

  console.log(`📊 [FALLBACK-CHECK] Price drift: ${(priceDrift * 100).toFixed(2)}%`);

  if (priceDrift > config.maxPriceDriftPercent / 100) {
    console.log(`❌ [MAKER-FIRST] Price drifted too much (${(priceDrift * 100).toFixed(2)}% > ${config.maxPriceDriftPercent}%), skipping trade`);
    return { success: false, reason: `Price drift ${(priceDrift * 100).toFixed(2)}% exceeds ${config.maxPriceDriftPercent}%` };
  }

  // Check spread
  const spread = marketState.spread || 0;
  console.log(`📊 [FALLBACK-CHECK] Spread: ${(spread * 100).toFixed(2)}%`);

  if (spread > config.maxSpreadPercent / 100) {
    console.log(`❌ [MAKER-FIRST] Spread too wide (${(spread * 100).toFixed(2)}% > ${config.maxSpreadPercent}%), skipping trade`);
    return { success: false, reason: `Spread ${(spread * 100).toFixed(2)}% exceeds ${config.maxSpreadPercent}%` };
  }

  // Check momentum from imbalance ratio
  const imbalance = marketState.imbalance || 1.0;
  const currentMomentum = direction === 'LONG'
    ? Math.max(0, (imbalance - 1.0))  // LONG: excess bid pressure
    : Math.max(0, (1.0 - imbalance));  // SHORT: excess ask pressure

  console.log(`📊 [FALLBACK-CHECK] Current momentum: ${(currentMomentum * 100).toFixed(1)}%`);

  if (currentMomentum < config.minMomentumPercent / 100) {
    console.log(`❌ [MAKER-FIRST] Momentum dropped (${(currentMomentum * 100).toFixed(1)}% < ${config.minMomentumPercent}%), skipping trade`);
    return { success: false, reason: `Momentum ${(currentMomentum * 100).toFixed(1)}% below ${config.minMomentumPercent}%` };
  }

  // =========================================================
  // MAKER → FALLBACK MARKET ENTRY (with TP/SL recalculation)
  // =========================================================
  console.log(`✅ [MAKER-FALLBACK] Conditions safe, executing MARKET fallback...`);

  const marketResult = await placeMarketOrder(symbol, side, qty, ctx.tickSize);

  // Get actual fill price from API result or fallback to last bid/ask
  const fillPrice =
    Number(marketResult.avgPrice) ||
    (direction === 'LONG' ? marketState.ask : marketState.bid);

  console.log(`🎯 [FALLBACK] Real fill price: ${fillPrice}`);

  // ==========================================
  // RECALCULATE TP/SL from new fill price
  // Using same R/R model as scanner (0.35% TP, 0.30% SL)
  // ==========================================
  const tpDistance = 0.0035;  // 0.35%
  const slDistance = 0.0030;  // 0.30%

  let newTP, newSL;

  if (direction === 'LONG') {
    newTP = fillPrice * (1 + tpDistance);
    newSL = fillPrice * (1 - slDistance);
  } else {
    newTP = fillPrice * (1 - tpDistance);
    newSL = fillPrice * (1 + slDistance);
  }

  // TickSize formatting
  newTP = Number(formatPriceByTick(newTP, ctx.tickSize));
  newSL = Number(formatPriceByTick(newSL, ctx.tickSize));

  console.log(`📊 [FALLBACK-TP/SL] Recalculated targets:`);
  console.log(`   TP = ${newTP}`);
  console.log(`   SL = ${newSL}`);

  // Apply TP/SL after market fill
  await setTakeProfitStopLoss(symbol, side, newTP, newSL, ctx.tickSize);

  // Update position tracker
  updatePosition(symbol, {
    symbol,
    side: direction,
    entry: fillPrice,
    tp: newTP,
    sl: newSL,
    qty,
    positionSize,
    leverage,
    orderId: marketResult.orderId,
    status: 'OPEN',
    entryMode: 'MAKER_FALLBACK',
    tickSize: ctx.tickSize,
    timestamp: new Date().toISOString()
  }, ctx.tickSize);

  return {
    success: true,
    mode: 'MAKER_FALLBACK',
    orderId: marketResult.orderId,
    entry: fillPrice,
    tp: newTP,
    sl: newSL
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

    // =====================================================
    // PATCH 1 – FETCH TICKSIZE & FORMAT PRICES
    // =====================================================

    try {
      console.log(`🔍 [TICKSIZE] Fetching tickSize for ${ctx.symbol}...`);

      // Get global instrument metadata
      const instruments = await fetchInstrumentsUSDTPerp();

      if (instruments.success) {
        const meta = instruments.symbols.find(x => x.symbol === ctx.symbol);

        if (meta) {
          ctx.tickSize = meta.tickSize;

          console.log(`✅ [TICKSIZE] ${ctx.symbol} tickSize = ${ctx.tickSize}`);

          // Apply tickSize formatting to entry, TP, SL
          ctx.entry = parseFloat(formatPriceByTick(ctx.entry, ctx.tickSize));
          ctx.tp    = parseFloat(formatPriceByTick(ctx.tp,    ctx.tickSize));
          ctx.sl    = parseFloat(formatPriceByTick(ctx.sl,    ctx.tickSize));

          console.log(`🎯 [PRICE-FIX] Corrected prices:`);
          console.log(`   ENTRY = ${ctx.entry}`);
          console.log(`   TP    = ${ctx.tp}`);
          console.log(`   SL    = ${ctx.sl}`);

        } else {
          console.warn(`⚠️  [TICKSIZE] No metadata for ${ctx.symbol}, using default tickSize=0.0001`);
          ctx.tickSize = 0.0001;
        }
      } else {
        console.warn(`⚠️  [TICKSIZE] fetchInstrumentsUSDTPerp() failed: ${instruments.error}`);
        ctx.tickSize = 0.0001;
      }

    } catch (err) {
      console.error(`❌ [TICKSIZE] Error while applying tickSize: ${err.message}`);
      ctx.tickSize = 0.0001;
    }

    // Phase 2: Pullback check (BALANCED MODE)
    const pullbackCheck = await checkPricePullback(signal.symbol, signal.direction, signal.entry);
    if (!pullbackCheck.passed) {
      console.log(`❌ [EXECUTOR] Trade rejected: ${pullbackCheck.reason}`);

      return {
        success: false,
        mode: 'REJECTED_PULLBACK',
        symbol: signal.symbol,
        direction: signal.direction,
        reason: pullbackCheck.reason,
        tickSize: ctx.tickSize || null
      };
    }

    // Phase 2: Momentum recheck (BALANCED MODE)
    const momentumCheck = await recheckMomentum(signal.symbol, signal.direction, signal.initialMomentum || 0);
    if (!momentumCheck.passed) {
      console.log(`❌ [EXECUTOR] Trade rejected: ${momentumCheck.reason}`);

      return {
        success: false,
        mode: 'REJECTED_MOMENTUM',
        symbol: signal.symbol,
        direction: signal.direction,
        reason: momentumCheck.reason,
        tickSize: ctx.tickSize || null
      };
    }

    // Execute based on mode
    let rawResult;
    if (EXECUTION_CONFIG.entryMode === 'MAKER_FIRST_BALANCED' || EXECUTION_CONFIG.entryMode === 'MAKER_FIRST') {
      rawResult = await executeTradeMakerFirst(ctx);
    } else {
      rawResult = await executeTradeMarketOnly(ctx);
    }

    const elapsed = Date.now() - startTime;
    console.log(`✅ [EXECUTOR] Trade completed in ${elapsed}ms`);
    console.log(`   Mode: ${rawResult.mode}`);
    console.log(`   Success: ${rawResult.success}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // FINAL, NORMALIZED RESPONSE
    return {
      success: rawResult.success,
      mode: rawResult.mode,
      symbol: ctx.symbol,
      direction: ctx.direction,
      entry: rawResult.entry ?? ctx.entry,
      tp: rawResult.tp ?? ctx.tp,
      sl: rawResult.sl ?? ctx.sl,
      orderId: rawResult.orderId ?? null,
      leverage: ctx.leverage,
      positionSize: ctx.positionSize,
      tickSize: ctx.tickSize || null,
      reason: rawResult.reason || null
    };

  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`💀 [EXECUTOR] Fatal error after ${elapsed}ms: ${err.message}`);
    console.error(err.stack);

    return {
      success: false,
      mode: 'ERROR',
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entry ?? null,
      tp: signal.tp ?? null,
      sl: signal.sl ?? null,
      orderId: null,
      leverage: EXECUTION_CONFIG.leverage,
      positionSize: EXECUTION_CONFIG.marginPerTrade * EXECUTION_CONFIG.leverage,
      tickSize: null,
      reason: err.message,
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
