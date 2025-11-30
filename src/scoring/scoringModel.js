/**
 * SCORING MODEL - Pure Mathematical Core
 *
 * This module contains ONLY pure mathematical functions for computing scalp scores.
 * It has NO knowledge of:
 * - Regime state
 * - Risk management
 * - Global market conditions
 *
 * Purpose: Given a FeatureState, compute base scores (0-100) for LONG and SHORT.
 *
 * Architecture:
 * - 8 scoring components (orderbook, flow, walls, volatility, feeEdge, spoof penalty, pump penalty, news penalty)
 * - Each component normalized to 0-100 scale
 * - Weighted combination produces baseScoreLong and baseScoreShort
 * - Separate module (scoringEngine) applies regime/risk filters
 */

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

/**
 * Clamp value between min and max
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize value from [inputMin, inputMax] to [0, 100]
 */
function normalize(value, inputMin, inputMax) {
  if (inputMax === inputMin) return 50; // Avoid division by zero
  const normalized = ((value - inputMin) / (inputMax - inputMin)) * 100;
  return clamp(normalized, 0, 100);
}

/**
 * Sigmoid function for smooth scaling (0-1)
 */
function sigmoid(x, steepness = 1) {
  return 1 / (1 + Math.exp(-steepness * x));
}

/**
 * Inverted parabola - optimal middle range, penalty at extremes
 * Used for volatility scoring (too low = bad, too high = bad, middle = best)
 */
function invertedParabola(value, optimalMin, optimalMax, minVal, maxVal) {
  if (value >= optimalMin && value <= optimalMax) {
    return 100; // Perfect range
  }
  if (value < optimalMin) {
    // Too low - linear penalty
    return normalize(value, minVal, optimalMin);
  }
  // Too high - exponential penalty
  const excess = value - optimalMax;
  const maxExcess = maxVal - optimalMax;
  const penalty = Math.pow(excess / maxExcess, 1.5) * 100;
  return clamp(100 - penalty, 0, 100);
}

// ================================================================
// SCORING COMPONENT FUNCTIONS
// ================================================================

/**
 * 1) ORDERBOOK SCORE
 *
 * Measures orderbook imbalance signals
 * LONG: Positive imbalance (more bids), strong bid zones
 * SHORT: Negative imbalance (more asks), strong ask zones
 */
function computeOrderbookScore(symbol, features) {
  const imbalance = features.imbalance || {};
  const tob = imbalance.tobImbalance || 0; // Top-of-book (-1 to +1)
  const zoneShort = imbalance.zoneImbalanceShort || 0;
  const zoneMid = imbalance.zoneImbalanceMid || 0;
  const zoneFar = imbalance.zoneImbalanceFar || 0;

  // LONG score: positive imbalance
  const longRaw =
    tob * 30 +
    zoneShort * 25 +
    zoneMid * 25 +
    zoneFar * 20;
  const scoreLong = normalize(longRaw, -100, 100);

  // SHORT score: negative imbalance (inverse)
  const shortRaw =
    -tob * 30 +
    -zoneShort * 25 +
    -zoneMid * 25 +
    -zoneFar * 20;
  const scoreShort = normalize(shortRaw, -100, 100);

  return { scoreLong, scoreShort };
}

/**
 * 2) FLOW/DELTA SCORE
 *
 * Measures trade flow and buy/sell pressure
 * LONG: Positive buy volume, positive delta ratio
 * SHORT: Positive sell volume, negative delta ratio
 */
function computeFlowScore(symbol, features) {
  const flow = features.flow || {};

  // Buy/sell volumes (1s, 5s, 15s)
  const buyVol1s = flow.buyVolume1s || 0;
  const buyVol5s = flow.buyVolume5s || 0;
  const buyVol15s = flow.buyVolume15s || 0;

  const sellVol1s = flow.sellVolume1s || 0;
  const sellVol5s = flow.sellVolume5s || 0;
  const sellVol15s = flow.sellVolume15s || 0;

  // Delta ratios (-1 to +1)
  const delta1s = flow.deltaRatio1s || 0;
  const delta5s = flow.deltaRatio5s || 0;
  const delta15s = flow.deltaRatio15s || 0;

  // Dominance streak
  const streakSeconds = flow.dominanceStreakSeconds || 0;

  // LONG score (bullish flow)
  const longRaw =
    delta1s * 35 +
    delta5s * 30 +
    delta15s * 20 +
    (streakSeconds > 0 ? Math.min(streakSeconds, 10) : 0) * 1.5;
  const scoreLong = normalize(longRaw, -100, 100);

  // SHORT score (bearish flow)
  const shortRaw =
    -delta1s * 35 +
    -delta5s * 30 +
    -delta15s * 20 +
    (streakSeconds < 0 ? Math.min(Math.abs(streakSeconds), 10) : 0) * 1.5;
  const scoreShort = normalize(shortRaw, -100, 100);

  return { scoreLong, scoreShort };
}

/**
 * 3) WALLS SCORE
 *
 * Measures strength of support/resistance walls
 * LONG: Strong absorbing support (bid walls)
 * SHORT: Strong absorbing resistance (ask walls)
 */
function computeWallsScore(symbol, features) {
  const walls = features.walls || {};

  const supportScore = walls.absorbingSupportScore || 0; // 0-1
  const resistanceScore = walls.absorbingResistanceScore || 0; // 0-1

  const scoreLong = supportScore * 100;
  const scoreShort = resistanceScore * 100;

  return { scoreLong, scoreShort };
}

/**
 * 4) SPOOF PENALTY
 *
 * High spoofing score = manipulation = bad for both sides
 * Returns penalty value (0-100) to SUBTRACT from final score
 */
function computeSpoofPenalty(symbol, features) {
  const walls = features.walls || {};
  const spoofingScore = walls.spoofingScore || 0; // 0-1

  // Exponential penalty - high spoof = severe penalty
  const penalty = Math.pow(spoofingScore, 1.5) * 100;

  return clamp(penalty, 0, 100);
}

/**
 * 5) VOLATILITY SCORE
 *
 * Optimal volatility for scalping: not too low, not too high
 * Uses inverted parabola (best in middle range)
 *
 * Ideal volatility: 0.30 - 0.70
 * Too low (<0.20): Not enough movement for profit
 * Too high (>0.90): Too risky, large slippage
 */
function computeVolatilityScore(symbol, features) {
  const vola = features.volatility || {};
  const volatilityScore = vola.volatilityScore || 0; // 0-1 raw value

  // Apply inverted parabola
  // Optimal: 0.30-0.70 → score 100
  // Too low: <0.20 → penalty
  // Too high: >0.90 → penalty
  const score = invertedParabola(
    volatilityScore,
    0.30, // optimalMin
    0.70, // optimalMax
    0.0,  // minVal
    1.0   // maxVal
  );

  return score; // Same for both LONG and SHORT
}

/**
 * 6) FEE EDGE SCORE
 *
 * CRITICAL COMPONENT: Measures profitability opportunity
 *
 * Formula: ATR5s / minMoveForProfit
 * - If ATR >> minMove → high edge (lots of movement relative to costs)
 * - If ATR ≈ minMove → low edge (barely covers costs)
 * - If ATR < minMove → negative edge (unprofitable)
 *
 * This is THE MOST IMPORTANT score for scalping profitability.
 */
function computeFeeEdgeScore(symbol, features) {
  const feeLev = features.feeLeverage || {};
  const vola = features.volatility || {};

  const minMoveForProfit = feeLev.minMoveForProfit || 0.0001; // BPS
  const atr5s = vola.atr5s || 0; // 5-second ATR in BPS

  if (minMoveForProfit === 0 || atr5s === 0) {
    return 0; // No data = no edge
  }

  // Edge ratio
  const edgeRatio = atr5s / minMoveForProfit;

  // Normalize:
  // edgeRatio < 1.0 → score 0 (unprofitable)
  // edgeRatio = 2.0 → score 50 (marginal)
  // edgeRatio = 5.0 → score 90 (excellent)
  // edgeRatio > 10 → score 100 (exceptional)

  let score = 0;
  if (edgeRatio < 1.0) {
    score = 0;
  } else if (edgeRatio < 2.0) {
    score = (edgeRatio - 1.0) * 20; // 0-20
  } else if (edgeRatio < 5.0) {
    score = 20 + ((edgeRatio - 2.0) / 3.0) * 50; // 20-70
  } else if (edgeRatio < 10.0) {
    score = 70 + ((edgeRatio - 5.0) / 5.0) * 25; // 70-95
  } else {
    score = 100;
  }

  return clamp(score, 0, 100);
}

/**
 * 7) PUMP PENALTY
 *
 * High pump likelihood = dangerous for LONG (buying into pump)
 * For SHORT: penalty is 40-60% weaker (pumps eventually dump, but timing risky)
 */
function computePumpPenalty(symbol, features) {
  const pump = features.pumpSignals || {};
  const pumpLikelihoodScore = pump.pumpLikelihoodScore || 0; // 0-1

  // Exponential penalty for LONG
  const penaltyLong = Math.pow(pumpLikelihoodScore, 1.3) * 100;

  // Weaker penalty for SHORT (50% reduction)
  const penaltyShort = penaltyLong * 0.5;

  return {
    penaltyLong: clamp(penaltyLong, 0, 100),
    penaltyShort: clamp(penaltyShort, 0, 100)
  };
}

/**
 * 8) NEWS PENALTY
 *
 * High news impact = unpredictable = dangerous for both sides
 * If newsImpactScore > 0.80 → trading should be blocked entirely
 */
function computeNewsPenalty(symbol, features) {
  // News data would come from RegimeEngine in future
  // For now, stub with 0
  const newsImpactScore = 0; // TODO: Add news detection in future phase

  const penalty = newsImpactScore * 100;
  return clamp(penalty, 0, 100);
}

// ================================================================
// BASE SCORE COMPUTATION (Main Function)
// ================================================================

/**
 * Compute base scalp scores (LONG and SHORT)
 *
 * This is PURE MATH - no regime, no risk, no filters.
 * Just raw feature analysis.
 *
 * @param {string} symbol - Symbol name
 * @param {object} features - FeatureState object from FeatureEngine
 * @param {object} weights - Scoring weights from config
 * @returns {object} { baseLong, baseShort, components }
 */
export function computeBaseScores(symbol, features, wallAnalysis, weights) {
  // Handle legacy calls (wallAnalysis might be weights if called with old signature)
  let wallAnalysisStatus = wallAnalysis;
  let weightsConfig = weights;

  if (wallAnalysisStatus && typeof wallAnalysisStatus === 'object' && wallAnalysisStatus.orderbook) {
    weightsConfig = wallAnalysisStatus;
    wallAnalysisStatus = { status: "NO_DATA" };
  }

  // Default wall analysis if not provided
  if (!wallAnalysisStatus) {
    wallAnalysisStatus = { status: "NO_DATA" };
  }

  // Default weights (can be overridden by config)
  const w = weightsConfig || {
    orderbook: 0.20,
    flow: 0.25,
    walls: 0.15,
    volatility: 0.15,
    feeEdge: 0.25, // MOST IMPORTANT
    spoof: 1.0,    // Penalty multiplier
    pump: 0.8,     // Penalty multiplier
    news: 1.0      // Penalty multiplier
  };

  // Compute all components
  const orderbook = computeOrderbookScore(symbol, features);
  const flow = computeFlowScore(symbol, features);
  const walls = computeWallsScore(symbol, features);
  const volatility = computeVolatilityScore(symbol, features);
  const feeEdge = computeFeeEdgeScore(symbol, features);
  const spoofPenalty = computeSpoofPenalty(symbol, features);
  const pumpPenalty = computePumpPenalty(symbol, features);
  const newsPenalty = computeNewsPenalty(symbol, features);

  // Combine for LONG
  let rawLong =
    orderbook.scoreLong * w.orderbook +
    flow.scoreLong * w.flow +
    walls.scoreLong * w.walls +
    volatility * w.volatility +
    feeEdge * w.feeEdge -
    spoofPenalty * w.spoof -
    pumpPenalty.penaltyLong * w.pump -
    newsPenalty * w.news;

  // Combine for SHORT
  let rawShort =
    orderbook.scoreShort * w.orderbook +
    flow.scoreShort * w.flow +
    walls.scoreShort * w.walls +
    volatility * w.volatility +
    feeEdge * w.feeEdge -
    spoofPenalty * w.spoof -
    pumpPenalty.penaltyShort * w.pump -
    newsPenalty * w.news;

  // WALL ANALYSIS PENALTIES
  // Apply penalties based on wall status quality
  if (wallAnalysisStatus && wallAnalysisStatus.status === "NO_DATA") {
    // No orderbook data available - high risk
    rawLong -= 10;
    rawShort -= 10;
  } else if (wallAnalysisStatus && wallAnalysisStatus.status === "DEGRADED") {
    // Partial orderbook data - moderate risk
    rawLong -= 5;
    rawShort -= 5;
  }

  // Clamp to 0-100
  const baseLong = clamp(rawLong, 0, 100);
  const baseShort = clamp(rawShort, 0, 100);

  // Return scores + components (for debugging/display)
  return {
    baseLong,
    baseShort,
    components: {
      orderbook: {
        long: orderbook.scoreLong.toFixed(2),
        short: orderbook.scoreShort.toFixed(2)
      },
      flow: {
        long: flow.scoreLong.toFixed(2),
        short: flow.scoreShort.toFixed(2)
      },
      walls: {
        long: walls.scoreLong.toFixed(2),
        short: walls.scoreShort.toFixed(2)
      },
      volatility: volatility.toFixed(2),
      feeEdge: feeEdge.toFixed(2),
      spoofPenalty: spoofPenalty.toFixed(2),
      pumpPenalty: {
        long: pumpPenalty.penaltyLong.toFixed(2),
        short: pumpPenalty.penaltyShort.toFixed(2)
      },
      newsPenalty: newsPenalty.toFixed(2)
    }
  };
}

// ================================================================
// REGIME & RISK FILTERS (Applied AFTER base score)
// ================================================================

/**
 * Apply regime and risk filters to base scores
 *
 * This function applies:
 * - Global regime filter (PANIC/RISK_OFF/NORMAL)
 * - Per-symbol regime filter (PUMP/MANIPULATED/COOLDOWN/etc)
 * - Risk management filter (stub for now)
 * - Scale adjustments (volatility, spoof, pump)
 *
 * @param {object} baseScores - { baseLong, baseShort, components }
 * @param {object} symbolRegime - Symbol regime state from RegimeEngine
 * @param {object} globalRegime - Global regime state from RegimeEngine
 * @param {object} riskState - Risk state (stub for Phase 6)
 * @param {object} config - Scoring config
 * @returns {object} { finalLong, finalShort, allowedLong, allowedShort, blockedReasons }
 */
export function applyRegimeAndRiskFilters(
  baseScores,
  symbolRegime,
  globalRegime,
  riskState,
  config
) {
  let allowedLong = true;
  let allowedShort = true;
  const blockedReasons = [];

  let finalLong = baseScores.baseLong;
  let finalShort = baseScores.baseShort;

  // ================================================================
  // 1) GLOBAL REGIME FILTER
  // ================================================================

  if (globalRegime.regime === 'PANIC') {
    allowedLong = false;
    allowedShort = false;
    blockedReasons.push('GLOBAL_PANIC');
    finalLong = 0;
    finalShort = 0;
    return { finalLong, finalShort, allowedLong, allowedShort, blockedReasons };
  }

  if (globalRegime.regime === 'RISK_OFF') {
    allowedLong = false;
    allowedShort = false;
    blockedReasons.push('GLOBAL_RISK_OFF');
    finalLong = 0;
    finalShort = 0;
    return { finalLong, finalShort, allowedLong, allowedShort, blockedReasons };
  }

  // ================================================================
  // 2) PER-SYMBOL REGIME FILTER
  // ================================================================

  const regime = symbolRegime.current;

  if (regime === 'PUMP') {
    allowedLong = false;
    blockedReasons.push('SYMBOL_PUMP');
    finalLong = 0;

    // SHORT allowed but penalized (50% reduction)
    finalShort *= 0.5;
  }

  if (regime === 'MANIPULATED') {
    allowedLong = false;
    allowedShort = false;
    blockedReasons.push('SYMBOL_MANIPULATED');
    finalLong = 0;
    finalShort = 0;
    return { finalLong, finalShort, allowedLong, allowedShort, blockedReasons };
  }

  if (regime === 'NEWS_DRIVEN') {
    allowedLong = false;
    allowedShort = false;
    blockedReasons.push('SYMBOL_NEWS_DRIVEN');
    finalLong = 0;
    finalShort = 0;
    return { finalLong, finalShort, allowedLong, allowedShort, blockedReasons };
  }

  if (regime === 'COOLDOWN') {
    // 40% penalty (reduced for scalping)
    finalLong *= 0.6;
    finalShort *= 0.6;
    if (finalLong < 5) allowedLong = false;
    if (finalShort < 5) allowedShort = false;
    if (!allowedLong || !allowedShort) {
      blockedReasons.push('SYMBOL_COOLDOWN');
    }
  }

  if (regime === 'STALE') {
    allowedLong = false;
    allowedShort = false;
    blockedReasons.push('SYMBOL_STALE');
    finalLong = 0;
    finalShort = 0;
    return { finalLong, finalShort, allowedLong, allowedShort, blockedReasons };
  }

  // ================================================================
  // 3) RISK FILTER (Stub for Phase 6)
  // ================================================================

  // In future phases, Risk Engine will provide:
  // - riskState.allowNewPositions
  // - riskState.allowNewLong
  // - riskState.allowNewShort
  // For now, all allowed by default

  // ================================================================
  // 4) SCALE ADJUSTMENTS
  // ================================================================

  // High volatility adjustment (from components)
  const volatility = parseFloat(baseScores.components.volatility);
  if (volatility < 20) {
    // Too low volatility - reduce scores
    finalLong *= 0.6;
    finalShort *= 0.6;
  }

  // High spoof adjustment (disabled - already penalized in base score)
  // const spoofPenalty = parseFloat(baseScores.components.spoofPenalty);
  // if (spoofPenalty > 60) {
  //   finalLong *= 0.5;
  //   finalShort *= 0.5;
  // }

  // High pump adjustment (disabled - already handled by regime filter)
  // const pumpPenaltyLong = parseFloat(baseScores.components.pumpPenalty.long);
  // if (pumpPenaltyLong > 50) {
  //   finalLong *= 0.7;
  // }

  // Final clamp
  finalLong = clamp(finalLong, 0, 100);
  finalShort = clamp(finalShort, 0, 100);

  // Set allowed flags based on final scores
  if (finalLong < 5) allowedLong = false;
  if (finalShort < 5) allowedShort = false;

  return {
    finalLong,
    finalShort,
    allowedLong,
    allowedShort,
    blockedReasons
  };
}

// ================================================================
// SIGNAL STATE COMPUTATION
// ================================================================

/**
 * Compute signal state based on final score
 *
 * Thresholds:
 * - score < watchThreshold → NONE
 * - watchThreshold <= score < armThreshold → WATCH
 * - score >= armThreshold → ARM
 *
 * @param {number} finalScore - Final score (0-100)
 * @param {boolean} allowed - Whether trading is allowed
 * @param {object} thresholds - { watchThreshold, armThreshold }
 * @returns {string} Signal state: "NONE" | "WATCH" | "ARM"
 */
export function computeSignalState(finalScore, allowed, thresholds) {
  const { watchThreshold = 50, armThreshold = 75 } = thresholds;

  if (!allowed || finalScore < watchThreshold) {
    return 'NONE';
  }

  if (finalScore < armThreshold) {
    return 'WATCH';
  }

  return 'ARM';
}

// ================================================================
// EXPORTS
// ================================================================

export default {
  computeBaseScores,
  applyRegimeAndRiskFilters,
  computeSignalState
};
