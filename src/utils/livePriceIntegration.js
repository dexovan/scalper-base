// ============================================================
// LIVE PRICE INTEGRATION & DYNAMIC ENTRY CALCULATION
// Combines: Candle trends + Live data + Order book walls + Absorption
// For precise entry timing and profit maximization
// ============================================================

import {
  detectOrderBookWalls,
  analyzeWallAbsorption,
  integrateWallsWithPrice,
  validateSupportResistanceWithWalls
} from './orderBookWallAnalysis.js';

/**
 * Comprehensive entry calculation using ALL available data
 *
 * @param {Object} params
 *   - candleData: { support, resistance, atr, trend, trendStrength }
 *   - liveData: { currentPrice, imbalance, spread, velocity, orderFlow }
 *   - orderBook: { b: [...bids], a: [...asks] }
 *   - recentTrades: []
 * @returns {Object} - { entry, tp, sl, timing, confidence, wallAnalysis, recommendation }
 */
export function calculateDynamicEntryWithWalls(params) {
  const {
    candleData = {},
    liveData = {},
    orderBook = null,
    recentTrades = [],
    debugSymbol = null
  } = params;

  // Extract candle data
  const support = candleData.support || 0;
  const resistance = candleData.resistance || 0;
  const atr = candleData.atr || 0;
  const trend = candleData.trend || 'NEUTRAL';
  const trendStrength = candleData.trendStrength || 0;

  // Extract live data
  const currentPrice = liveData.currentPrice || 0;
  const imbalance = liveData.imbalance || 1.0;
  const velocity = liveData.velocity || 0;
  const orderFlowNet = liveData.orderFlowNet || 0;

  let wallAnalysis = {
    wallStatus: 'NO_DATA',
    confidenceScore: 0,
    buyWallStatus: null,
    sellWallStatus: null
  };

  let wallIntegration = {
    recommendation: 'WAIT',
    timingScore: 0,
    entryAdjustment: 0
  };

  // ===== STEP 1: Analyze order book walls (if available) =====
  if (orderBook && (orderBook.b || orderBook.a)) {
    const walls = detectOrderBookWalls(orderBook, { wallThreshold: 0.05 });
    wallAnalysis = analyzeWallAbsorption(walls, recentTrades, currentPrice);
    wallIntegration = integrateWallsWithPrice(wallAnalysis, {
      currentPrice,
      support,
      resistance,
      trend
    });

    if (debugSymbol) {
      console.log(`  [WALLS] ${debugSymbol}: wallStatus=${wallAnalysis.wallStatus}, buyWall=${wallAnalysis.buyWallStatus}, sellWall=${wallAnalysis.sellWallStatus}`);
      console.log(`  [WALLS] Recommendation: ${wallIntegration.recommendation}, timingScore: ${wallIntegration.timingScore}`);
    }
  }

  // ===== STEP 2: Calculate base entry from candles =====
  let entry = currentPrice;
  let tp = resistance;
  let sl = support;
  let profitPotential = 0;
  let profitPercent = 0;

  if (trend === 'BULLISH') {
    // LONG entry near support with momentum
    entry = support + (atr * 0.3);
    tp = resistance;
    sl = support - atr;
    profitPotential = tp - entry;
    profitPercent = ((profitPotential / entry) * 100);
  } else if (trend === 'BEARISH') {
    // SHORT entry near resistance with momentum
    entry = resistance - (atr * 0.3);
    tp = support;
    sl = resistance + atr;
    profitPotential = entry - tp;
    profitPercent = ((profitPotential / entry) * 100);
  }

  // ===== STEP 3: Adjust entry based on current price momentum =====
  if (trend === 'BULLISH') {
    // Price rising - follow it up but stay conservative
    const maxEntryPrice = resistance;
    entry = Math.min(support + (atr * 0.3) + (currentPrice - support) * 0.25, maxEntryPrice);
    entry = Math.max(entry, support);
  } else if (trend === 'BEARISH') {
    // Price falling - follow it down but stay conservative
    const minEntryPrice = support;
    entry = Math.max(resistance - (atr * 0.3) - (resistance - currentPrice) * 0.25, minEntryPrice);
    entry = Math.min(entry, resistance);
  }

  // ===== STEP 4: Fine-tune entry based on wall analysis =====
  if (wallIntegration.entryAdjustment !== 0) {
    // Wall analysis suggests a better entry point
    const wallEntry = wallIntegration.entryAdjustment;

    if (trend === 'BULLISH') {
      // For long, use wall entry if it's better (closer to support)
      entry = Math.min(entry, wallEntry);
    } else if (trend === 'BEARISH') {
      // For short, use wall entry if it's better (closer to resistance)
      entry = Math.max(entry, wallEntry);
    }
  }

  // ===== STEP 5: Recalculate profit targets with final entry =====
  if (trend === 'BULLISH') {
    profitPotential = tp - entry;
  } else if (trend === 'BEARISH') {
    profitPotential = entry - tp;
  }
  profitPercent = entry > 0 ? ((profitPotential / entry) * 100) : 0;

  // ===== STEP 6: Calculate confidence and timing scores =====
  let confidenceScore = 50;
  let timingScore = 50;
  let timeoutMessage = 'WAIT';

  // Base confidence from trend strength
  confidenceScore = Math.min(100, trendStrength || 50);

  // Boost confidence if walls validate support/resistance
  if (wallAnalysis.wallStatus === 'ABSORBING' || wallAnalysis.wallStatus === 'BROKEN') {
    confidenceScore = Math.min(100, confidenceScore + 20);
    timingScore = Math.min(100, timingScore + 30);
  }

  // Boost confidence if imbalance aligns with trend
  if ((trend === 'BULLISH' && imbalance > 1.05) || (trend === 'BEARISH' && imbalance < 0.95)) {
    confidenceScore = Math.min(100, confidenceScore + 15);
    timingScore = Math.min(100, timingScore + 20);
  }

  // Boost confidence if velocity aligns with trend
  if ((trend === 'BULLISH' && velocity > 0.03) || (trend === 'BEARISH' && velocity < -0.03)) {
    confidenceScore = Math.min(100, confidenceScore + 10);
    timingScore = Math.min(100, timingScore + 15);
  }

  // Determine timing message based on wall status
  if (wallIntegration.recommendation === 'ENTER_LONG_NOW' || wallIntegration.recommendation === 'ENTER_SHORT_NOW') {
    timeoutMessage = '🎯 WALL BROKEN - ENTER NOW! (Absorption detected)';
    timingScore = 95;
  } else if (wallIntegration.recommendation === 'PREPARE_ENTRY') {
    timeoutMessage = '📈 Wall absorbing - prepare entry (Strong momentum)';
    timingScore = 80;
  } else if (wallIntegration.recommendation === 'MONITOR_ABSORPTION') {
    timeoutMessage = '👁️ Monitor wall absorption - entry signal coming';
    timingScore = 65;
  } else if (wallAnalysis.wallStatus === 'STRONG') {
    if (trend === 'BULLISH') {
      timeoutMessage = '⏳ Wait for sell wall to absorb (Price must break resistance)';
    } else if (trend === 'BEARISH') {
      timeoutMessage = '⏳ Wait for buy wall to absorb (Price must break support)';
    }
    timingScore = 40;
  } else {
    timeoutMessage = `${trend === 'BULLISH' ? '🚀' : '📉'} ${trend} trend - Entry ready`;
    timingScore = trendStrength || 55;
  }

  // ===== STEP 7: Calculate entry zone (range of acceptable prices) =====
  const entryZone = {
    min: entry * 0.995, // 0.5% below
    max: entry * 1.005  // 0.5% above
  };

  return {
    entry: parseFloat(entry.toFixed(8)),
    tp: parseFloat(tp.toFixed(8)),
    sl: parseFloat(sl.toFixed(8)),
    profitPotential: parseFloat(profitPotential.toFixed(8)),
    profitPercent: parseFloat(profitPercent.toFixed(2)),
    entryZone,

    // Confidence & Timing
    confidenceScore: Math.round(confidenceScore),
    timingScore: Math.round(timingScore),
    timeoutMessage,

    // Wall Analysis Integration
    wallAnalysis,
    wallRecommendation: wallIntegration.recommendation,

    // Diagnostic info
    debug: debugSymbol
      ? {
        support: parseFloat(support.toFixed(8)),
        resistance: parseFloat(resistance.toFixed(8)),
        currentPrice: parseFloat(currentPrice.toFixed(8)),
        atr: parseFloat(atr.toFixed(8)),
        trend,
        trendStrength: parseFloat(trendStrength.toFixed(2)),
        imbalance: parseFloat(imbalance.toFixed(4)),
        velocity: parseFloat(velocity.toFixed(4))
      }
      : null
  };
}

/**
 * Determines if current price is in optimal entry zone
 * considering all factors
 */
export function isOptimalEntryTime(entryCalculation, currentPrice) {
  const { entry, entryZone, timingScore, confidenceScore, trend } = entryCalculation;

  // Price must be in entry zone
  const priceInZone = currentPrice >= entryZone.min && currentPrice <= entryZone.max;

  // Timing and confidence must be high enough
  const timingGood = timingScore >= 60;
  const confidenceGood = confidenceScore >= 55;

  // For bullish, price should be at or below entry
  // For bearish, price should be at or above entry
  const priceDirection =
    trend === 'BULLISH' ? currentPrice <= entry * 1.01 : currentPrice >= entry * 0.99;

  return {
    isOptimal: priceInZone && timingGood && confidenceGood && priceDirection,
    priceInZone,
    timingGood,
    confidenceGood,
    priceDirection,
    recommendation: priceInZone && timingGood && confidenceGood ? '🎯 ENTER NOW' : '⏳ WAIT'
  };
}

/**
 * Tracks entry attempts and adjusts timing for retry
 */
export function shouldRetryEntry(entryCalculation, previousAttempt, currentPrice) {
  if (!previousAttempt) return { shouldRetry: true, reason: 'first_attempt' };

  const timeSinceLast = Date.now() - previousAttempt.timestamp;
  const priceMoved = Math.abs(currentPrice - previousAttempt.price) / previousAttempt.price;

  // Retry if:
  // 1. More than 5 seconds passed AND timing still good
  // 2. Price moved more than 0.3% away from entry
  // 3. Confidence score improved

  const shouldRetry =
    (timeSinceLast > 5000 && entryCalculation.timingScore >= 60) ||
    priceMoved > 0.003 ||
    entryCalculation.confidenceScore > previousAttempt.confidenceScore;

  return {
    shouldRetry,
    reason: shouldRetry ? 'time_or_price_moved' : 'waiting',
    timeSinceLast,
    priceMoved: (priceMoved * 100).toFixed(3)
  };
}
