// ================================================================
// src/execution/tpslEngine.js
// TP/SL ENGINE - Main runtime for tracking TP/SL/BE/Trailing
// ================================================================

import * as tpslPlanner from './tpslPlanner.js';
import * as trailingEngine from './trailingEngine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

  // Load existing state if available
  loadSnapshot();

  // Start periodic snapshot updates (every 10 seconds)
  updateTimer = setInterval(() => {
    saveSnapshot();
  }, 10000);

  console.log('[TpslEngine] Initialized successfully');
  console.log(`[TpslEngine] Snapshot path: ${snapshotPath}`);
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
    trailingDistancePct: plan.trailingDistancePct,

    isBreakEvenHit: false,
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
export function onPriceUpdate(params) {
  const { symbol, price, positionState, featureState, regimeState } = params;

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

  // Check TP2 hit (if TP1 already hit)
  if (tpslState.isTp1Hit && !tpslState.isTp2Hit) {
    if (trailingEngine.isTp2Hit(side, price, tpslState.tp2Price)) {
      handleTp2Hit(tpslState, price);
      return;
    }
  }

  // Check TP1 hit
  if (!tpslState.isTp1Hit) {
    if (trailingEngine.isTp1Hit(side, price, tpslState.tp1Price)) {
      handleTp1Hit(tpslState, price, positionState);
      return;
    }
  }

  // Check break-even activation
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

  emitTpslEvent({
    type: 'TPSL_TP1_HIT',
    symbol: tpslState.symbol,
    side: tpslState.side,
    tp1Price: tpslState.tp1Price,
    currentPrice,
    partialCloseQty: positionState.qty * 0.5, // Close 50% at TP1
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
function handleTp2Hit(tpslState, currentPrice) {
  console.log(`[TpslEngine] 🎉 TP2 HIT for ${tpslState.symbol} ${tpslState.side} @ ${currentPrice}`);

  tpslState.isTp2Hit = true;
  tpslState.lastUpdateAt = new Date().toISOString();

  emitTpslEvent({
    type: 'TPSL_TP2_HIT',
    symbol: tpslState.symbol,
    side: tpslState.side,
    tp2Price: tpslState.tp2Price,
    currentPrice,
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
  // TODO: In future phases, integrate with State Machine event system
  console.log('[TpslEngine] Event:', event.type, event.symbol, event.side);

  // For now, just log
  // Later: global.stateMachine?.handleEvent(event)
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
 * Save snapshot to disk
 */
function saveSnapshot() {
  if (!snapshotPath) return;

  try {
    const snapshot = {
      timestamp: new Date().toISOString(),
      positions: Object.fromEntries(tpslStates)
    };

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  } catch (error) {
    console.error('[TpslEngine] Failed to save snapshot:', error);
  }
}

/**
 * Load snapshot from disk
 */
function loadSnapshot() {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) return;

  try {
    const data = fs.readFileSync(snapshotPath, 'utf8');
    const snapshot = JSON.parse(data);

    if (snapshot.positions) {
      for (const [key, state] of Object.entries(snapshot.positions)) {
        tpslStates.set(key, state);
      }
      console.log(`[TpslEngine] Loaded ${tpslStates.size} TP/SL states from snapshot`);
    }
  } catch (error) {
    console.error('[TpslEngine] Failed to load snapshot:', error);
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
