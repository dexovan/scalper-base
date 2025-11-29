/**
 * STATE EVENTS - Event Types and Payload Structures
 * Phase 7: State Machine per Symbol
 */

// ================================================================
// EVENT TYPE ENUMS
// ================================================================

export const EventType = {
  SCORING_UPDATE: "SCORING_UPDATE",
  REGIME_UPDATE: "REGIME_UPDATE",
  RISK_UPDATE: "RISK_UPDATE",
  TIME_TICK: "TIME_TICK",
  EXECUTION_ORDER_PLACED: "EXECUTION_ORDER_PLACED",
  EXECUTION_ORDER_FILLED: "EXECUTION_ORDER_FILLED",
  EXECUTION_ORDER_CANCELLED: "EXECUTION_ORDER_CANCELLED",
  EXECUTION_POSITION_OPENED: "EXECUTION_POSITION_OPENED",
  EXECUTION_POSITION_CLOSED: "EXECUTION_POSITION_CLOSED",
  TPSL_TP1_HIT: "TPSL_TP1_HIT",
  TPSL_TP2_HIT: "TPSL_TP2_HIT",
  TPSL_SL_HIT: "TPSL_SL_HIT",
  TPSL_TRAILING_ACTIVATED: "TPSL_TRAILING_ACTIVATED",
  MANUAL_OVERRIDE: "MANUAL_OVERRIDE"
};

// ================================================================
// TRADE STATE ENUMS (per symbol)
// ================================================================

export const TradeState = {
  FLAT: "FLAT",
  WATCHING_LONG: "WATCHING_LONG",
  WATCHING_SHORT: "WATCHING_SHORT",
  ARMED_LONG: "ARMED_LONG",
  ARMED_SHORT: "ARMED_SHORT",
  ORDER_PLACED_LONG: "ORDER_PLACED_LONG",
  ORDER_PLACED_SHORT: "ORDER_PLACED_SHORT",
  IN_POSITION_LONG: "IN_POSITION_LONG",
  IN_POSITION_SHORT: "IN_POSITION_SHORT",
  MANAGING_LONG: "MANAGING_LONG",
  MANAGING_SHORT: "MANAGING_SHORT",
  EXITED: "EXITED",
  COOLDOWN: "COOLDOWN",
  BLOCKED_REGIME: "BLOCKED_REGIME",
  PAUSED_MANUAL: "PAUSED_MANUAL"
};

// ================================================================
// STATE EVENT STRUCTURE
// ================================================================

/**
 * Base structure for all state events
 * @typedef {Object} StateEvent
 * @property {string} type - EventType enum value
 * @property {string} symbol - Symbol name (e.g., "BTCUSDT")
 * @property {string} timestamp - ISO datetime string
 * @property {Object} payload - Event-specific data
 */

// ================================================================
// PAYLOAD FACTORIES
// ================================================================

/**
 * Create SCORING_UPDATE event payload
 * @param {number} finalScoreLong
 * @param {number} finalScoreShort
 * @param {string} signalLong - "NONE" | "WATCH" | "ARM"
 * @param {string} signalShort - "NONE" | "WATCH" | "ARM"
 * @returns {Object}
 */
export function createScoringUpdatePayload(finalScoreLong, finalScoreShort, signalLong, signalShort) {
  return {
    finalScoreLong,
    finalScoreShort,
    signalLong,
    signalShort,
    fromScoringEngine: true
  };
}

/**
 * Create REGIME_UPDATE event payload
 * @param {string} symbolRegime - "NORMAL", "PUMP", "MANIPULATED", etc.
 * @param {string} globalRegime - "GLOBAL_NORMAL", "GLOBAL_RISK_OFF", "GLOBAL_PANIC"
 * @param {boolean} cooldownActive
 * @param {string|null} cooldownEndsAt - ISO datetime or null
 * @returns {Object}
 */
export function createRegimeUpdatePayload(symbolRegime, globalRegime, cooldownActive, cooldownEndsAt) {
  return {
    symbolRegime,
    globalRegime,
    cooldownActive,
    cooldownEndsAt
  };
}

/**
 * Create RISK_UPDATE event payload (stub for Phase 7)
 * @param {boolean} riskAllowNewPositions
 * @param {boolean} riskAllowNewLong
 * @param {boolean} riskAllowNewShort
 * @returns {Object}
 */
export function createRiskUpdatePayload(riskAllowNewPositions = true, riskAllowNewLong = true, riskAllowNewShort = true) {
  return {
    riskAllowNewPositions,
    riskAllowNewLong,
    riskAllowNewShort
  };
}

/**
 * Create TIME_TICK event payload
 * @param {string} now - ISO datetime
 * @returns {Object}
 */
export function createTimeTickPayload(now) {
  return { now };
}

/**
 * Create MANUAL_OVERRIDE event payload
 * @param {string} action - "FORCE_EXIT" | "FORCE_CANCEL_SCENARIO" | "FORCE_COOLDOWN" | "FORCE_FLAT"
 * @param {string} reason - Human-readable reason
 * @returns {Object}
 */
export function createManualOverridePayload(action, reason) {
  return { action, reason };
}

/**
 * Create TPSL_TP1_HIT event payload
 * @param {string} symbol - Symbol name
 * @param {string} side - "LONG" or "SHORT"
 * @param {number} tp1Price - TP1 price level
 * @param {number} currentPrice - Current price when TP1 hit
 * @param {number} partialCloseQty - Quantity to close (50% of position)
 * @returns {Object}
 */
export function createTpslTp1HitPayload(symbol, side, tp1Price, currentPrice, partialCloseQty) {
  return {
    symbol,
    side,
    tp1Price,
    currentPrice,
    partialCloseQty,
    action: 'PARTIAL_CLOSE_50'
  };
}

/**
 * Create TPSL_TP2_HIT event payload
 * @param {string} symbol - Symbol name
 * @param {string} side - "LONG" or "SHORT"
 * @param {number} tp2Price - TP2 price level
 * @param {number} currentPrice - Current price when TP2 hit
 * @returns {Object}
 */
export function createTpslTp2HitPayload(symbol, side, tp2Price, currentPrice) {
  return {
    symbol,
    side,
    tp2Price,
    currentPrice,
    action: 'CLOSE_REMAINING'
  };
}

/**
 * Create TPSL_SL_HIT event payload
 * @param {string} symbol - Symbol name
 * @param {string} side - "LONG" or "SHORT"
 * @param {number} slPrice - Stop loss price level
 * @param {number} currentPrice - Current price when SL hit
 * @returns {Object}
 */
export function createTpslSlHitPayload(symbol, side, slPrice, currentPrice) {
  return {
    symbol,
    side,
    slPrice,
    currentPrice,
    action: 'CLOSE_LOSS'
  };
}

/**
 * Create TPSL_TRAILING_ACTIVATED event payload
 * @param {string} symbol - Symbol name
 * @param {string} side - "LONG" or "SHORT"
 * @param {number} trailingDistancePct - Trailing distance in percentage
 * @returns {Object}
 */
export function createTpslTrailingActivatedPayload(symbol, side, trailingDistancePct) {
  return {
    symbol,
    side,
    trailingDistancePct
  };
}

// ================================================================
// EVENT FACTORY (creates complete StateEvent object)
// ================================================================

/**
 * Create a StateEvent
 * @param {string} type - EventType enum value
 * @param {string} symbol - Symbol name
 * @param {Object} payload - Event-specific payload
 * @param {string} [timestamp] - Optional ISO timestamp (defaults to now)
 * @returns {StateEvent}
 */
export function createStateEvent(type, symbol, payload, timestamp = null) {
  return {
    type,
    symbol,
    timestamp: timestamp || new Date().toISOString(),
    payload
  };
}

// ================================================================
// VALIDATION HELPERS
// ================================================================

/**
 * Validate if event type is valid
 * @param {string} type
 * @returns {boolean}
 */
export function isValidEventType(type) {
  return Object.values(EventType).includes(type);
}

/**
 * Validate if trade state is valid
 * @param {string} state
 * @returns {boolean}
 */
export function isValidTradeState(state) {
  return Object.values(TradeState).includes(state);
}
