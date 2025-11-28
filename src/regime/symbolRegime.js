/**
 * SYMBOL REGIME MODULE
 *
 * Determines per-symbol market regime based on feature analysis.
 * Uses hysteresis to prevent flickering between regimes.
 *
 * Regime Priority (strongest to weakest):
 * 1. STALE - No data updates
 * 2. NEWS_DRIVEN - High impact news (future: NewsEngine integration)
 * 3. MANIPULATED - Spoofing detected
 * 4. PUMP - Price pumping detected
 * 5. COOLDOWN - Post-explosion cooldown period
 * 6. NORMAL - Safe for trading
 */

import logger from '../utils/logger.js';
import { logSymbolTransition, logCooldownStart, logStaleSymbol } from './regimeLogger.js';

// ================================================================
// REGIME THRESHOLDS (with HYSTERESIS)
// ================================================================

const THRESHOLDS = {
  // Pump detection (enter higher than exit to prevent flicker)
  PUMP_ENTER: 0.70,
  PUMP_EXIT: 0.60,
  PUMP_PRICE_CHANGE_PCT: 6.0, // Instant pump if 5s change > 6%

  // Spoofing detection
  SPOOF_ENTER: 0.72,
  SPOOF_EXIT: 0.65,

  // News impact (future feature)
  NEWS_ENTER: 80,
  NEWS_EXIT: 65,
  NEWS_GRACE_PERIOD_MS: 5000, // 5s grace after news exits

  // Cooldown period after volatility explosion
  COOLDOWN_MS: 12000, // 12 seconds

  // Staleness detection
  STALE_ORDERBOOK_MS: 2000,
  STALE_TRADES_MS: 2000,
  STALE_FEATURES_MS: 3000,

  // Grace period for new symbols (allow orderbook to arrive before marking STALE)
  INIT_GRACE_PERIOD_MS: 5000 // 5 seconds to collect first orderbook snapshot
};

// ================================================================
// REGIME STATE OBJECT
// ================================================================

/**
 * Create initial regime state for a symbol
 */
function createRegimeState(symbol) {
  return {
    symbol,
    current: 'NORMAL',
    previous: null,
    updatedAt: new Date().toISOString(),
    transitionedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(), // NEW: Track when symbol was initialized

    // Feature scores
    pumpStrength: 0.0,
    spoofingLevel: 0.0,
    volatilityScore: 0.0,
    newsImpactScore: 0, // Future: NewsEngine integration

    // Cooldown state
    cooldownActive: false,
    cooldownEndsAt: null,
    cooldownReason: null,

    // News state (future)
    newsGracePeriodEndsAt: null,

    // Trading permission
    allowLong: true,
    allowShort: true
  };
}

// ================================================================
// REGIME DETERMINATION LOGIC
// ================================================================

/**
 * Determine symbol regime based on features and previous state
 *
 * @param {string} symbol - Symbol name
 * @param {Object} featureState - Feature engine state
 * @param {Object} symbolHealth - Symbol health from OrderbookManager
 * @param {Object} previousRegime - Previous regime state
 * @returns {Object} New regime state
 */
function determineSymbolRegime(symbol, featureState, symbolHealth, previousRegime = null) {
  const now = Date.now();
  const prev = previousRegime || createRegimeState(symbol);

  // Create new state (copy previous)
  const newState = { ...prev };
  newState.updatedAt = new Date().toISOString();

  // Extract feature scores
  const pumpScore = featureState?.pumpSignals?.pumpLikelihoodScore || 0;
  const spoofScore = featureState?.walls?.spoofingScore || 0;
  const volatilityScore = featureState?.volatility?.volatilityScore || 0;
  const explosionFlag = featureState?.volatility?.explosionFlag || false;
  const priceChange5s = featureState?.pumpSignals?.priceChange5sPct || 0;

  // Update scores in state
  newState.pumpStrength = pumpScore;
  newState.spoofingLevel = spoofScore;
  newState.volatilityScore = volatilityScore;

  // ================================================================
  // PRIORITY 1: STALE (no data updates)
  // ================================================================

  // Skip STALE check during initialization grace period (allow orderbook to arrive)
  const initGraceEndsAt = new Date(newState.createdAt).getTime() + THRESHOLDS.INIT_GRACE_PERIOD_MS;
  const isInGracePeriod = now < initGraceEndsAt;

  if (symbolHealth && !symbolHealth.isActive && !isInGracePeriod) {
    if (prev.current !== 'STALE') {
      logger.info(`[REGIME] ${symbol}: ${prev.current} → STALE (staleness: ${symbolHealth.staleness})`);
      logStaleSymbol(symbol, symbolHealth.timeSinceLastTick);
      newState.previous = prev.current;
      newState.transitionedAt = new Date().toISOString();
    }
    newState.current = 'STALE';
    newState.allowLong = false;
    newState.allowShort = false;
    return newState;
  }

  // ================================================================
  // PRIORITY 2: NEWS_DRIVEN (future feature - placeholder)
  // ================================================================

  // Check if in news grace period
  if (prev.newsGracePeriodEndsAt && now < new Date(prev.newsGracePeriodEndsAt).getTime()) {
    newState.current = 'NEWS_DRIVEN';
    newState.allowLong = false;
    newState.allowShort = false;
    return newState;
  }

  // Future: Check newsImpactScore when NewsEngine is implemented
  // if (newsImpactScore >= THRESHOLDS.NEWS_ENTER) { ... }

  // ================================================================
  // PRIORITY 3: MANIPULATED (spoofing detected)
  // ================================================================

  // Use hysteresis
  if (prev.current === 'MANIPULATED') {
    // Currently in MANIPULATED - check exit threshold
    if (spoofScore < THRESHOLDS.SPOOF_EXIT) {
      // Exit MANIPULATED → go to NORMAL (no cooldown for spoof)
      logger.info(`[REGIME] ${symbol}: MANIPULATED → NORMAL (spoofScore: ${spoofScore.toFixed(3)})`);
      logSymbolTransition(symbol, 'MANIPULATED', 'NORMAL', { pumpScore, spoofScore, volatilityScore });
      newState.current = 'NORMAL';
      newState.previous = 'MANIPULATED';
      newState.transitionedAt = new Date().toISOString();
      newState.allowLong = true;
      newState.allowShort = true;
    } else {
      // Stay in MANIPULATED
      newState.current = 'MANIPULATED';
      newState.allowLong = false;
      newState.allowShort = false;
    }
    return newState;
  } else {
    // Not in MANIPULATED - check enter threshold
    if (spoofScore >= THRESHOLDS.SPOOF_ENTER) {
      logger.info(`[REGIME] ${symbol}: ${prev.current} → MANIPULATED (spoofScore: ${spoofScore.toFixed(3)})`);
      logSymbolTransition(symbol, prev.current, 'MANIPULATED', { pumpScore, spoofScore, volatilityScore });
      newState.current = 'MANIPULATED';
      newState.previous = prev.current;
      newState.transitionedAt = new Date().toISOString();
      newState.allowLong = false;
      newState.allowShort = false;
      return newState;
    }
  }

  // ================================================================
  // PRIORITY 4: PUMP (price pumping)
  // ================================================================

  // Check for instant pump (6% 5s change)
  const instantPump = Math.abs(priceChange5s) > THRESHOLDS.PUMP_PRICE_CHANGE_PCT;

  // Use hysteresis
  if (prev.current === 'PUMP') {
    // Currently in PUMP - check exit threshold
    if (pumpScore < THRESHOLDS.PUMP_EXIT && !instantPump) {
      // Exit PUMP → MUST go to COOLDOWN
      logger.info(`[REGIME] ${symbol}: PUMP → COOLDOWN (pumpScore: ${pumpScore.toFixed(3)})`);
      logSymbolTransition(symbol, 'PUMP', 'COOLDOWN', { pumpScore, spoofScore, volatilityScore });
      logCooldownStart(symbol, THRESHOLDS.COOLDOWN_MS, 'PUMP');
      newState.current = 'COOLDOWN';
      newState.previous = 'PUMP';
      newState.transitionedAt = new Date().toISOString();
      newState.cooldownActive = true;
      newState.cooldownEndsAt = new Date(now + THRESHOLDS.COOLDOWN_MS).toISOString();
      newState.cooldownReason = 'Post-PUMP cooldown';
      newState.allowLong = false;
      newState.allowShort = false;
    } else {
      // Stay in PUMP
      newState.current = 'PUMP';
      newState.allowLong = false; // No LONG in pump
      newState.allowShort = true; // SHORT allowed (risky)
    }
    return newState;
  } else {
    // Not in PUMP - check enter threshold
    if (pumpScore >= THRESHOLDS.PUMP_ENTER || instantPump) {
      const reason = instantPump ? `priceChange5s: ${priceChange5s.toFixed(2)}%` : `pumpScore: ${pumpScore.toFixed(3)}`;
      logger.info(`[REGIME] ${symbol}: ${prev.current} → PUMP (${reason})`);
      logSymbolTransition(symbol, prev.current, 'PUMP', { pumpScore, spoofScore, volatilityScore });
      newState.current = 'PUMP';
      newState.previous = prev.current;
      newState.transitionedAt = new Date().toISOString();
      newState.allowLong = false;
      newState.allowShort = true;
      return newState;
    }
  }

  // ================================================================
  // PRIORITY 5: COOLDOWN (post-explosion or post-pump)
  // ================================================================

  if (prev.cooldownActive) {
    const cooldownEnds = new Date(prev.cooldownEndsAt).getTime();

    if (now < cooldownEnds) {
      // Still in cooldown
      newState.current = 'COOLDOWN';
      newState.cooldownActive = true;
      newState.allowLong = false;
      newState.allowShort = false;
      return newState;
    } else {
      // Cooldown expired → NORMAL
      logger.info(`[REGIME] ${symbol}: COOLDOWN → NORMAL (cooldown expired)`);
      logSymbolTransition(symbol, 'COOLDOWN', 'NORMAL', { pumpScore, spoofScore, volatilityScore });
      newState.current = 'NORMAL';
      newState.previous = 'COOLDOWN';
      newState.transitionedAt = new Date().toISOString();
      newState.cooldownActive = false;
      newState.cooldownEndsAt = null;
      newState.cooldownReason = null;
      newState.allowLong = true;
      newState.allowShort = true;
      return newState;
    }
  }

  // DISABLED: Volatility explosion COOLDOWN
  // For scalping strategy, volatility explosions are OPPORTUNITIES, not risks!
  // We WANT to trade during high volatility - that's when spreads are profitable
  // COOLDOWN only happens after PUMP detection (manipulation), not natural volatility

  // if (explosionFlag && prev.current !== 'COOLDOWN' && prev.current !== 'PUMP') {
  //   logger.info(`[REGIME] ${symbol}: ${prev.current} → COOLDOWN (volatility explosion)`);
  //   logSymbolTransition(symbol, prev.current, 'COOLDOWN', { pumpScore, spoofScore, volatilityScore });
  //   logCooldownStart(symbol, THRESHOLDS.COOLDOWN_MS, prev.current);
  //   newState.current = 'COOLDOWN';
  //   newState.previous = prev.current;
  //   newState.transitionedAt = new Date().toISOString();
  //   newState.cooldownActive = true;
  //   newState.cooldownEndsAt = new Date(now + THRESHOLDS.COOLDOWN_MS).toISOString();
  //   newState.cooldownReason = 'Volatility explosion';
  //   newState.allowLong = false;
  //   newState.allowShort = false;
  //   return newState;
  // }

  // ================================================================
  // PRIORITY 6: NORMAL (default safe state)
  // ================================================================

  if (prev.current !== 'NORMAL') {
    logger.info(`[REGIME] ${symbol}: ${prev.current} → NORMAL`);
    newState.previous = prev.current;
    newState.transitionedAt = new Date().toISOString();
  }

  newState.current = 'NORMAL';
  newState.allowLong = true;
  newState.allowShort = true;

  return newState;
}

// ================================================================
// TRADING PERMISSION CHECK
// ================================================================

/**
 * Check if trading is allowed for a symbol
 *
 * @param {Object} regimeState - Symbol regime state
 * @param {string} side - "LONG" or "SHORT"
 * @returns {boolean} True if trading allowed
 */
function isAllowedToTrade(regimeState, side = 'LONG') {
  if (!regimeState) return false;

  if (side === 'LONG') {
    return regimeState.allowLong;
  } else if (side === 'SHORT') {
    return regimeState.allowShort;
  }

  return false;
}

// ================================================================
// EXPORTS
// ================================================================

export {
  THRESHOLDS,
  createRegimeState,
  determineSymbolRegime,
  isAllowedToTrade
};

export default {
  THRESHOLDS,
  createRegimeState,
  determineSymbolRegime,
  isAllowedToTrade
};
