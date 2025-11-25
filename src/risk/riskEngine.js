// ================================================================
// src/risk/riskEngine.js
// RISK ENGINE - Main orchestrator for risk management
// ================================================================

import * as accountState from './accountState.js';
import * as positionTracker from './positionTracker.js';

/**
 * Risk configuration
 */
const DEFAULT_CONFIG = {
  maxRiskPerTradePct: 1.0,          // Max 1% risk per trade
  maxPortfolioHeatPct: 6.0,         // Max 6% total portfolio heat
  maxDailyLossPct: 5.0,             // Max 5% daily loss
  maxOpenPositions: 5,              // Max number of open positions
  maxOpenPositionsPerSymbol: 1,     // Max positions per symbol
  allowNewLongIfHeatBelowPct: 4.0,  // Allow new longs if heat < 4%
  allowNewShortIfHeatBelowPct: 4.0, // Allow new shorts if heat < 4%
  dailyResetTimeUtc: "00:00"        // Daily reset time
};

/**
 * Daily risk statistics
 * @typedef {Object} DailyRiskStats
 * @property {string} dateKey - Date in YYYY-MM-DD format
 * @property {number} dayRealizedPnl - Realized PnL today
 * @property {number} dayRealizedPnlPct - Realized PnL as %
 * @property {number} dayMaxDrawdown - Max drawdown today
 * @property {number} dayMaxDrawdownPct - Max drawdown as %
 * @property {number} tradesCount - Number of trades today
 * @property {number} winningTradesCount - Winning trades
 * @property {number} losingTradesCount - Losing trades
 * @property {string} synchronizedAt - Last sync timestamp
 */

/**
 * Risk flags
 * @typedef {Object} RiskFlags
 * @property {number} portfolioHeatPct - Current portfolio heat %
 * @property {number} projectedHeatPctIfNewTrade - Heat if new trade opened
 * @property {boolean} nearDailyLossLimit - Within 80% of daily loss limit
 * @property {boolean} dailyLossLimitHit - Daily loss limit exceeded
 * @property {boolean} riskAllowNewPositions - Allow opening new positions
 * @property {boolean} riskAllowNewLong - Allow new long positions
 * @property {boolean} riskAllowNewShort - Allow new short positions
 * @property {boolean} riskForceCloseAll - Emergency: close all positions
 */

// Internal state
let config = { ...DEFAULT_CONFIG };
let dailyStats = null;
let riskFlags = null;
let lastRiskSnapshot = null;
let dailyResetTimer = null;

/**
 * Initialize Risk Engine
 * @param {Object} customConfig - Custom risk configuration
 * @param {string} accountMode - Account mode (SIM/DRY_RUN/LIVE)
 * @param {number} initialEquity - Starting equity
 */
export function initRiskEngine(customConfig = {}, accountMode = "SIM", initialEquity = 10000) {
  console.log("[RiskEngine] Initializing...");

  // Merge config
  config = { ...DEFAULT_CONFIG, ...customConfig };
  console.log("[RiskEngine] Config:", config);

  // Initialize account state
  accountState.initAccountState(accountMode, initialEquity);

  // Initialize position tracker
  positionTracker.initPositionTracker();

  // Initialize daily stats
  resetDailyStatsInternal();

  // Initialize risk flags
  riskFlags = createDefaultRiskFlags();

  // Calculate initial risk state
  recalcRiskState();

  // Schedule daily reset
  scheduleDailyReset();

  console.log("[RiskEngine] Initialized successfully");
}

/**
 * Create default risk flags
 * @returns {RiskFlags}
 */
function createDefaultRiskFlags() {
  return {
    portfolioHeatPct: 0,
    projectedHeatPctIfNewTrade: 0,
    nearDailyLossLimit: false,
    dailyLossLimitHit: false,
    riskAllowNewPositions: true,
    riskAllowNewLong: true,
    riskAllowNewShort: true,
    riskForceCloseAll: false
  };
}

/**
 * Reset daily statistics
 */
function resetDailyStatsInternal() {
  const dateKey = new Date().toISOString().split('T')[0];

  dailyStats = {
    dateKey,
    dayRealizedPnl: 0,
    dayRealizedPnlPct: 0,
    dayMaxDrawdown: 0,
    dayMaxDrawdownPct: 0,
    tradesCount: 0,
    winningTradesCount: 0,
    losingTradesCount: 0,
    synchronizedAt: new Date().toISOString()
  };

  console.log(`[RiskEngine] Daily stats reset for ${dateKey}`);
}

/**
 * Schedule daily reset at configured time
 */
function scheduleDailyReset() {
  // Clear existing timer
  if (dailyResetTimer) {
    clearInterval(dailyResetTimer);
  }

  // Check every minute if we need to reset
  dailyResetTimer = setInterval(() => {
    const now = new Date();
    const currentDateKey = now.toISOString().split('T')[0];

    // If date changed, reset
    if (dailyStats && dailyStats.dateKey !== currentDateKey) {
      console.log("[RiskEngine] Date changed - performing daily reset");
      onDailyReset();
    }
  }, 60 * 1000); // Check every minute
}

/**
 * Handle daily reset
 */
export function onDailyReset() {
  console.log("[RiskEngine] Performing daily reset...");

  // Reset account daily stats
  accountState.resetDailyStats();

  // Reset daily risk stats
  resetDailyStatsInternal();

  // Recalculate risk
  recalcRiskState();

  console.log("[RiskEngine] Daily reset completed");
}

/**
 * Handle position event (open/close/modify)
 * @param {Object} event - Position event
 */
export function onPositionEvent(event) {
  const { type } = event;

  try {
    if (type === "POSITION_OPENED") {
      positionTracker.onNewPositionOpened(event);
      dailyStats.tradesCount++;
    } else if (type === "POSITION_CLOSED") {
      const result = positionTracker.onPositionClosed(event);

      if (result) {
        // Record realized PnL
        accountState.recordRealizedPnl(result.realizedPnl);
        dailyStats.dayRealizedPnl += result.realizedPnl;

        // Track win/loss
        if (result.realizedPnl > 0) {
          dailyStats.winningTradesCount++;
        } else if (result.realizedPnl < 0) {
          dailyStats.losingTradesCount++;
        }
      }
    }

    // Update account from positions
    const allPositions = positionTracker.getAllPositions(true);
    accountState.updateAccountFromPositions(new Map(
      allPositions.map(p => [`${p.symbol}_${p.side}`, p])
    ));

    // Recalculate risk state
    recalcRiskState();

  } catch (error) {
    console.error("[RiskEngine] Error handling position event:", error);
  }
}

/**
 * Handle price tick for symbol (updates unrealized PnL)
 * @param {string} symbol
 * @param {number} price
 */
export function onPriceTickForSymbol(symbol, price) {
  // Update both LONG and SHORT positions if they exist
  positionTracker.onPositionPriceUpdate(symbol, "LONG", price);
  positionTracker.onPositionPriceUpdate(symbol, "SHORT", price);

  // Update account (throttled - only 1% of ticks)
  if (Math.random() < 0.01) {
    const allPositions = positionTracker.getAllPositions(true);
    accountState.updateAccountFromPositions(new Map(
      allPositions.map(p => [`${p.symbol}_${p.side}`, p])
    ));

    // Recalc risk (throttled)
    recalcRiskState();
  }
}

/**
 * Recalculate risk state and update flags
 */
export function recalcRiskState() {
  const account = accountState.getAccountState();
  if (!account) return;

  const portfolio = positionTracker.getPortfolioSummary();

  // Calculate portfolio heat %
  const portfolioHeatPct = account.equityTotal > 0
    ? (portfolio.totalMarginUsed / account.equityTotal) * 100
    : 0;

  // Calculate daily loss %
  const dailyPnlPct = accountState.getDailyPnlPercent();

  // Update daily stats
  dailyStats.dayRealizedPnl = account.realizedPnlToday;
  dailyStats.dayRealizedPnlPct = dailyPnlPct;
  dailyStats.synchronizedAt = new Date().toISOString();

  // Determine risk flags
  const nearLossLimit = dailyPnlPct <= -(config.maxDailyLossPct * 0.8);
  const lossLimitHit = dailyPnlPct <= -config.maxDailyLossPct;

  const maxPositionsReached = portfolio.activePositions >= config.maxOpenPositions;
  const heatTooHigh = portfolioHeatPct >= config.maxPortfolioHeatPct;

  // Main risk flags
  riskFlags = {
    portfolioHeatPct,
    projectedHeatPctIfNewTrade: portfolioHeatPct + config.maxRiskPerTradePct,
    nearDailyLossLimit: nearLossLimit,
    dailyLossLimitHit: lossLimitHit,
    riskAllowNewPositions: !lossLimitHit && !maxPositionsReached && !heatTooHigh,
    riskAllowNewLong: !lossLimitHit && portfolioHeatPct < config.allowNewLongIfHeatBelowPct,
    riskAllowNewShort: !lossLimitHit && portfolioHeatPct < config.allowNewShortIfHeatBelowPct,
    riskForceCloseAll: lossLimitHit
  };

  // Create snapshot
  lastRiskSnapshot = {
    account: { ...account },
    portfolio: { ...portfolio },
    positions: positionTracker.getAllPositions(true), // Add active positions array
    dailyStats: { ...dailyStats },
    riskFlags: { ...riskFlags },
    timestamp: new Date().toISOString()
  };

  // Log warnings
  if (nearLossLimit && !lossLimitHit) {
    console.warn(`[RiskEngine] ⚠️ NEAR DAILY LOSS LIMIT: ${dailyPnlPct.toFixed(2)}%`);
  }
  if (lossLimitHit) {
    console.error(`[RiskEngine] 🔴 DAILY LOSS LIMIT HIT: ${dailyPnlPct.toFixed(2)}%`);
  }
  if (heatTooHigh) {
    console.warn(`[RiskEngine] 🔥 PORTFOLIO HEAT TOO HIGH: ${portfolioHeatPct.toFixed(2)}%`);
  }
}

/**
 * Get current risk snapshot
 * @returns {Object} Complete risk snapshot
 */
export function getRiskSnapshot() {
  if (!lastRiskSnapshot) {
    recalcRiskState();
  }
  return lastRiskSnapshot ? { ...lastRiskSnapshot } : null;
}

/**
 * Get risk flags only (for fast access)
 * @returns {RiskFlags}
 */
export function getRiskFlags() {
  return riskFlags ? { ...riskFlags } : createDefaultRiskFlags();
}

/**
 * Get risk configuration
 * @returns {Object}
 */
export function getRiskConfig() {
  return { ...config };
}

/**
 * Update risk configuration
 * @param {Object} newConfig
 */
export function updateRiskConfig(newConfig) {
  config = { ...config, ...newConfig };
  console.log("[RiskEngine] Config updated:", config);
  recalcRiskState();
}

/**
 * Get daily statistics
 * @returns {DailyRiskStats}
 */
export function getDailyStats() {
  return dailyStats ? { ...dailyStats } : null;
}

/**
 * Create test position (for testing only)
 * @param {Object} params - Position parameters
 * @returns {Object} Created position
 */
export function createTestPosition({ symbol, side, entryPrice, qty, leverage }) {
  console.log(`[RiskEngine] Creating test position: ${symbol} ${side} @${entryPrice} qty=${qty}`);

  const position = positionTracker.onNewPositionOpened({
    symbol,
    side: side.toUpperCase(),
    entryPrice: parseFloat(entryPrice),
    qty: parseFloat(qty),
    leverage: leverage || 1,
    stopLossPrice: null,
    takeProfit1Price: null,
    takeProfit2Price: null
  });

  console.log(`[RiskEngine] Position created:`, position);

  // Recalculate risk state to update snapshot
  recalcRiskState();

  // Verify positions in snapshot
  const snapshot = getRiskSnapshot();
  console.log(`[RiskEngine] After recalc, snapshot has ${snapshot.positions.length} positions`);

  console.log(`✅ [RiskEngine] Test position created: ${symbol} ${side} @${entryPrice} qty=${qty}`);
  return position;
}

/**
 * Cleanup
 */
export function shutdown() {
  if (dailyResetTimer) {
    clearInterval(dailyResetTimer);
    dailyResetTimer = null;
  }
  console.log("[RiskEngine] Shutdown completed");
}
