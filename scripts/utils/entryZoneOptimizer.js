// ============================================================
// ENTRY ZONE OPTIMIZER (DEO)
// Converts single-point entry into realistic execution zone
// ============================================================

import { formatPriceByTick } from "./priceFormatter.js";

/**
 * Entry Zone Configuration
 * Balanced mode (0.04%) - optimal for micro-scalping
 */
const ENTRY_ZONE_CONFIG = {
  // Zone flexibility (how far from ideal entry we allow)
  flexibilityPercent: 0.04,  // 0.04% = balanced (optimal for 0.22% TP)

  // Entry timeout (how long to wait before adjusting zone)
  timeoutMs: 45000,  // 45 seconds max wait

  // Re-evaluation interval (how often to check if entry is reachable)
  recheckIntervalMs: 2000,  // 2 seconds (synced with Fast Track)

  // Zone adjustment (if price moves away, how much to adjust)
  adjustmentPercent: 0.03,  // 0.03% nudge toward market price

  // Maximum adjustments before giving up
  maxAdjustments: 2  // Allow 2 nudges max (0.06% total flexibility)
};

/**
 * Calculate dynamic entry zone for a signal
 * @param {string} direction - 'LONG' or 'SHORT'
 * @param {number} bid - Current best bid
 * @param {number} ask - Current best ask
 * @param {number} price - Current market price
 * @param {number} tickSize - Symbol-specific tick size for Bybit precision
 * @returns {object} Entry zone with min/max/ideal
 */
export function calculateEntryZone(direction, bid, ask, price, tickSize) {
  const flex = ENTRY_ZONE_CONFIG.flexibilityPercent / 100;

  if (direction === 'LONG') {
    // LONG: Enter at ask or slightly above
    const ideal = ask;
    const min = bid;  // Can enter at bid (better price)
    const max = ask * (1 + flex);  // Allow 0.04% above ask

    // Apply Bybit tickSize precision
    const idealT = parseFloat(formatPriceByTick(ideal, tickSize));
    const minT = parseFloat(formatPriceByTick(min, tickSize));
    const maxT = parseFloat(formatPriceByTick(max, tickSize));

    return {
      ideal: idealT,
      min: minT,
      max: maxT,
      midpoint: (minT + maxT) / 2,
      range: maxT - minT,
      rangePercent: ((maxT - minT) / idealT) * 100,
      tickSize
    };
  } else {
    // SHORT: Enter at bid or slightly below
    const ideal = bid;
    const min = bid * (1 - flex);  // Allow 0.04% below bid
    const max = ask;  // Can enter at ask (better price for short)

    // Apply Bybit tickSize precision
    const idealT = parseFloat(formatPriceByTick(ideal, tickSize));
    const minT = parseFloat(formatPriceByTick(min, tickSize));
    const maxT = parseFloat(formatPriceByTick(max, tickSize));

    return {
      ideal: idealT,
      min: minT,
      max: maxT,
      midpoint: (minT + maxT) / 2,
      range: maxT - minT,
      rangePercent: ((maxT - minT) / idealT) * 100,
      tickSize
    };
  }
}

/**
 * Check if current price is within entry zone
 * @param {number} currentPrice - Current market price
 * @param {object} entryZone - Entry zone from calculateEntryZone()
 * @returns {boolean} True if price is in zone
 */
export function isPriceInEntryZone(currentPrice, entryZone) {
  return currentPrice >= entryZone.min && currentPrice <= entryZone.max;
}

/**
 * Calculate distance from price to entry zone (for monitoring)
 * @param {number} currentPrice - Current market price
 * @param {object} entryZone - Entry zone
 * @returns {object} Distance info
 */
export function getDistanceToEntryZone(currentPrice, entryZone) {
  if (isPriceInEntryZone(currentPrice, entryZone)) {
    return {
      inZone: true,
      distancePercent: 0,
      direction: 'IN_ZONE'
    };
  }

  // Price above zone
  if (currentPrice > entryZone.max) {
    const distance = currentPrice - entryZone.max;
    const distancePercent = (distance / entryZone.ideal) * 100;
    return {
      inZone: false,
      distancePercent,
      direction: 'ABOVE',
      distance
    };
  }

  // Price below zone
  const distance = entryZone.min - currentPrice;
  const distancePercent = (distance / entryZone.ideal) * 100;
  return {
    inZone: false,
    distancePercent,
    direction: 'BELOW',
    distance
  };
}

/**
 * Adjust entry zone toward market price (when timeout approaching)
 * @param {object} entryZone - Current entry zone
 * @param {number} currentPrice - Current market price
 * @param {string} direction - 'LONG' or 'SHORT'
 * @returns {object} Adjusted entry zone
 */
export function adjustEntryZoneTowardMarket(entryZone, currentPrice, direction) {
  const adjustment = ENTRY_ZONE_CONFIG.adjustmentPercent / 100;

  if (direction === 'LONG') {
    // Move zone up toward market
    const newIdeal = entryZone.ideal * (1 + adjustment);
    const newMax = entryZone.max * (1 + adjustment);

    // Apply Bybit tickSize precision
    const newIdealT = parseFloat(formatPriceByTick(newIdeal, entryZone.tickSize));
    const newMaxT = parseFloat(formatPriceByTick(newMax, entryZone.tickSize));

    return {
      ...entryZone,
      ideal: newIdealT,
      max: newMaxT,
      midpoint: (entryZone.min + newMaxT) / 2,
      adjusted: true,
      adjustmentCount: (entryZone.adjustmentCount || 0) + 1
    };
  } else {
    // Move zone down toward market
    const newIdeal = entryZone.ideal * (1 - adjustment);
    const newMin = entryZone.min * (1 - adjustment);

    // Apply Bybit tickSize precision
    const newIdealT = parseFloat(formatPriceByTick(newIdeal, entryZone.tickSize));
    const newMinT = parseFloat(formatPriceByTick(newMin, entryZone.tickSize));

    return {
      ...entryZone,
      ideal: newIdealT,
      min: newMinT,
      midpoint: (newMinT + entryZone.max) / 2,
      adjusted: true,
      adjustmentCount: (entryZone.adjustmentCount || 0) + 1
    };
  }
}

/**
 * Determine if signal should be invalidated (price moved too far)
 * @param {number} currentPrice - Current market price
 * @param {object} entryZone - Entry zone
 * @param {number} elapsedMs - Time since signal generated
 * @returns {boolean} True if signal should be killed
 */
export function shouldInvalidateSignal(currentPrice, entryZone, elapsedMs) {
  // Apply Bybit tickSize precision to current price
  currentPrice = parseFloat(formatPriceByTick(currentPrice, entryZone.tickSize));

  const distanceInfo = getDistanceToEntryZone(currentPrice, entryZone);

  // If price moved >0.2% away and timeout reached → kill signal
  if (elapsedMs >= ENTRY_ZONE_CONFIG.timeoutMs && distanceInfo.distancePercent > 0.2) {
    return true;
  }

  // If price moved >0.5% away anytime → kill signal immediately
  if (distanceInfo.distancePercent > 0.5) {
    return true;
  }

  // If too many adjustments made → kill signal
  if ((entryZone.adjustmentCount || 0) >= ENTRY_ZONE_CONFIG.maxAdjustments) {
    return true;
  }

  return false;
}

/**
 * Get entry zone statistics for logging
 * @param {object} entryZone - Entry zone
 * @returns {string} Human-readable zone info
 */
export function getEntryZoneDisplay(entryZone) {
  return `[${formatPriceByTick(entryZone.min, entryZone.tickSize)} — ${formatPriceByTick(entryZone.ideal, entryZone.tickSize)} — ${formatPriceByTick(entryZone.max, entryZone.tickSize)}] (±${entryZone.rangePercent.toFixed(3)}%)`;
}

export const CONFIG = ENTRY_ZONE_CONFIG;
