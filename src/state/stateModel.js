/**
 * STATE MODEL - State Machine Transition Rules and Logic
 * Phase 7: State Machine per Symbol
 */

import { TradeState, EventType } from './stateEvents.js';

// ================================================================
// SYMBOL STATE CONTEXT STRUCTURE
// ================================================================

/**
 * Create default SymbolStateContext for a new symbol
 * @param {string} symbol - Symbol name (e.g., "BTCUSDT")
 * @returns {Object} SymbolStateContext
 */
export function createDefaultContext(symbol) {
  const now = new Date().toISOString();

  return {
    symbol,

    // Current state
    currentState: TradeState.FLAT,
    lastStateChangeAt: now,
    lastStateChangeReason: "INIT",
    activeSide: null, // "LONG" | "SHORT" | null

    // Signal snapshot from ScoringEngine
    signalSnapshot: {
      lastScoreUpdateAt: null,
      lastFinalScoreLong: null,
      lastFinalScoreShort: null,
      lastSignalLong: "NONE",
      lastSignalShort: "NONE"
    },

    // Regime snapshot from RegimeEngine
    regimeSnapshot: {
      symbolRegime: "NORMAL",
      globalRegime: "GLOBAL_NORMAL",
      cooldownActive: false,
      cooldownEndsAt: null
    },

    // Risk snapshot (stub for Phase 7)
    riskSnapshot: {
      riskAllowNewPositions: true,
      riskAllowNewLong: true,
      riskAllowNewShort: true
    },

    // Entry plan (prepared but not executed in Phase 7)
    entryPlan: null,

    // Position context (filled by execution engine in later phases)
    positionContext: null
  };
}

// ================================================================
// CONFIGURATION THRESHOLDS
// ================================================================

const CONFIG = {
  minScoreToConsider: 15,      // Below this = ignore
  watchThreshold: 25,          // WATCH signal threshold
  armThreshold: 40,            // ARM signal threshold
  cooldownAfterExitMs: 15000,  // 15s cooldown after exit
  entryPlanValidityMs: 120000  // 2 min entry plan validity
};

// ================================================================
// GLOBAL BLOCK CONDITIONS
// ================================================================

/**
 * Check if global regime blocks new scenarios
 * @param {Object} context - SymbolStateContext
 * @returns {boolean}
 */
function isGloballyBlocked(context) {
  const { globalRegime } = context.regimeSnapshot;
  return globalRegime === "GLOBAL_PANIC" || globalRegime === "GLOBAL_RISK_OFF";
}

/**
 * Check if symbol regime blocks new scenarios
 * @param {Object} context - SymbolStateContext
 * @returns {boolean}
 */
function isSymbolBlocked(context) {
  const { symbolRegime } = context.regimeSnapshot;
  return ["PUMP", "MANIPULATED", "NEWS_DRIVEN", "ILLIQUID"].includes(symbolRegime);
}

/**
 * Check if risk allows new positions
 * @param {Object} context - SymbolStateContext
 * @param {string} side - "LONG" | "SHORT"
 * @returns {boolean}
 */
function isRiskAllowed(context, side) {
  const { riskAllowNewPositions, riskAllowNewLong, riskAllowNewShort } = context.riskSnapshot;

  if (!riskAllowNewPositions) return false;
  if (side === "LONG" && !riskAllowNewLong) return false;
  if (side === "SHORT" && !riskAllowNewShort) return false;

  return true;
}

/**
 * Check if new scenario can be started (combined checks)
 * @param {Object} context
 * @param {string} side - "LONG" | "SHORT"
 * @returns {Object} { allowed: boolean, reason: string }
 */
function canStartNewScenario(context, side) {
  if (isGloballyBlocked(context)) {
    return { allowed: false, reason: "Global regime blocks new scenarios" };
  }

  if (isSymbolBlocked(context)) {
    return { allowed: false, reason: "Symbol regime blocks new scenarios" };
  }

  if (!isRiskAllowed(context, side)) {
    return { allowed: false, reason: "Risk management blocks new scenarios" };
  }

  if (context.regimeSnapshot.cooldownActive) {
    return { allowed: false, reason: "Cooldown active" };
  }

  return { allowed: true, reason: "OK" };
}

// ================================================================
// STATE TRANSITION LOGIC
// ================================================================

/**
 * Apply transition based on event
 * @param {Object} context - SymbolStateContext
 * @param {Object} event - StateEvent
 * @returns {Object} Updated SymbolStateContext
 */
export function applyTransition(context, event) {
  // Clone context to avoid mutation
  const newContext = JSON.parse(JSON.stringify(context));
  const { type, payload, timestamp } = event;

  // Update snapshots first (always, regardless of state)
  if (type === EventType.SCORING_UPDATE) {
    newContext.signalSnapshot = {
      lastScoreUpdateAt: timestamp,
      lastFinalScoreLong: payload.finalScoreLong,
      lastFinalScoreShort: payload.finalScoreShort,
      lastSignalLong: payload.signalLong,
      lastSignalShort: payload.signalShort
    };
  }

  if (type === EventType.REGIME_UPDATE) {
    newContext.regimeSnapshot = {
      symbolRegime: payload.symbolRegime,
      globalRegime: payload.globalRegime,
      cooldownActive: payload.cooldownActive,
      cooldownEndsAt: payload.cooldownEndsAt
    };
  }

  if (type === EventType.RISK_UPDATE) {
    newContext.riskSnapshot = {
      riskAllowNewPositions: payload.riskAllowNewPositions,
      riskAllowNewLong: payload.riskAllowNewLong,
      riskAllowNewShort: payload.riskAllowNewShort
    };
  }

  // Get next state based on current state and event
  const transition = getNextState(newContext.currentState, event, newContext);

  if (transition.nextState && transition.nextState !== newContext.currentState) {
    newContext.currentState = transition.nextState;
    newContext.lastStateChangeAt = timestamp;
    newContext.lastStateChangeReason = transition.reason;

    if (transition.sideUpdate !== undefined) {
      newContext.activeSide = transition.sideUpdate;
    }

    // Handle entry plan creation for ARMED states
    if (transition.nextState === TradeState.ARMED_LONG || transition.nextState === TradeState.ARMED_SHORT) {
      newContext.entryPlan = createEntryPlan(newContext, transition.nextState, timestamp);
    }

    // Clear entry plan when leaving ARMED/ORDER states
    if ([TradeState.FLAT, TradeState.BLOCKED_REGIME, TradeState.COOLDOWN].includes(transition.nextState)) {
      newContext.entryPlan = null;
    }
  }

  return newContext;
}

/**
 * Determine next state based on current state and event
 * @param {string} currentState - TradeState enum value
 * @param {Object} event - StateEvent
 * @param {Object} context - SymbolStateContext
 * @returns {Object} { nextState: string, reason: string, sideUpdate?: string|null }
 */
export function getNextState(currentState, event, context) {
  const { type, payload } = event;

  // MANUAL_OVERRIDE can force state change from anywhere
  if (type === EventType.MANUAL_OVERRIDE) {
    return handleManualOverride(currentState, payload);
  }

  // Check for global blocks that force BLOCKED_REGIME
  if (type === EventType.REGIME_UPDATE && shouldBlockRegime(context)) {
    return {
      nextState: TradeState.BLOCKED_REGIME,
      reason: `Regime block: ${payload.globalRegime} / ${payload.symbolRegime}`,
      sideUpdate: null
    };
  }

  // State-specific transition logic
  switch (currentState) {
    case TradeState.FLAT:
      return handleFlatState(event, context);

    case TradeState.WATCHING_LONG:
      return handleWatchingLongState(event, context);

    case TradeState.WATCHING_SHORT:
      return handleWatchingShortState(event, context);

    case TradeState.ARMED_LONG:
      return handleArmedLongState(event, context);

    case TradeState.ARMED_SHORT:
      return handleArmedShortState(event, context);

    case TradeState.ORDER_PLACED_LONG:
    case TradeState.ORDER_PLACED_SHORT:
      return handleOrderPlacedState(currentState, event, context);

    case TradeState.IN_POSITION_LONG:
    case TradeState.IN_POSITION_SHORT:
    case TradeState.MANAGING_LONG:
    case TradeState.MANAGING_SHORT:
      return handlePositionStates(currentState, event, context);

    case TradeState.EXITED:
      return handleExitedState(event, context);

    case TradeState.COOLDOWN:
      return handleCooldownState(event, context);

    case TradeState.BLOCKED_REGIME:
      return handleBlockedRegimeState(event, context);

    default:
      return { nextState: null, reason: "Unknown state" };
  }
}

// ================================================================
// STATE-SPECIFIC HANDLERS
// ================================================================

function handleFlatState(event, context) {
  if (event.type !== EventType.SCORING_UPDATE) {
    return { nextState: null, reason: "No transition" };
  }

  const { signalLong, signalShort, finalScoreLong, finalScoreShort } = event.payload;

  // Check LONG signals
  if (signalLong === "ARM") {
    const check = canStartNewScenario(context, "LONG");
    if (check.allowed) {
      return {
        nextState: TradeState.ARMED_LONG,
        reason: "Direct ARM signal LONG",
        sideUpdate: "LONG"
      };
    }
  }

  if (signalLong === "WATCH" && finalScoreLong >= CONFIG.watchThreshold) {
    const check = canStartNewScenario(context, "LONG");
    if (check.allowed) {
      return {
        nextState: TradeState.WATCHING_LONG,
        reason: "WATCH signal LONG",
        sideUpdate: "LONG"
      };
    }
  }

  // Check SHORT signals
  if (signalShort === "ARM") {
    const check = canStartNewScenario(context, "SHORT");
    if (check.allowed) {
      return {
        nextState: TradeState.ARMED_SHORT,
        reason: "Direct ARM signal SHORT",
        sideUpdate: "SHORT"
      };
    }
  }

  if (signalShort === "WATCH" && finalScoreShort >= CONFIG.watchThreshold) {
    const check = canStartNewScenario(context, "SHORT");
    if (check.allowed) {
      return {
        nextState: TradeState.WATCHING_SHORT,
        reason: "WATCH signal SHORT",
        sideUpdate: "SHORT"
      };
    }
  }

  return { nextState: null, reason: "No valid signal" };
}

function handleWatchingLongState(event, context) {
  if (event.type === EventType.SCORING_UPDATE) {
    const { signalLong, finalScoreLong } = event.payload;

    // Upgrade to ARM
    if (signalLong === "ARM" && finalScoreLong >= CONFIG.armThreshold) {
      const check = canStartNewScenario(context, "LONG");
      if (check.allowed) {
        return {
          nextState: TradeState.ARMED_LONG,
          reason: "Upgraded to ARM LONG",
          sideUpdate: "LONG"
        };
      }
    }

    // Downgrade to FLAT
    if (signalLong === "NONE" || finalScoreLong < CONFIG.minScoreToConsider) {
      return {
        nextState: TradeState.FLAT,
        reason: "Score dropped below threshold",
        sideUpdate: null
      };
    }
  }

  return { nextState: null, reason: "No transition" };
}

function handleWatchingShortState(event, context) {
  if (event.type === EventType.SCORING_UPDATE) {
    const { signalShort, finalScoreShort } = event.payload;

    // Upgrade to ARM
    if (signalShort === "ARM" && finalScoreShort >= CONFIG.armThreshold) {
      const check = canStartNewScenario(context, "SHORT");
      if (check.allowed) {
        return {
          nextState: TradeState.ARMED_SHORT,
          reason: "Upgraded to ARM SHORT",
          sideUpdate: "SHORT"
        };
      }
    }

    // Downgrade to FLAT
    if (signalShort === "NONE" || finalScoreShort < CONFIG.minScoreToConsider) {
      return {
        nextState: TradeState.FLAT,
        reason: "Score dropped below threshold",
        sideUpdate: null
      };
    }
  }

  return { nextState: null, reason: "No transition" };
}

function handleArmedLongState(event, context) {
  if (event.type === EventType.SCORING_UPDATE) {
    const { signalLong, finalScoreLong } = event.payload;

    // Downgrade to WATCH
    if (signalLong === "WATCH" && finalScoreLong >= CONFIG.watchThreshold) {
      return {
        nextState: TradeState.WATCHING_LONG,
        reason: "Downgraded to WATCH LONG",
        sideUpdate: "LONG"
      };
    }

    // Abort to FLAT
    if (signalLong === "NONE" || finalScoreLong < CONFIG.minScoreToConsider) {
      return {
        nextState: TradeState.FLAT,
        reason: "ARM signal lost",
        sideUpdate: null
      };
    }
  }

  // Order placed (later phases)
  if (event.type === EventType.EXECUTION_ORDER_PLACED) {
    return {
      nextState: TradeState.ORDER_PLACED_LONG,
      reason: "Order placed for LONG",
      sideUpdate: "LONG"
    };
  }

  return { nextState: null, reason: "No transition" };
}

function handleArmedShortState(event, context) {
  if (event.type === EventType.SCORING_UPDATE) {
    const { signalShort, finalScoreShort } = event.payload;

    // Downgrade to WATCH
    if (signalShort === "WATCH" && finalScoreShort >= CONFIG.watchThreshold) {
      return {
        nextState: TradeState.WATCHING_SHORT,
        reason: "Downgraded to WATCH SHORT",
        sideUpdate: "SHORT"
      };
    }

    // Abort to FLAT
    if (signalShort === "NONE" || finalScoreShort < CONFIG.minScoreToConsider) {
      return {
        nextState: TradeState.FLAT,
        reason: "ARM signal lost",
        sideUpdate: null
      };
    }
  }

  // Order placed (later phases)
  if (event.type === EventType.EXECUTION_ORDER_PLACED) {
    return {
      nextState: TradeState.ORDER_PLACED_SHORT,
      reason: "Order placed for SHORT",
      sideUpdate: "SHORT"
    };
  }

  return { nextState: null, reason: "No transition" };
}

function handleOrderPlacedState(currentState, event, context) {
  // Position opened
  if (event.type === EventType.EXECUTION_POSITION_OPENED) {
    const nextState = currentState === TradeState.ORDER_PLACED_LONG
      ? TradeState.IN_POSITION_LONG
      : TradeState.IN_POSITION_SHORT;

    return {
      nextState,
      reason: "Position opened successfully"
    };
  }

  // Order cancelled
  if (event.type === EventType.EXECUTION_ORDER_CANCELLED) {
    return {
      nextState: TradeState.COOLDOWN,
      reason: "Order cancelled",
      sideUpdate: null
    };
  }

  // Entry plan expired (TIME_TICK)
  if (event.type === EventType.TIME_TICK && context.entryPlan) {
    const now = new Date(event.payload.now);
    const validUntil = new Date(context.entryPlan.validUntil);

    if (now >= validUntil) {
      return {
        nextState: TradeState.FLAT,
        reason: "Entry plan expired",
        sideUpdate: null
      };
    }
  }

  return { nextState: null, reason: "No transition" };
}

function handlePositionStates(currentState, event, context) {
  // Auto-transition from IN_POSITION to MANAGING
  if (currentState.startsWith("IN_POSITION_") && event.type === EventType.TIME_TICK) {
    const managingState = currentState.replace("IN_POSITION", "MANAGING");
    return {
      nextState: managingState,
      reason: "Auto-transition to managing"
    };
  }

  // Position closed
  if (event.type === EventType.EXECUTION_POSITION_CLOSED) {
    return {
      nextState: TradeState.EXITED,
      reason: "Position closed"
    };
  }

  return { nextState: null, reason: "No transition" };
}

function handleExitedState(event, context) {
  // Transition to cooldown
  if (event.type === EventType.TIME_TICK) {
    return {
      nextState: TradeState.COOLDOWN,
      reason: "Entering cooldown after exit",
      sideUpdate: null
    };
  }

  return { nextState: null, reason: "No transition" };
}

function handleCooldownState(event, context) {
  if (event.type === EventType.TIME_TICK) {
    const { cooldownActive, cooldownEndsAt } = context.regimeSnapshot;

    if (cooldownActive && cooldownEndsAt) {
      const now = new Date(event.payload.now);
      const endsAt = new Date(cooldownEndsAt);

      if (now >= endsAt) {
        return {
          nextState: TradeState.FLAT,
          reason: "Cooldown period ended",
          sideUpdate: null
        };
      }
    }
  }

  return { nextState: null, reason: "Cooldown active" };
}

function handleBlockedRegimeState(event, context) {
  if (event.type === EventType.REGIME_UPDATE) {
    const { symbolRegime, globalRegime, cooldownActive } = context.regimeSnapshot;

    // Check if regime normalized
    if (
      symbolRegime === "NORMAL" &&
      globalRegime === "GLOBAL_NORMAL" &&
      !cooldownActive
    ) {
      return {
        nextState: TradeState.FLAT,
        reason: "Regime normalized",
        sideUpdate: null
      };
    }
  }

  return { nextState: null, reason: "Still blocked" };
}

function handleManualOverride(currentState, payload) {
  const { action, reason } = payload;

  switch (action) {
    case "FORCE_FLAT":
      return {
        nextState: TradeState.FLAT,
        reason: `Manual override: ${reason}`,
        sideUpdate: null
      };

    case "FORCE_COOLDOWN":
      return {
        nextState: TradeState.COOLDOWN,
        reason: `Manual cooldown: ${reason}`,
        sideUpdate: null
      };

    case "FORCE_EXIT":
      return {
        nextState: TradeState.EXITED,
        reason: `Manual exit: ${reason}`
      };

    case "FORCE_CANCEL_SCENARIO":
      return {
        nextState: TradeState.FLAT,
        reason: `Manual cancel: ${reason}`,
        sideUpdate: null
      };

    default:
      return { nextState: null, reason: "Unknown manual action" };
  }
}

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function shouldBlockRegime(context) {
  return isGloballyBlocked(context) || isSymbolBlocked(context);
}

function createEntryPlan(context, armedState, timestamp) {
  const side = armedState === TradeState.ARMED_LONG ? "LONG" : "SHORT";
  const now = new Date(timestamp);
  const validUntil = new Date(now.getTime() + CONFIG.entryPlanValidityMs);

  // Get current price from signal snapshot (placeholder)
  const idealPrice = null; // Would come from OrderbookManager

  return {
    side,
    plannedAt: timestamp,
    validUntil: validUntil.toISOString(),
    entryZone: {
      priceMin: null,
      priceMax: null
    },
    idealEntryPrice: idealPrice,
    maxSlippagePct: 0.1, // 0.1% max slippage
    initialStopLoss: null,
    initialTakeProfit1: null,
    initialTakeProfit2: null,
    qty: 0,
    leverage: 1,
    mode: "SIM" // Default to simulation mode
  };
}

// ================================================================
// EXPORTS
// ================================================================

export const StateModelConfig = CONFIG;
