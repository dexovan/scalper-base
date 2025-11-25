/**
 * GLOBAL MARKET REGIME MODULE
 *
 * Determines overall market regime based on BTC/ETH behavior
 * and aggregate symbol regime statistics.
 *
 * Global Regimes:
 * - NORMAL: Safe market conditions
 * - RISK_OFF: Elevated risk, no new positions
 * - PANIC: Extreme conditions, force close positions
 *
 * Uses hysteresis to prevent rapid regime switching.
 */

import logger from '../utils/logger.js';
import { logGlobalTransition, logPanicMode } from './regimeLogger.js';

// ================================================================
// GLOBAL REGIME THRESHOLDS (with HYSTERESIS)
// ================================================================

const GLOBAL_THRESHOLDS = {
  // PANIC mode triggers - ONLY for extreme market crashes
  // Scalping NEEDS volatility - don't block on normal high vol!
  PANIC_BTC_VOL_ENTER: 999, // DISABLED - volatility is good for scalping
  PANIC_BTC_VOL_EXIT: 999,
  PANIC_ETH_VOL_ENTER: 999, // DISABLED
  PANIC_ETH_VOL_EXIT: 999,
  PANIC_BTC_DUMP_5S_PCT: -5.0, // Only on extreme 5% dumps
  PANIC_SYMBOLS_BLOCKED_PCT: 0.60, // 60% of symbols blocked (extreme)

  // RISK_OFF mode triggers - reduced sensitivity
  RISK_OFF_BTC_VOL_ENTER: 999, // DISABLED - we want volatility
  RISK_OFF_BTC_VOL_EXIT: 999,
  RISK_OFF_ETH_VOL_ENTER: 999, // DISABLED
  RISK_OFF_ETH_VOL_EXIT: 999,
  RISK_OFF_BTC_DUMP_5S_PCT: -3.0, // Only on 3% dumps
  RISK_OFF_SYMBOLS_PUMP_PCT: 0.25 // 25% of symbols in PUMP (higher tolerance)
};

// ================================================================
// GLOBAL REGIME STATE OBJECT
// ================================================================

/**
 * Create initial global regime state
 */
function createGlobalRegimeState() {
  return {
    current: 'NORMAL',
    previous: null,
    updatedAt: new Date().toISOString(),
    transitionedAt: new Date().toISOString(),

    // Market indicators
    btcVolatility: 0.0,
    ethVolatility: 0.0,
    btcPriceChange5s: 0.0,
    ethPriceChange5s: 0.0,

    // Symbol statistics
    totalSymbols: 0,
    symbolsInPump: 0,
    symbolsInManipulated: 0,
    symbolsInCooldown: 0,
    symbolsInStale: 0,
    symbolsBlocked: 0, // Total blocked from trading

    // Trading permissions
    allowNewPositions: true,
    forceClosePositions: false,

    // Risk metrics
    overallRiskLevel: 'LOW' // LOW, MEDIUM, HIGH, EXTREME
  };
}

// ================================================================
// GLOBAL REGIME DETERMINATION LOGIC
// ================================================================

/**
 * Determine global market regime
 *
 * @param {Object} btcFeatures - BTC feature state
 * @param {Object} ethFeatures - ETH feature state
 * @param {Map} allSymbolRegimes - Map of all symbol regimes
 * @param {Object} previousGlobal - Previous global regime state
 * @returns {Object} New global regime state
 */
function determineGlobalRegime(btcFeatures, ethFeatures, allSymbolRegimes, previousGlobal = null) {
  const prev = previousGlobal || createGlobalRegimeState();
  const newState = { ...prev };
  newState.updatedAt = new Date().toISOString();

  // Extract BTC/ETH metrics
  const btcVol = btcFeatures?.volatility?.volatilityScore || 0;
  const ethVol = ethFeatures?.volatility?.volatilityScore || 0;
  const btcPriceChange = btcFeatures?.pumpSignals?.priceChange5sPct || 0;
  const ethPriceChange = ethFeatures?.pumpSignals?.priceChange5sPct || 0;

  newState.btcVolatility = btcVol;
  newState.ethVolatility = ethVol;
  newState.btcPriceChange5s = btcPriceChange;
  newState.ethPriceChange5s = ethPriceChange;

  // Calculate symbol regime statistics
  const stats = calculateSymbolStats(allSymbolRegimes);
  newState.totalSymbols = stats.total;
  newState.symbolsInPump = stats.pump;
  newState.symbolsInManipulated = stats.manipulated;
  newState.symbolsInCooldown = stats.cooldown;
  newState.symbolsInStale = stats.stale;
  newState.symbolsBlocked = stats.blocked;

  // Calculate percentages
  const blockedPct = stats.total > 0 ? stats.blocked / stats.total : 0;
  const pumpPct = stats.total > 0 ? stats.pump / stats.total : 0;

  // ================================================================
  // CHECK FOR PANIC MODE
  // ================================================================

  const panicConditions = [
    btcVol >= GLOBAL_THRESHOLDS.PANIC_BTC_VOL_ENTER,
    ethVol >= GLOBAL_THRESHOLDS.PANIC_ETH_VOL_ENTER,
    btcPriceChange <= GLOBAL_THRESHOLDS.PANIC_BTC_DUMP_5S_PCT,
    blockedPct >= GLOBAL_THRESHOLDS.PANIC_SYMBOLS_BLOCKED_PCT
  ];

  const panicTriggered = panicConditions.some(c => c);

  if (prev.current === 'PANIC') {
    // Currently in PANIC - check exit conditions (all must be false)
    const panicExitConditions = [
      btcVol >= GLOBAL_THRESHOLDS.PANIC_BTC_VOL_EXIT,
      ethVol >= GLOBAL_THRESHOLDS.PANIC_ETH_VOL_EXIT,
      btcPriceChange <= GLOBAL_THRESHOLDS.PANIC_BTC_DUMP_5S_PCT,
      blockedPct >= GLOBAL_THRESHOLDS.PANIC_SYMBOLS_BLOCKED_PCT
    ];

    const stillInPanic = panicExitConditions.some(c => c);

    if (!stillInPanic) {
      // Exit PANIC
      logger.warn(`[GLOBAL REGIME] PANIC → NORMAL (btcVol: ${btcVol.toFixed(3)}, blockedSymbols: ${(blockedPct * 100).toFixed(1)}%)`);
      logGlobalTransition('PANIC', 'NORMAL', { btcVolatility: btcVol, ethVolatility: ethVol, btcPriceChange5s: btcPriceChange, blockedPct });
      newState.current = 'NORMAL';
      newState.previous = 'PANIC';
      newState.transitionedAt = new Date().toISOString();
      newState.allowNewPositions = true;
      newState.forceClosePositions = false;
      newState.overallRiskLevel = 'MEDIUM';
    } else {
      // Stay in PANIC
      newState.current = 'PANIC';
      newState.allowNewPositions = false;
      newState.forceClosePositions = true;
      newState.overallRiskLevel = 'EXTREME';
    }
    return newState;
  } else if (panicTriggered) {
    // Enter PANIC mode
    const reasons = [];
    if (btcVol >= GLOBAL_THRESHOLDS.PANIC_BTC_VOL_ENTER) reasons.push(`BTC vol: ${btcVol.toFixed(3)}`);
    if (ethVol >= GLOBAL_THRESHOLDS.PANIC_ETH_VOL_ENTER) reasons.push(`ETH vol: ${ethVol.toFixed(3)}`);
    if (btcPriceChange <= GLOBAL_THRESHOLDS.PANIC_BTC_DUMP_5S_PCT) reasons.push(`BTC dump: ${btcPriceChange.toFixed(2)}%`);
    if (blockedPct >= GLOBAL_THRESHOLDS.PANIC_SYMBOLS_BLOCKED_PCT) reasons.push(`blocked: ${(blockedPct * 100).toFixed(1)}%`);

    logger.error(`[GLOBAL REGIME] ${prev.current} → PANIC (${reasons.join(', ')})`);
    logPanicMode({ btcVolatility: btcVol, ethVolatility: ethVol, btcPriceChange5s: btcPriceChange, blockedPct, totalSymbols: stats.total, symbolsBlocked: stats.blocked }, reasons);
    newState.current = 'PANIC';
    newState.previous = prev.current;
    newState.transitionedAt = new Date().toISOString();
    newState.allowNewPositions = false;
    newState.forceClosePositions = true;
    newState.overallRiskLevel = 'EXTREME';
    return newState;
  }

  // ================================================================
  // CHECK FOR RISK_OFF MODE
  // ================================================================

  const riskOffConditions = [
    btcVol >= GLOBAL_THRESHOLDS.RISK_OFF_BTC_VOL_ENTER,
    ethVol >= GLOBAL_THRESHOLDS.RISK_OFF_ETH_VOL_ENTER,
    btcPriceChange <= GLOBAL_THRESHOLDS.RISK_OFF_BTC_DUMP_5S_PCT,
    pumpPct >= GLOBAL_THRESHOLDS.RISK_OFF_SYMBOLS_PUMP_PCT
  ];

  const riskOffTriggered = riskOffConditions.some(c => c);

  if (prev.current === 'RISK_OFF') {
    // Currently in RISK_OFF - check exit conditions
    const riskOffExitConditions = [
      btcVol >= GLOBAL_THRESHOLDS.RISK_OFF_BTC_VOL_EXIT,
      ethVol >= GLOBAL_THRESHOLDS.RISK_OFF_ETH_VOL_EXIT,
      btcPriceChange <= GLOBAL_THRESHOLDS.RISK_OFF_BTC_DUMP_5S_PCT,
      pumpPct >= GLOBAL_THRESHOLDS.RISK_OFF_SYMBOLS_PUMP_PCT
    ];

    const stillInRiskOff = riskOffExitConditions.some(c => c);

    if (!stillInRiskOff) {
      // Exit RISK_OFF
      logger.warn(`[GLOBAL REGIME] RISK_OFF → NORMAL (btcVol: ${btcVol.toFixed(3)}, pumpSymbols: ${(pumpPct * 100).toFixed(1)}%)`);
      logGlobalTransition('RISK_OFF', 'NORMAL', { btcVolatility: btcVol, ethVolatility: ethVol, btcPriceChange5s: btcPriceChange, blockedPct });
      newState.current = 'NORMAL';
      newState.previous = 'RISK_OFF';
      newState.transitionedAt = new Date().toISOString();
      newState.allowNewPositions = true;
      newState.forceClosePositions = false;
      newState.overallRiskLevel = 'LOW';
    } else {
      // Stay in RISK_OFF
      newState.current = 'RISK_OFF';
      newState.allowNewPositions = false;
      newState.forceClosePositions = false;
      newState.overallRiskLevel = 'HIGH';
    }
    return newState;
  } else if (riskOffTriggered) {
    // Enter RISK_OFF mode
    const reasons = [];
    if (btcVol >= GLOBAL_THRESHOLDS.RISK_OFF_BTC_VOL_ENTER) reasons.push(`BTC vol: ${btcVol.toFixed(3)}`);
    if (ethVol >= GLOBAL_THRESHOLDS.RISK_OFF_ETH_VOL_ENTER) reasons.push(`ETH vol: ${ethVol.toFixed(3)}`);
    if (btcPriceChange <= GLOBAL_THRESHOLDS.RISK_OFF_BTC_DUMP_5S_PCT) reasons.push(`BTC dump: ${btcPriceChange.toFixed(2)}%`);
    if (pumpPct >= GLOBAL_THRESHOLDS.RISK_OFF_SYMBOLS_PUMP_PCT) reasons.push(`pumps: ${(pumpPct * 100).toFixed(1)}%`);

    logger.warn(`[GLOBAL REGIME] ${prev.current} → RISK_OFF (${reasons.join(', ')})`);
    logGlobalTransition(prev.current, 'RISK_OFF', { btcVolatility: btcVol, ethVolatility: ethVol, btcPriceChange5s: btcPriceChange, blockedPct });
    newState.current = 'RISK_OFF';
    newState.previous = prev.current;
    newState.transitionedAt = new Date().toISOString();
    newState.allowNewPositions = false;
    newState.forceClosePositions = false;
    newState.overallRiskLevel = 'HIGH';
    return newState;
  }

  // ================================================================
  // DEFAULT: NORMAL MODE
  // ================================================================

  if (prev.current !== 'NORMAL') {
    logger.info(`[GLOBAL REGIME] ${prev.current} → NORMAL`);
    logGlobalTransition(prev.current, 'NORMAL', { btcVolatility: btcVol, ethVolatility: ethVol, btcPriceChange5s: btcPriceChange, blockedPct });
    newState.previous = prev.current;
    newState.transitionedAt = new Date().toISOString();
  }

  newState.current = 'NORMAL';
  newState.allowNewPositions = true;
  newState.forceClosePositions = false;
  newState.overallRiskLevel = 'LOW';

  return newState;
}

// ================================================================
// HELPER FUNCTIONS
// ================================================================

/**
 * Calculate statistics from all symbol regimes
 */
function calculateSymbolStats(allSymbolRegimes) {
  const stats = {
    total: 0,
    pump: 0,
    manipulated: 0,
    cooldown: 0,
    stale: 0,
    normal: 0,
    blocked: 0 // Total blocked from trading
  };

  if (!allSymbolRegimes || allSymbolRegimes.size === 0) {
    return stats;
  }

  for (const [symbol, regime] of allSymbolRegimes) {
    stats.total++;

    switch (regime.current) {
      case 'PUMP':
        stats.pump++;
        stats.blocked++;
        break;
      case 'MANIPULATED':
        stats.manipulated++;
        stats.blocked++;
        break;
      case 'COOLDOWN':
        stats.cooldown++;
        stats.blocked++;
        break;
      case 'STALE':
        stats.stale++;
        stats.blocked++;
        break;
      case 'NEWS_DRIVEN':
        stats.blocked++;
        break;
      case 'NORMAL':
        stats.normal++;
        break;
    }
  }

  return stats;
}

// ================================================================
// EXPORTS
// ================================================================

export {
  GLOBAL_THRESHOLDS,
  createGlobalRegimeState,
  determineGlobalRegime,
  calculateSymbolStats
};

export default {
  GLOBAL_THRESHOLDS,
  createGlobalRegimeState,
  determineGlobalRegime,
  calculateSymbolStats
};
