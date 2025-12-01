// ================================================================
// src/execution/tpslPlanner.js
// TP/SL PLANNER - Calculate initial TP1/TP2/SL/BE levels
// ================================================================

/**
 * Default TP/SL configuration
 */
const DEFAULT_CONFIG = {
  // TP/SL targets - SCALPING TIGHT LEVELS
  tp1DistancePct: 0.15,           // TP1 at +0.15% from entry (tight scalp)
  tp2DistancePct: 0.35,           // TP2 at +0.35% from entry (medium scalp)
  slDistancePct: 0.10,            // SL at -0.10% from entry (tight SL)

  // Break-even
  breakEvenBufferPct: 0.02,       // Additional buffer above fee cost (+0.02%)

  // Trailing
  trailingDistancePct: 0.10,      // Default trailing distance

  // Pump overrides
  pumpTp1Multiplier: 1.5,         // Wider TP1 during pump
  pumpTp2Multiplier: 2.0,         // Wider TP2 during pump
  pumpTightenFactor: 0.6,         // Tighter trailing during BLOWOFF

  // Spoofing overrides
  spoofingSlMultiplier: 1.3,      // Wider SL if spoofing detected

  // Volatility overrides
  highVolatilityFactor: 1.4,      // Wider trailing in high volatility
  lowVolatilityFactor: 0.8,       // Tighter trailing in low volatility

  // Safety
  minimalTickSizeSafety: 3        // Minimum 3 ticks between entry and SL
};

let config = { ...DEFAULT_CONFIG };

/**
 * Initialize TP/SL planner with custom config
 * @param {Object} customConfig
 */
export function initTpslPlanner(customConfig = {}) {
  config = { ...DEFAULT_CONFIG, ...customConfig };
  console.log('[TpslPlanner] Initialized with config:', config);
}

/**
 * Plan initial TP/SL levels for a new position
 * @param {Object} params
 * @param {string} params.symbol
 * @param {string} params.side - "LONG" or "SHORT"
 * @param {number} params.entryPrice
 * @param {number} params.qty
 * @param {number} params.leverage
 * @param {Object} params.featureState - From FeatureEngine
 * @param {Object} params.regimeState - From RegimeEngine
 * @returns {Object} TP/SL plan
 */
export function planTpSlLevels(params) {
  const { symbol, side, entryPrice, qty, leverage, featureState, regimeState } = params;

  console.log(`[TpslPlanner] Planning TP/SL for ${symbol} ${side} @ ${entryPrice}`);

  // Get fee-first break-even level
  const minMoveForProfit = featureState?.feeLeverageFeatures?.minMoveForProfitMaker || 0.10;
  const breakEvenPct = minMoveForProfit + config.breakEvenBufferPct;

  // Calculate base TP/SL distances
  let tp1Pct = config.tp1DistancePct;
  let tp2Pct = config.tp2DistancePct;
  let slPct = config.slDistancePct;
  let trailingPct = config.trailingDistancePct;

  // PUMP OVERRIDE: Wider TPs during pump
  const isPump = regimeState?.regimeType === 'PUMP';
  const pumpState = regimeState?.pumpState;

  if (isPump && (pumpState === 'PREPUMP' || pumpState === 'PUMPING')) {
    tp1Pct *= config.pumpTp1Multiplier;
    tp2Pct *= config.pumpTp2Multiplier;
    console.log(`[TpslPlanner] ${symbol} PUMP detected - widening TPs: TP1=${tp1Pct.toFixed(2)}%, TP2=${tp2Pct.toFixed(2)}%`);
  }

  // SPOOFING OVERRIDE: Wider SL if spoofing detected
  const spoofingScore = featureState?.spoofingFeatures?.spoofingScore || 0;
  if (spoofingScore > 0.6) {
    slPct *= config.spoofingSlMultiplier;
    console.log(`[TpslPlanner] ${symbol} Spoofing detected (${spoofingScore.toFixed(2)}) - widening SL: ${slPct.toFixed(2)}%`);
  }

  // VOLATILITY OVERRIDE: Adjust trailing based on volatility
  const volatilityScore = featureState?.volatilityFeatures?.volatilityScore || 0.5;
  if (volatilityScore > 0.7) {
    trailingPct *= config.highVolatilityFactor;
    console.log(`[TpslPlanner] ${symbol} High volatility (${volatilityScore.toFixed(2)}) - widening trailing: ${trailingPct.toFixed(2)}%`);
  } else if (volatilityScore < 0.3) {
    trailingPct *= config.lowVolatilityFactor;
    console.log(`[TpslPlanner] ${symbol} Low volatility (${volatilityScore.toFixed(2)}) - tightening trailing: ${trailingPct.toFixed(2)}%`);
  }

  // Calculate actual price levels
  let tp1Price, tp2Price, slPrice, breakEvenPrice;

  if (side === 'LONG') {
    tp1Price = entryPrice * (1 + tp1Pct / 100);
    tp2Price = entryPrice * (1 + tp2Pct / 100);
    slPrice = entryPrice * (1 - slPct / 100);
    breakEvenPrice = entryPrice * (1 + breakEvenPct / 100);
  } else { // SHORT
    tp1Price = entryPrice * (1 - tp1Pct / 100);
    tp2Price = entryPrice * (1 - tp2Pct / 100);
    slPrice = entryPrice * (1 + slPct / 100);
    breakEvenPrice = entryPrice * (1 - breakEvenPct / 100);
  }

  // Ensure TP1 is beyond break-even (fee-first principle)
  if (side === 'LONG' && tp1Price < breakEvenPrice) {
    tp1Price = breakEvenPrice * 1.001; // 0.1% above BE
    console.log(`[TpslPlanner] ${symbol} TP1 adjusted to be above break-even: ${tp1Price.toFixed(6)}`);
  } else if (side === 'SHORT' && tp1Price > breakEvenPrice) {
    tp1Price = breakEvenPrice * 0.999; // 0.1% below BE
    console.log(`[TpslPlanner] ${symbol} TP1 adjusted to be below break-even: ${tp1Price.toFixed(6)}`);
  }

  // Tick size safety check (if available)
  const tickSize = featureState?.tickSize || 0.01;
  const minSlDistance = config.minimalTickSizeSafety * tickSize;
  const actualSlDistance = Math.abs(entryPrice - slPrice);

  if (actualSlDistance < minSlDistance) {
    if (side === 'LONG') {
      slPrice = entryPrice - minSlDistance;
    } else {
      slPrice = entryPrice + minSlDistance;
    }
    console.log(`[TpslPlanner] ${symbol} SL adjusted for tick safety: ${slPrice.toFixed(6)}`);
  }

  // Calculate QUICK TP (fee cost + small buffer for immediate profit taking)
  // This activates much earlier than TP1 to take quick scalp profits
  const quickTpBufferPct = 0.05; // 0.05% additional buffer above break-even
  let quickTpPrice;
  if (side === 'LONG') {
    quickTpPrice = breakEvenPrice * (1 + quickTpBufferPct / 100);
  } else {
    quickTpPrice = breakEvenPrice * (1 - quickTpBufferPct / 100);
  }

  const plan = {
    symbol,
    side,
    entryPrice,
    tp1Price,
    tp2Price,
    slPrice,
    breakEvenPrice,
    quickTpPrice,  // Quick scalp profit target
    trailingDistancePct: trailingPct,

    // Percentages for display
    tp1Pct: side === 'LONG' ? ((tp1Price / entryPrice - 1) * 100) : ((1 - tp1Price / entryPrice) * 100),
    tp2Pct: side === 'LONG' ? ((tp2Price / entryPrice - 1) * 100) : ((1 - tp2Price / entryPrice) * 100),
    slPct: side === 'LONG' ? ((1 - slPrice / entryPrice) * 100) : ((slPrice / entryPrice - 1) * 100),
    breakEvenPct,

    // Override flags
    pumpOverrideApplied: isPump,
    spoofingOverrideApplied: spoofingScore > 0.6,
    volatilityOverrideApplied: volatilityScore > 0.7 || volatilityScore < 0.3,

    createdAt: new Date().toISOString()
  };

  console.log(`[TpslPlanner] ${symbol} Plan created:`, {
    entry: entryPrice.toFixed(6),
    tp1: tp1Price.toFixed(6),
    tp2: tp2Price.toFixed(6),
    sl: slPrice.toFixed(6),
    be: breakEvenPrice.toFixed(6)
  });

  return plan;
}

/**
 * Get current config
 * @returns {Object}
 */
export function getTpslConfig() {
  return { ...config };
}

/**
 * Update config
 * @param {Object} newConfig
 */
export function updateTpslConfig(newConfig) {
  config = { ...config, ...newConfig };
  console.log('[TpslPlanner] Config updated:', config);
}
