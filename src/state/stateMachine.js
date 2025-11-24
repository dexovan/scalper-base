/**
 * STATE MACHINE - Main Orchestrator
 * Phase 7: State Machine per Symbol
 *
 * Manages per-symbol state contexts, processes events, writes logs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDefaultContext, applyTransition } from './stateModel.js';
import { EventType, TradeState, createStateEvent, createTimeTickPayload } from './stateEvents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ================================================================
// STATE MACHINE STATE
// ================================================================

const stateMachineState = {
  perSymbol: new Map(),        // Map<symbol, SymbolStateContext>
  tickIntervalMs: 1000,        // 1 second tick interval
  tickIntervalId: null,
  isInitialized: false,
  eventLogPath: path.join(PROJECT_ROOT, 'data', 'events')
};

// ================================================================
// CONFIGURATION
// ================================================================

const CONFIG = {
  tickIntervalMs: 1000,              // 1 second
  logEventsToFile: true,
  maxEventLogLinesPerSymbol: 10000   // Rotate after 10k events
};

// ================================================================
// INITIALIZATION
// ================================================================

/**
 * Initialize State Machine for universe symbols
 * @param {string[]} universeSymbols - Array of symbol names
 */
export function initStateMachine(universeSymbols = []) {
  console.log(`[StateMachine] Initializing for ${universeSymbols.length} symbols...`);

  // Clear existing state
  stateMachineState.perSymbol.clear();

  // Create default FLAT context for each symbol
  for (const symbol of universeSymbols) {
    const context = createDefaultContext(symbol);
    stateMachineState.perSymbol.set(symbol, context);
  }

  // Ensure event log directory exists
  if (CONFIG.logEventsToFile) {
    if (!fs.existsSync(stateMachineState.eventLogPath)) {
      fs.mkdirSync(stateMachineState.eventLogPath, { recursive: true });
    }
  }

  // Start tick interval
  startTicking();

  stateMachineState.isInitialized = true;

  console.log(`[StateMachine] ✅ Initialized with ${stateMachineState.perSymbol.size} symbols`);

  return {
    symbolCount: stateMachineState.perSymbol.size,
    tickInterval: CONFIG.tickIntervalMs
  };
}

/**
 * Shutdown State Machine (cleanup)
 */
export function shutdownStateMachine() {
  console.log('[StateMachine] Shutting down...');

  stopTicking();
  stateMachineState.perSymbol.clear();
  stateMachineState.isInitialized = false;

  console.log('[StateMachine] ✅ Shutdown complete');
}

// ================================================================
// EVENT HANDLING
// ================================================================

/**
 * Handle incoming state event
 * @param {Object} event - StateEvent
 * @returns {Object} { success: boolean, oldState: string, newState: string, reason: string }
 */
export function handleEvent(event) {
  const { symbol, type, timestamp } = event;

  // Debug: log every event (temporary)
  if (Math.random() < 0.01) { // Log 1% of events to avoid spam
    console.log(`[StateMachine] handleEvent: ${symbol} - ${type}`);
  }

  // Get or create context
  let context = stateMachineState.perSymbol.get(symbol);
  if (!context) {
    console.log(`[StateMachine] Creating new context for ${symbol}`);
    context = createDefaultContext(symbol);
    stateMachineState.perSymbol.set(symbol, context);
  }

  const oldState = context.currentState;

  // Apply transition
  const newContext = applyTransition(context, event);

  // Update stored context
  stateMachineState.perSymbol.set(symbol, newContext);

  const newState = newContext.currentState;
  const stateChanged = oldState !== newState;

  // Log state change
  if (stateChanged) {
    const logEntry = {
      timestamp,
      symbol,
      fromState: oldState,
      toState: newState,
      eventType: type,
      reason: newContext.lastStateChangeReason,
      extra: extractEventExtra(event)
    };

    console.log(
      `[StateMachine] ${symbol}: ${oldState} → ${newState} (${newContext.lastStateChangeReason})`
    );

    // Write to event log file
    if (CONFIG.logEventsToFile) {
      writeEventLog(symbol, logEntry);
    }
  }

  return {
    success: true,
    oldState,
    newState,
    reason: newContext.lastStateChangeReason,
    stateChanged
  };
}

/**
 * Process TIME_TICK event for all symbols
 * @param {string} now - ISO timestamp
 */
export function tick(now) {
  const event = createStateEvent(EventType.TIME_TICK, null, createTimeTickPayload(now), now);

  // Process tick for each symbol
  for (const [symbol, context] of stateMachineState.perSymbol.entries()) {
    event.symbol = symbol;
    handleEvent(event);
  }
}

/**
 * Start periodic ticking
 */
function startTicking() {
  if (stateMachineState.tickIntervalId) {
    clearInterval(stateMachineState.tickIntervalId);
  }

  stateMachineState.tickIntervalId = setInterval(() => {
    const now = new Date().toISOString();
    tick(now);
  }, CONFIG.tickIntervalMs);

  console.log(`[StateMachine] Ticker started (${CONFIG.tickIntervalMs}ms interval)`);
}

/**
 * Stop periodic ticking
 */
function stopTicking() {
  if (stateMachineState.tickIntervalId) {
    clearInterval(stateMachineState.tickIntervalId);
    stateMachineState.tickIntervalId = null;
    console.log('[StateMachine] Ticker stopped');
  }
}

// ================================================================
// QUERY METHODS
// ================================================================

/**
 * Get state context for a specific symbol
 * @param {string} symbol
 * @returns {Object|null} SymbolStateContext or null
 */
export function getSymbolState(symbol) {
  return stateMachineState.perSymbol.get(symbol) || null;
}

/**
 * Get overview of all symbol states
 * @returns {Object[]} Array of state overview entries
 */
export function getStatesOverview() {
  const entries = [];

  for (const [symbol, context] of stateMachineState.perSymbol.entries()) {
    entries.push({
      symbol,
      currentState: context.currentState,
      activeSide: context.activeSide,
      regime: context.regimeSnapshot.symbolRegime,
      globalRegime: context.regimeSnapshot.globalRegime,
      lastStateChangeAt: context.lastStateChangeAt,
      lastStateChangeReason: context.lastStateChangeReason,
      // Include key metrics
      finalScoreLong: context.signalSnapshot.lastFinalScoreLong,
      finalScoreShort: context.signalSnapshot.lastFinalScoreShort,
      signalLong: context.signalSnapshot.lastSignalLong,
      signalShort: context.signalSnapshot.lastSignalShort
    });
  }

  return entries;
}

/**
 * Get states by specific state type
 * @param {string} state - TradeState enum value
 * @returns {Object[]} Array of matching contexts
 */
export function getSymbolsByState(state) {
  const results = [];

  for (const [symbol, context] of stateMachineState.perSymbol.entries()) {
    if (context.currentState === state) {
      results.push({
        symbol,
        context
      });
    }
  }

  return results;
}

/**
 * Get statistics about state distribution
 * @returns {Object} State distribution stats
 */
export function getStateStatistics() {
  const stats = {
    totalSymbols: stateMachineState.perSymbol.size,
    byState: {},
    bySide: { LONG: 0, SHORT: 0 },
    activeScenarios: 0,
    blockedSymbols: 0
  };

  for (const context of stateMachineState.perSymbol.values()) {
    // Count by state
    stats.byState[context.currentState] = (stats.byState[context.currentState] || 0) + 1;

    // Count by side (only if activeSide is not null)
    if (context.activeSide !== null) {
      stats.bySide[context.activeSide] = (stats.bySide[context.activeSide] || 0) + 1;
    }

    // Count active scenarios (not FLAT, not BLOCKED, not COOLDOWN)
    if (![TradeState.FLAT, TradeState.BLOCKED_REGIME, TradeState.COOLDOWN].includes(context.currentState)) {
      stats.activeScenarios++;
    }

    // Count blocked
    if (context.currentState === TradeState.BLOCKED_REGIME) {
      stats.blockedSymbols++;
    }
  }

  return stats;
}

/**
 * Get health status
 * @returns {Object} Health info
 */
export function getHealth() {
  const stats = getStateStatistics();

  return {
    status: stateMachineState.isInitialized ? "OK" : "NOT_INITIALIZED",
    initialized: stateMachineState.isInitialized,
    symbolCount: stats.totalSymbols,
    activeScenarios: stats.activeScenarios,
    blockedSymbols: stats.blockedSymbols,
    tickInterval: CONFIG.tickIntervalMs,
    stateDistribution: stats.byState
  };
}

// ================================================================
// EVENT LOG PERSISTENCE
// ================================================================

/**
 * Write event log entry to file
 * @param {string} symbol
 * @param {Object} logEntry
 */
function writeEventLog(symbol, logEntry) {
  try {
    const logFile = path.join(stateMachineState.eventLogPath, `${symbol}.json`);
    const logLine = JSON.stringify(logEntry) + '\n';

    fs.appendFileSync(logFile, logLine, 'utf8');
  } catch (error) {
    console.error(`[StateMachine] Failed to write event log for ${symbol}:`, error.message);
  }
}

/**
 * Read event log for a symbol
 * @param {string} symbol
 * @param {number} limit - Max number of recent events to return
 * @returns {Object[]} Array of log entries
 */
export function readEventLog(symbol, limit = 50) {
  try {
    const logFile = path.join(stateMachineState.eventLogPath, `${symbol}.json`);

    if (!fs.existsSync(logFile)) {
      return [];
    }

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    // Take last N lines
    const recentLines = lines.slice(-limit);

    // Parse JSON lines
    const events = recentLines.map(line => {
      try {
        return JSON.parse(line);
      } catch (err) {
        console.error(`[StateMachine] Failed to parse log line:`, err.message);
        return null;
      }
    }).filter(e => e !== null);

    return events;
  } catch (error) {
    console.error(`[StateMachine] Failed to read event log for ${symbol}:`, error.message);
    return [];
  }
}

/**
 * Clear event log for a symbol (or all)
 * @param {string|null} symbol - Symbol name or null for all
 */
export function clearEventLog(symbol = null) {
  try {
    if (symbol) {
      const logFile = path.join(stateMachineState.eventLogPath, `${symbol}.json`);
      if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
        console.log(`[StateMachine] Cleared event log for ${symbol}`);
      }
    } else {
      // Clear all logs
      const files = fs.readdirSync(stateMachineState.eventLogPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(stateMachineState.eventLogPath, file));
        }
      }
      console.log('[StateMachine] Cleared all event logs');
    }
  } catch (error) {
    console.error('[StateMachine] Failed to clear event logs:', error.message);
  }
}

// ================================================================
// UTILITY HELPERS
// ================================================================

/**
 * Extract relevant data from event for logging
 * @param {Object} event
 * @returns {Object}
 */
function extractEventExtra(event) {
  const { type, payload } = event;

  switch (type) {
    case EventType.SCORING_UPDATE:
      return {
        finalScoreLong: payload.finalScoreLong,
        finalScoreShort: payload.finalScoreShort,
        signalLong: payload.signalLong,
        signalShort: payload.signalShort
      };

    case EventType.REGIME_UPDATE:
      return {
        symbolRegime: payload.symbolRegime,
        globalRegime: payload.globalRegime,
        cooldownActive: payload.cooldownActive
      };

    case EventType.RISK_UPDATE:
      return {
        riskAllowNewPositions: payload.riskAllowNewPositions
      };

    case EventType.MANUAL_OVERRIDE:
      return {
        action: payload.action,
        reason: payload.reason
      };

    default:
      return {};
  }
}

// ================================================================
// EXPORTS
// ================================================================

export default {
  initStateMachine,
  shutdownStateMachine,
  handleEvent,
  tick,
  getSymbolState,
  getStatesOverview,
  getSymbolsByState,
  getStateStatistics,
  getHealth,
  readEventLog,
  clearEventLog
};
