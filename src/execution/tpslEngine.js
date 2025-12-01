// ================================================================
// src/execution/tpslEngine.js
// TP/SL ENGINE - Main runtime for tracking TP/SL/BE/Trailing
// ================================================================

import * as tpslPlanner from './tpslPlanner.js';
import * as trailingEngine from './trailingEngine.js';
import bybitOrderExecutor from './bybitOrderExecutor.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventType, createStateEvent, createTpslTp1HitPayload, createTpslTp2HitPayload, createTpslSlHitPayload, createTpslTrailingActivatedPayload } from '../state/stateEvents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * TP/SL State for a position
 * @typedef {Object} TPSLState
 * @property {string} symbol
 * @property {string} side
 * @property {number} entryPrice
 * @property {number} tp1Price
 * @property {number} tp2Price
 * @property {number} stopLossPrice
 * @property {number} breakEvenPrice
 * @property {number} trailingDistancePct
 * @property {boolean} isBreakEvenHit
 * @property {boolean} trailingActive
 * @property {boolean} isTp1Hit
 * @property {boolean} isTp2Hit
 * @property {boolean} pumpOverrideApplied
 * @property {boolean} spoofingOverrideApplied
 * @property {boolean} volatilityOverrideApplied
 * @property {string} createdAt
 * @property {string} lastUpdateAt
 */

// Global state
const tpslStates = new Map(); // key: `${symbol}_${side}`
let snapshotPath = null;
let updateTimer = null;

/**
 * Initialize TP/SL Engine
 * @param {Object} config
 */
export function initTpslEngine(config = {}) {
  console.log('[TpslEngine] Initializing...');

  // Initialize planner
  tpslPlanner.initTpslPlanner(config.planner || {});

  // Set snapshot path
  const dataDir = path.resolve(__dirname, '../../data/system');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  snapshotPath = path.join(dataDir, 'tpsl_snapshot.json');

  // Load existing state if available - CRITICAL: Must load BEFORE any other operations
  const loadedCount = loadSnapshot();
  console.log(`[TpslEngine] ✅ Loaded ${loadedCount} positions from snapshot into tpslStates Map`);

  // Start periodic snapshot updates (every 10 seconds) - but delay to allow position sync
  // This prevents saveSnapshot() from overwriting the snapshot during initialization
  setTimeout(() => {
    updateTimer = setInterval(() => {
      saveSnapshot();
    }, 10000);
    console.log('[TpslEngine] Snapshot auto-save timer started (delayed 30s for initialization)');
  }, 30000);

  console.log('[TpslEngine] Initialized successfully');
  console.log(`[TpslEngine] Snapshot path: ${snapshotPath}`);
  console.log(`[TpslEngine] Current tpslStates Map size: ${tpslStates.size}`);
}

/**
 * Handle new position opened - create TP/SL plan
 * @param {Object} positionEvent
 */
export function onPositionOpened(positionEvent) {
  const { symbol, side, entryPrice, qty, leverage, featureState, regimeState } = positionEvent;

  console.log(`[TpslEngine] Position opened: ${symbol} ${side} @ ${entryPrice}`);

  // Plan TP/SL levels
  const plan = tpslPlanner.planTpSlLevels({
    symbol,
    side,
    entryPrice,
    qty,
    leverage,
    featureState,
    regimeState
  });

  // Create TP/SL state
  const tpslState = {
    symbol,
    side,
    entryPrice: plan.entryPrice,
    tp1Price: plan.tp1Price,
    tp2Price: plan.tp2Price,
    stopLossPrice: plan.slPrice,
    breakEvenPrice: plan.breakEvenPrice,
    quickTpPrice: plan.quickTpPrice,  // Quick scalp TP (fee cost + 0.05% buffer)
    trailingDistancePct: plan.trailingDistancePct,

    isBreakEvenHit: false,
    isQuickTpHit: false,  // New flag for quick TP
    trailingActive: false,
    isTp1Hit: false,
    isTp2Hit: false,

    pumpOverrideApplied: plan.pumpOverrideApplied,
    spoofingOverrideApplied: plan.spoofingOverrideApplied,
    volatilityOverrideApplied: plan.volatilityOverrideApplied,

    createdAt: new Date().toISOString(),
    lastUpdateAt: new Date().toISOString()
  };

  const key = `${symbol}_${side}`;
  tpslStates.set(key, tpslState);

  console.log(`[TpslEngine] TP/SL state created for ${key}`);
  console.log(`[TpslEngine] 🎯 QUICK TP Details for ${key}:`);
  console.log(`  - Entry Price: ${tpslState.entryPrice}`);
  console.log(`  - Break Even Price: ${tpslState.breakEvenPrice}`);
  console.log(`  - Quick TP Target: ${tpslState.quickTpPrice}`);
  console.log(`  - TP1 Target: ${tpslState.tp1Price}`);
  console.log(`  - SL: ${tpslState.stopLossPrice}`);

  // Emit event to State Machine
  emitTpslEvent({
    type: 'TPSL_INITIALIZED',
    symbol,
    side,
    tpslState
  });

  saveSnapshot();

  return tpslState;
}

/**
 * Handle price update for a symbol
 * @param {Object} params
 * @param {string} params.symbol
 * @param {number} params.price
 * @param {Object} params.positionState - From position tracker
 * @param {Object} params.featureState - From feature engine
 * @param {Object} params.regimeState - From regime engine
 */
export async function onPriceUpdate(params) {
  const { symbol, price, positionState, featureState, regimeState } = params;

  // DEBUG: Log every price update for monitoring
  console.log(`[TpslEngine] onPriceUpdate() called for ${symbol} @ ${price}`);

  if (!positionState || !positionState.isActive) {
    return; // No active position
  }

  const { side } = positionState;
  const key = `${symbol}_${side}`;
  const tpslState = tpslStates.get(key);

  if (!tpslState) {
    console.warn(`[TpslEngine] No TP/SL state for ${key}`);
    return;
  }

  // Check SL hit (highest priority)
  if (trailingEngine.isSlHit(side, price, tpslState.stopLossPrice)) {
    handleSlHit(tpslState, price);
    return;
  }

  // Check QUICK TP hit first (highest profit priority - take scalp profits immediately!)
  if (!tpslState.isQuickTpHit) {
    const isQuickTpHit = side === 'LONG' ? price >= tpslState.quickTpPrice : price <= tpslState.quickTpPrice;

    // Log every price check for Quick TP (DEBUGGING!)
    console.log(`[TpslEngine] Quick TP Check for ${tpslState.symbol}:`);
    console.log(`  - Current Price: ${price}`);
    console.log(`  - Quick TP Target: ${tpslState.quickTpPrice}`);
    console.log(`  - Side: ${side}`);
    console.log(`  - Hit? ${isQuickTpHit}`);

    if (isQuickTpHit) {
      console.log(`[TpslEngine] 🚀 QUICK TP HIT for ${tpslState.symbol} ${tpslState.side} @ ${price}`);
      await handleQuickTpHit(tpslState, price, positionState);
      return;
    }
  }  // Check TP2 hit (if TP1 already hit)
  if (tpslState.isTp1Hit && !tpslState.isTp2Hit) {
    if (trailingEngine.isTp2Hit(side, price, tpslState.tp2Price)) {
      handleTp2Hit(tpslState, price, positionState);
      return;
    }
  }

  // Check TP1 hit - with retroactive detection for skipped prices
  if (!tpslState.isTp1Hit) {
    // Direct hit
    if (trailingEngine.isTp1Hit(side, price, tpslState.tp1Price)) {
      console.log(`[TpslEngine] TP1 HIT (direct) at ${price}`);
      handleTp1Hit(tpslState, price, positionState);
      return;
    }

    // Retroactive hit - price already passed TP1 from previous update
    // For LONG: if TP1 was not hit before but price is now above TP1
    // For SHORT: if TP1 was not hit before but price is now below TP1
    const isPriceAboveTp1 = side === 'LONG' ? price >= tpslState.tp1Price : price <= tpslState.tp1Price;
    if (isPriceAboveTp1) {
      console.log(`[TpslEngine] TP1 HIT (retroactive) - price ${price} passed TP1 ${tpslState.tp1Price}`);
      handleTp1Hit(tpslState, price, positionState);
      return;
    }
  }  // Check break-even activation
  if (!tpslState.isBreakEvenHit) {
    const shouldBE = trailingEngine.shouldActivateBreakEven({
      side,
      entryPrice: tpslState.entryPrice,
      currentPrice: price,
      breakEvenPrice: tpslState.breakEvenPrice,
      unrealizedPnlPct: positionState.unrealizedPnlPct || 0
    });

    if (shouldBE) {
      handleBreakEvenActivation(tpslState, price);
    }
  }

  // Update trailing SL (if active)
  if (tpslState.trailingActive) {
    updateTrailingSL(tpslState, price, positionState, featureState, regimeState);
  }

  // Throttled save (only 1% of ticks)
  if (Math.random() < 0.01) {
    tpslState.lastUpdateAt = new Date().toISOString();
    saveSnapshot();
  }
}

/**
 * Handle break-even activation
 */
function handleBreakEvenActivation(tpslState, currentPrice) {
  console.log(`[TpslEngine] 🎯 BREAK-EVEN activated for ${tpslState.symbol} ${tpslState.side}`);

  tpslState.isBreakEvenHit = true;
  tpslState.stopLossPrice = tpslState.breakEvenPrice;
  tpslState.lastUpdateAt = new Date().toISOString();

  emitTpslEvent({
    type: 'TPSL_BREAK_EVEN_TRIGGERED',
    symbol: tpslState.symbol,
    side: tpslState.side,
    breakEvenPrice: tpslState.breakEvenPrice,
    currentPrice,
    timestamp: new Date().toISOString()
  });

  saveSnapshot();
}

/**
 * Handle QUICK TP hit - immediate scalp profit taking
 * Closes 50% of position at breakeven + small buffer for fee coverage
 */
async function handleQuickTpHit(tpslState, currentPrice, positionState) {
  console.log(`\n[TpslEngine] 🚀🚀🚀 QUICK TP HIT for ${tpslState.symbol} ${tpslState.side} @ ${currentPrice} 🚀🚀🚀`);
  console.log(`   This is your fee-covering profit target!`);

  tpslState.isQuickTpHit = true;
  tpslState.trailingActive = true; // Activate trailing after Quick TP
  tpslState.lastUpdateAt = new Date().toISOString();

  // Move SL to break-even immediately
  tpslState.stopLossPrice = tpslState.breakEvenPrice;
  console.log(`   SL moved to breakeven: ${tpslState.breakEvenPrice}`);

  // Calculate quantity to close (50% of position)
  const partialCloseQty = positionState.qty * 0.5;

  // Close 50% of position to take quick scalp profit
  console.log(`[TpslEngine] 💰 Closing 50% (${partialCloseQty} ${tpslState.symbol}) for quick profit...`);

  try {
    // Convert side from 'LONG'/'SHORT' to 'Buy'/'Sell' for Bybit
    const bybitSide = tpslState.side === 'LONG' ? 'Buy' : 'Sell';

    if (bybitOrderExecutor.partialClosePosition) {
      console.log(`[TpslEngine] Calling partialClosePosition(${tpslState.symbol}, ${bybitSide}, ${partialCloseQty})`);
      await bybitOrderExecutor.partialClosePosition(tpslState.symbol, bybitSide, partialCloseQty);
      console.log(`✅ [TpslEngine] 50% closed at Quick TP - profit secured! 🎉`);
    } else {
      console.warn(`⚠️  [TpslEngine] partialClosePosition not available`);
    }
  } catch (err) {
    console.error(`❌ [TpslEngine] Failed to close at Quick TP: ${err.message}`);
    console.error(err.stack);
  }

  emitTpslEvent({
    type: 'TPSL_QUICK_TP_HIT',
    symbol: tpslState.symbol,
    side: tpslState.side,
    quickTpPrice: tpslState.quickTpPrice,
    currentPrice,
    partialCloseQty: partialCloseQty,
    message: 'Quick scalp profit taken - 50% closed at breakeven + buffer',
    timestamp: new Date().toISOString()
  });

  emitTpslEvent({
    type: 'TPSL_TRAILING_ACTIVATED',
    symbol: tpslState.symbol,
    side: tpslState.side,
    trailingDistancePct: tpslState.trailingDistancePct,
    timestamp: new Date().toISOString()
  });

  saveSnapshot();
}

/**
 * Handle TP1 hit
 */
function handleTp1Hit(tpslState, currentPrice, positionState) {
  console.log(`[TpslEngine] 💰 TP1 HIT for ${tpslState.symbol} ${tpslState.side} @ ${currentPrice}`);

  tpslState.isTp1Hit = true;
  tpslState.trailingActive = true; // Activate trailing after TP1
  tpslState.lastUpdateAt = new Date().toISOString();

  // Move SL to at least break-even
  if (tpslState.side === 'LONG') {
    tpslState.stopLossPrice = Math.max(tpslState.stopLossPrice, tpslState.breakEvenPrice);
  } else {
    tpslState.stopLossPrice = Math.min(tpslState.stopLossPrice, tpslState.breakEvenPrice);
  }

  // Calculate quantity to close (50% of position)
  const partialCloseQty = positionState.qty * 0.5;

  // Close 50% of position to secure initial investment
  console.log(`[TpslEngine] 🔄 Closing 50% (${partialCloseQty} ${tpslState.symbol}) to secure profit...`);

  (async () => {
    try {
      // Convert side from 'LONG'/'SHORT' to 'Buy'/'Sell' for Bybit
      const buyitSide = tpslState.side === 'LONG' ? 'Buy' : 'Sell';

      if (bybitOrderExecutor.partialClosePosition) {
        await bybitOrderExecutor.partialClosePosition(tpslState.symbol, buyitSide, partialCloseQty);
        console.log(`✅ [TpslEngine] 50% position closed successfully`);
      } else {
        console.warn(`⚠️  [TpslEngine] partialClosePosition not available`);
      }
    } catch (err) {
      console.error(`❌ [TpslEngine] Failed to close 50% position: ${err.message}`);
    }
  })();

  emitTpslEvent({
    type: 'TPSL_TP1_HIT',
    symbol: tpslState.symbol,
    side: tpslState.side,
    tp1Price: tpslState.tp1Price,
    currentPrice,
    partialCloseQty: partialCloseQty,
    timestamp: new Date().toISOString()
  });

  emitTpslEvent({
    type: 'TPSL_TRAILING_ACTIVATED',
    symbol: tpslState.symbol,
    side: tpslState.side,
    trailingDistancePct: tpslState.trailingDistancePct,
    timestamp: new Date().toISOString()
  });

  saveSnapshot();
}

/**
 * Handle TP2 hit
 */
function handleTp2Hit(tpslState, currentPrice, positionState) {
  console.log(`[TpslEngine] 🎉 TP2 HIT for ${tpslState.symbol} ${tpslState.side} @ ${currentPrice}`);

  tpslState.isTp2Hit = true;
  tpslState.lastUpdateAt = new Date().toISOString();

  // Close remaining 50% of position
  if (positionState) {
    const remainingCloseQty = positionState.qty * 0.5;

    console.log(`[TpslEngine] 🔄 Closing remaining 50% (${remainingCloseQty} ${tpslState.symbol})...`);

    (async () => {
      try {
        // Convert side from 'LONG'/'SHORT' to 'Buy'/'Sell' for Bybit
        const bybitSide = tpslState.side === 'LONG' ? 'Buy' : 'Sell';

        if (bybitOrderExecutor.partialClosePosition) {
          await bybitOrderExecutor.partialClosePosition(tpslState.symbol, bybitSide, remainingCloseQty);
          console.log(`✅ [TpslEngine] Remaining position closed successfully`);
        } else {
          console.warn(`⚠️  [TpslEngine] partialClosePosition not available`);
        }
      } catch (err) {
        console.error(`❌ [TpslEngine] Failed to close remaining position: ${err.message}`);
      }
    })();
  }

  emitTpslEvent({
    type: 'TPSL_TP2_HIT',
    symbol: tpslState.symbol,
    side: tpslState.side,
    tp2Price: tpslState.tp2Price,
    currentPrice,
    remainingCloseQty: positionState ? positionState.qty * 0.5 : 0,
    timestamp: new Date().toISOString()
  });

  emitTpslEvent({
    type: 'TPSL_EXIT',
    symbol: tpslState.symbol,
    side: tpslState.side,
    exitPrice: currentPrice,
    reason: 'TP2_HIT',
    timestamp: new Date().toISOString()
  });

  // Remove state
  const key = `${tpslState.symbol}_${tpslState.side}`;
  tpslStates.delete(key);

  saveSnapshot();
}

/**
 * Handle SL hit
 */
function handleSlHit(tpslState, currentPrice) {
  console.log(`[TpslEngine] 🛑 SL HIT for ${tpslState.symbol} ${tpslState.side} @ ${currentPrice}`);

  tpslState.lastUpdateAt = new Date().toISOString();

  emitTpslEvent({
    type: 'TPSL_SL_HIT',
    symbol: tpslState.symbol,
    side: tpslState.side,
    slPrice: tpslState.stopLossPrice,
    currentPrice,
    timestamp: new Date().toISOString()
  });

  emitTpslEvent({
    type: 'TPSL_EXIT',
    symbol: tpslState.symbol,
    side: tpslState.side,
    exitPrice: currentPrice,
    reason: 'SL_HIT',
    timestamp: new Date().toISOString()
  });

  // Remove state
  const key = `${tpslState.symbol}_${tpslState.side}`;
  tpslStates.delete(key);

  saveSnapshot();
}

/**
 * Update trailing SL
 */
function updateTrailingSL(tpslState, currentPrice, positionState, featureState, regimeState) {
  const mfe = positionState.maxFavorableExcursion || currentPrice;

  const result = trailingEngine.calculateTrailingSL({
    symbol: tpslState.symbol,
    side: tpslState.side,
    currentPrice,
    entryPrice: tpslState.entryPrice,
    currentSlPrice: tpslState.stopLossPrice,
    trailingDistancePct: tpslState.trailingDistancePct,
    mfe,
    regimeState,
    featureState
  });

  if (result.changed) {
    tpslState.stopLossPrice = result.newSlPrice;
    tpslState.pumpOverrideApplied = result.pumpOverride || tpslState.pumpOverrideApplied;
    tpslState.spoofingOverrideApplied = result.spoofingOverride || tpslState.spoofingOverrideApplied;
    tpslState.volatilityOverrideApplied = result.volatilityOverride || tpslState.volatilityOverrideApplied;
    tpslState.lastUpdateAt = new Date().toISOString();
  }
}

/**
 * Emit TP/SL event to State Machine
 */
function emitTpslEvent(event) {
  console.log('[TpslEngine] Event:', event.type, event.symbol, event.side);

  // Convert TPSL event to State Machine event format
  if (event.type === 'TPSL_TP1_HIT') {
    const stateEvent = createStateEvent(
      EventType.TPSL_TP1_HIT,
      event.symbol,
      createTpslTp1HitPayload(
        event.symbol,
        event.side,
        event.tp1Price,
        event.currentPrice,
        event.partialCloseQty
      )
    );
    // Emit to state machine if available
    if (global.stateMachine?.onTpslEvent) {
      console.log(`[TpslEngine] 📤 Emitting TPSL_TP1_HIT to state machine for ${event.symbol}`);
      global.stateMachine.onTpslEvent(stateEvent);
    } else {
      console.log(`[TpslEngine] ⚠️ State machine not available, event not dispatched`);
    }
  } else if (event.type === 'TPSL_TP2_HIT') {
    const stateEvent = createStateEvent(
      EventType.TPSL_TP2_HIT,
      event.symbol,
      createTpslTp2HitPayload(event.symbol, event.side, event.tp2Price, event.currentPrice)
    );
    if (global.stateMachine?.onTpslEvent) {
      console.log(`[TpslEngine] 📤 Emitting TPSL_TP2_HIT to state machine for ${event.symbol}`);
      global.stateMachine.onTpslEvent(stateEvent);
    }
  } else if (event.type === 'TPSL_SL_HIT') {
    const stateEvent = createStateEvent(
      EventType.TPSL_SL_HIT,
      event.symbol,
      createTpslSlHitPayload(event.symbol, event.side, event.slPrice, event.currentPrice)
    );
    if (global.stateMachine?.onTpslEvent) {
      console.log(`[TpslEngine] 📤 Emitting TPSL_SL_HIT to state machine for ${event.symbol}`);
      global.stateMachine.onTpslEvent(stateEvent);
    }
  } else if (event.type === 'TPSL_TRAILING_ACTIVATED') {
    const stateEvent = createStateEvent(
      EventType.TPSL_TRAILING_ACTIVATED,
      event.symbol,
      createTpslTrailingActivatedPayload(event.symbol, event.side, event.trailingDistancePct)
    );
    if (global.stateMachine?.onTpslEvent) {
      console.log(`[TpslEngine] 📤 Emitting TPSL_TRAILING_ACTIVATED to state machine for ${event.symbol}`);
      global.stateMachine.onTpslEvent(stateEvent);
    }
  }
}

/**
 * Get TP/SL state for a position
 * @param {string} symbol
 * @param {string} side
 * @returns {TPSLState|null}
 */
export function getTpslState(symbol, side) {
  const key = `${symbol}_${side}`;
  return tpslStates.get(key) || null;
}

/**
 * Get all TP/SL states
 * @returns {Array<TPSLState>}
 */
export function getAllTpslStates() {
  return Array.from(tpslStates.values());
}

/**
 * Get tpslStates map (for position tracker synchronization)
 */
export function getTpslStatesMap() {
  return tpslStates;
}

/**
 * Save snapshot to disk
 */
function saveSnapshot() {
  if (!snapshotPath) return;

  try {
    // Convert Map to object for JSON serialization
    const positionsObj = {};
    for (const [key, state] of tpslStates.entries()) {
      positionsObj[key] = state;
    }

    const snapshot = {
      timestamp: new Date().toISOString(),
      positions: positionsObj
    };

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  } catch (error) {
    console.error('[TpslEngine] Failed to save snapshot:', error);
  }
}

/**
 * Load snapshot from disk
 * @returns {number} Number of positions loaded
 */
function loadSnapshot() {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    console.log(`[TpslEngine] No snapshot file at ${snapshotPath}`);
    return 0;
  }

  try {
    if (!fs.existsSync(snapshotPath)) {
      console.log(`[TpslEngine] Snapshot file does not exist at ${snapshotPath}`);
      return 0;
    }

    const data = fs.readFileSync(snapshotPath, 'utf8');
    if (!data || data.trim().length === 0) {
      console.log(`[TpslEngine] Snapshot file is empty`);
      return 0;
    }

    const snapshot = JSON.parse(data);
    if (!snapshot.positions || typeof snapshot.positions !== 'object') {
      console.log(`[TpslEngine] No positions in snapshot`);
      return 0;
    }

    const entries = Object.entries(snapshot.positions);
    console.log(`[TpslEngine] Found ${entries.length} positions in snapshot file`);

    let loadedCount = 0;
    for (const [key, state] of entries) {
      // Validate position has required fields
      if (!state.symbol || !state.side || state.entryPrice === undefined) {
        console.warn(`[TpslEngine] ⚠️ Invalid position data for key=${key}, skipping`);
        continue;
      }
      console.log(`[TpslEngine]   → Loading ${key}: ${state.symbol} ${state.side} @ ${state.entryPrice}`);
      tpslStates.set(key, state);
      loadedCount++;
    }

    console.log(`[TpslEngine] ✅ Loaded ${loadedCount} positions from snapshot`);
    console.log(`[TpslEngine] tpslStates Map now has ${tpslStates.size} entries`);
    return loadedCount;
  } catch (error) {
    console.error(`[TpslEngine] ❌ Failed to load snapshot: ${error.message}`);
    return 0;
  }
}

/**
 * Cleanup
 */
export function shutdown() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  saveSnapshot();
  console.log('[TpslEngine] Shutdown completed');
}
