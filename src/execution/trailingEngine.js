// ================================================================
// src/execution/trailingEngine.js
// TRAILING ENGINE - Calculate dynamic trailing SL
// ================================================================

/**
 * Calculate new trailing SL based on current price and position state
 * @param {Object} params
 * @param {string} params.symbol
 * @param {string} params.side - "LONG" or "SHORT"
 * @param {number} params.currentPrice
 * @param {number} params.entryPrice
 * @param {number} params.currentSlPrice
 * @param {number} params.trailingDistancePct
 * @param {number} params.mfe - Max Favorable Excursion (highest price for LONG, lowest for SHORT)
 * @param {Object} params.regimeState
 * @param {Object} params.featureState
 * @returns {Object} { newSlPrice, reason, overrideApplied }
 */
export function calculateTrailingSL(params) {
  const {
    symbol,
    side,
    currentPrice,
    entryPrice,
    currentSlPrice,
    trailingDistancePct,
    mfe,
    regimeState,
    featureState
  } = params;

  // Start with base trailing distance
  let effectiveTrailingPct = trailingDistancePct;
  let overrideReason = [];

  // PUMP OVERRIDE: Tighten trailing during BLOWOFF phase
  const pumpState = regimeState?.pumpState;
  if (pumpState === 'BLOWOFF' || pumpState === 'DUMP') {
    effectiveTrailingPct *= 0.6; // Tighten to 60% of original
    overrideReason.push(`PUMP_${pumpState}`);
  }

  // SPOOFING OVERRIDE: Widen trailing if spoofing detected
  const spoofingScore = featureState?.spoofingFeatures?.spoofingScore || 0;
  if (spoofingScore > 0.6) {
    effectiveTrailingPct *= 1.3; // Widen to 130%
    overrideReason.push(`SPOOF_${spoofingScore.toFixed(2)}`);
  }

  // VOLATILITY OVERRIDE: Adjust based on volatility
  const volatilityScore = featureState?.volatilityFeatures?.volatilityScore || 0.5;
  if (volatilityScore > 0.7) {
    effectiveTrailingPct *= 1.4; // Widen significantly
    overrideReason.push(`HIGH_VOL_${volatilityScore.toFixed(2)}`);
  } else if (volatilityScore < 0.3) {
    effectiveTrailingPct *= 0.8; // Tighten slightly
    overrideReason.push(`LOW_VOL_${volatilityScore.toFixed(2)}`);
  }

  // Calculate new SL based on MFE (highest/lowest price reached)
  let newSlPrice;

  if (side === 'LONG') {
    // For LONG: SL trails below the highest price (MFE)
    newSlPrice = mfe * (1 - effectiveTrailingPct / 100);

    // SL can only move up (never down)
    if (newSlPrice <= currentSlPrice) {
      return {
        newSlPrice: currentSlPrice,
        changed: false,
        reason: 'NO_MOVE',
        effectiveTrailingPct
      };
    }

  } else { // SHORT
    // For SHORT: SL trails above the lowest price (MFE)
    newSlPrice = mfe * (1 + effectiveTrailingPct / 100);

    // SL can only move down (never up)
    if (newSlPrice >= currentSlPrice) {
      return {
        newSlPrice: currentSlPrice,
        changed: false,
        reason: 'NO_MOVE',
        effectiveTrailingPct
      };
    }
  }

  // Log trailing move
  const slMovePct = Math.abs((newSlPrice - currentSlPrice) / currentSlPrice * 100);
  console.log(`[TrailingEngine] ${symbol} ${side} SL moved: ${currentSlPrice.toFixed(6)} → ${newSlPrice.toFixed(6)} (${slMovePct.toFixed(3)}%)`);

  if (overrideReason.length > 0) {
    console.log(`[TrailingEngine] ${symbol} Overrides applied: ${overrideReason.join(', ')}`);
  }

  return {
    newSlPrice,
    changed: true,
    reason: overrideReason.length > 0 ? overrideReason.join('|') : 'TRAILING',
    effectiveTrailingPct,
    pumpOverride: pumpState === 'BLOWOFF' || pumpState === 'DUMP',
    spoofingOverride: spoofingScore > 0.6,
    volatilityOverride: volatilityScore > 0.7 || volatilityScore < 0.3
  };
}

/**
 * Check if break-even should be activated
 * @param {Object} params
 * @param {string} params.side
 * @param {number} params.entryPrice
 * @param {number} params.currentPrice
 * @param {number} params.breakEvenPrice
 * @param {number} params.unrealizedPnlPct
 * @returns {boolean}
 */
export function shouldActivateBreakEven(params) {
  const { side, entryPrice, currentPrice, breakEvenPrice, unrealizedPnlPct } = params;

  // Check if price has reached break-even level
  if (side === 'LONG') {
    return currentPrice >= breakEvenPrice && unrealizedPnlPct > 0;
  } else { // SHORT
    return currentPrice <= breakEvenPrice && unrealizedPnlPct > 0;
  }
}

/**
 * Check if TP1 is hit
 * @param {string} side
 * @param {number} currentPrice
 * @param {number} tp1Price
 * @returns {boolean}
 */
export function isTp1Hit(side, currentPrice, tp1Price) {
  if (side === 'LONG') {
    return currentPrice >= tp1Price;
  } else {
    return currentPrice <= tp1Price;
  }
}

/**
 * Check if TP2 is hit
 * @param {string} side
 * @param {number} currentPrice
 * @param {number} tp2Price
 * @returns {boolean}
 */
export function isTp2Hit(side, currentPrice, tp2Price) {
  if (side === 'LONG') {
    return currentPrice >= tp2Price;
  } else {
    return currentPrice <= tp2Price;
  }
}

/**
 * Check if SL is hit
 * @param {string} side
 * @param {number} currentPrice
 * @param {number} slPrice
 * @returns {boolean}
 */
export function isSlHit(side, currentPrice, slPrice) {
  if (side === 'LONG') {
    return currentPrice <= slPrice;
  } else {
    return currentPrice >= slPrice;
  }
}
