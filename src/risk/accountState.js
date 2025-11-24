// ================================================================
// src/risk/accountState.js
// ACCOUNT STATE MANAGER - Tracks equity, balance, PnL
// ================================================================

/**
 * Account operating mode
 */
export const AccountMode = {
  SIM: "SIM",           // Simulated trading (no real money)
  DRY_RUN: "DRY_RUN",   // Paper trading with real data
  LIVE: "LIVE"          // Real trading
};

/**
 * AccountState structure
 * @typedef {Object} AccountState
 * @property {string} mode - Operating mode (SIM/DRY_RUN/LIVE)
 * @property {number} equityTotal - Total account equity (balance + unrealized PnL)
 * @property {number} balanceAvailable - Available balance for new positions
 * @property {number} marginUsed - Margin currently used by open positions
 * @property {number} openPnlUnrealized - Total unrealized PnL from open positions
 * @property {number} realizedPnlTotal - Lifetime realized PnL
 * @property {number} realizedPnlToday - Today's realized PnL
 * @property {number} equityAtDayStart - Equity at day start (for daily % calc)
 * @property {string} lastSyncAt - ISO timestamp of last sync
 */

// Internal state
let accountState = null;

/**
 * Initialize account state
 * @param {string} mode - AccountMode enum value
 * @param {number} initialEquity - Starting equity (default: 10000 USDT for SIM)
 * @returns {AccountState}
 */
export function initAccountState(mode = AccountMode.SIM, initialEquity = 10000) {
  console.log(`[AccountState] Initializing in ${mode} mode with ${initialEquity} USDT`);

  const now = new Date().toISOString();

  accountState = {
    mode,
    equityTotal: initialEquity,
    balanceAvailable: initialEquity,
    marginUsed: 0,
    openPnlUnrealized: 0,
    realizedPnlTotal: 0,
    realizedPnlToday: 0,
    equityAtDayStart: initialEquity,
    lastSyncAt: now
  };

  return { ...accountState };
}

/**
 * Get current account state
 * @returns {AccountState|null}
 */
export function getAccountState() {
  if (!accountState) {
    console.warn("[AccountState] Not initialized - call initAccountState() first");
    return null;
  }
  return { ...accountState };
}

/**
 * Update account state based on position changes
 * @param {Object} positionStates - Map of all position states
 */
export function updateAccountFromPositions(positionStates) {
  if (!accountState) {
    console.warn("[AccountState] Cannot update - not initialized");
    return;
  }

  // Calculate total unrealized PnL from all open positions
  let totalUnrealized = 0;
  let totalMargin = 0;

  for (const position of positionStates.values()) {
    if (position.isActive) {
      totalUnrealized += position.unrealizedPnl || 0;
      totalMargin += position.marginUsed || 0;
    }
  }

  // Update account state
  accountState.openPnlUnrealized = totalUnrealized;
  accountState.marginUsed = totalMargin;

  // Equity = balance + unrealized PnL
  accountState.equityTotal = accountState.balanceAvailable + totalUnrealized;

  accountState.lastSyncAt = new Date().toISOString();

  // Debug log (sample 1% to avoid spam)
  if (Math.random() < 0.01) {
    console.log(`[AccountState] Updated: Equity=${accountState.equityTotal.toFixed(2)}, Unrealized=${totalUnrealized.toFixed(2)}, Margin=${totalMargin.toFixed(2)}`);
  }
}

/**
 * Record realized PnL when position closes
 * @param {number} realizedPnl - Realized profit/loss
 */
export function recordRealizedPnl(realizedPnl) {
  if (!accountState) {
    console.warn("[AccountState] Cannot record PnL - not initialized");
    return;
  }

  accountState.realizedPnlTotal += realizedPnl;
  accountState.realizedPnlToday += realizedPnl;

  // Update balance (realized profit goes to available balance)
  accountState.balanceAvailable += realizedPnl;

  console.log(`[AccountState] Realized PnL: ${realizedPnl.toFixed(2)} USDT (Total: ${accountState.realizedPnlTotal.toFixed(2)})`);
}

/**
 * Reset daily statistics (called at day rollover)
 */
export function resetDailyStats() {
  if (!accountState) return;

  console.log(`[AccountState] Daily reset - Previous day PnL: ${accountState.realizedPnlToday.toFixed(2)}`);

  accountState.realizedPnlToday = 0;
  accountState.equityAtDayStart = accountState.equityTotal;
  accountState.lastSyncAt = new Date().toISOString();

  console.log(`[AccountState] New day started with equity: ${accountState.equityAtDayStart.toFixed(2)}`);
}

/**
 * Sync with external account (Bybit API) - STUB for Phase 8
 * In LIVE mode this would fetch real account data from exchange
 * @returns {Promise<AccountState|null>}
 */
export async function syncWithExternalAccount() {
  if (!accountState) {
    console.warn("[AccountState] Cannot sync - not initialized");
    return null;
  }

  if (accountState.mode === AccountMode.LIVE) {
    console.log("[AccountState] LIVE mode sync would call Bybit API here (STUB)");
    // TODO Phase 9+: Implement real Bybit account sync
    // const bybitAccount = await bybitClient.getAccountBalance();
    // accountState.equityTotal = bybitAccount.equity;
    // accountState.balanceAvailable = bybitAccount.availableBalance;
    // ...
  }

  accountState.lastSyncAt = new Date().toISOString();
  return { ...accountState };
}

/**
 * Get daily PnL percentage
 * @returns {number} Daily PnL as percentage of starting equity
 */
export function getDailyPnlPercent() {
  if (!accountState || accountState.equityAtDayStart === 0) return 0;
  return (accountState.realizedPnlToday / accountState.equityAtDayStart) * 100;
}

/**
 * Get account health summary
 * @returns {Object} Health metrics
 */
export function getAccountHealth() {
  if (!accountState) return null;

  const dailyPnlPct = getDailyPnlPercent();
  const marginUsedPct = accountState.equityTotal > 0
    ? (accountState.marginUsed / accountState.equityTotal) * 100
    : 0;

  return {
    mode: accountState.mode,
    equity: accountState.equityTotal,
    availableBalance: accountState.balanceAvailable,
    unrealizedPnl: accountState.openPnlUnrealized,
    realizedPnlToday: accountState.realizedPnlToday,
    dailyPnlPct,
    marginUsedPct,
    lastSync: accountState.lastSyncAt
  };
}
