// ============================================================
// SAFETY CHECKS FOR LIVE TRADING
// Pre-execution validation to prevent bad trades
// ============================================================

// ============================================================
// CONFIGURATION
// ============================================================

const SAFETY_CONFIG = {
  // Profit requirements
  minProfitPercent: 0.15,        // Min 0.15% TP (covers fees + slippage + profit)
  minFeesCovered: 0.08,          // Min 0.08% to cover spread + fees

  // Market conditions
  maxHeat: -10000,               // Skip if orderFlowNet < -$10k (heavy selling)
  maxVolatility: 2.5,            // Skip if volatility > 2.5%
  minLiquidity: 5000,            // Min $5k orderbook depth (both sides) - realistic for altcoins

  // Anti-scam protection
  antiPump: {
    enabled: true,
    maxPriceChange5m: 15,        // Skip if +15% in 5 min
    maxPriceChange15m: 30        // Skip if +30% in 15 min
  },

  antiRug: {
    enabled: true,
    minListingAge: 30,           // Skip if listing < 30 days old
    minVolume24h: 500000         // Skip if 24h volume < $500k
  },

  antiLowLiquidity: {
    enabled: true,
    minBidDepth: 2500,           // Min $2.5k bid side
    minAskDepth: 2500            // Min $2.5k ask side
  },  // Position management
  maxOnePerSymbol: true,         // Only 1 position per symbol
  maxTotalPositions: 3,          // Max 3 total positions
  autoCloseTimeout: 45000        // Auto-close if not filled in 45s
};

// ============================================================
// CHECK: Minimum Profit Requirement
// ============================================================

export function checkMinProfit(tp, sl, entry) {
  const tpPercent = Math.abs((tp - entry) / entry * 100);
  const slPercent = Math.abs((sl - entry) / entry * 100);

  // TP must be at least minProfitPercent
  if (tpPercent < SAFETY_CONFIG.minProfitPercent) {
    return {
      passed: false,
      reason: `TP too small (${tpPercent.toFixed(3)}% < ${SAFETY_CONFIG.minProfitPercent}%)`,
      tpPercent,
      slPercent
    };
  }

  // Risk/Reward should be positive (TP > SL)
  if (tpPercent <= slPercent) {
    return {
      passed: false,
      reason: `Risk/Reward negative (TP ${tpPercent.toFixed(3)}% <= SL ${slPercent.toFixed(3)}%)`,
      tpPercent,
      slPercent
    };
  }

  return {
    passed: true,
    tpPercent,
    slPercent,
    riskReward: (tpPercent / slPercent).toFixed(2)
  };
}

// ============================================================
// CHECK: Market Heat (Order Flow)
// ============================================================

export function checkMarketHeat(orderFlowNet) {
  // If heavy selling pressure (net flow < -$10k), skip
  if (orderFlowNet !== null && orderFlowNet < SAFETY_CONFIG.maxHeat) {
    return {
      passed: false,
      reason: `Heavy selling pressure (flow: $${orderFlowNet.toFixed(0)})`,
      orderFlowNet
    };
  }

  return {
    passed: true,
    orderFlowNet
  };
}

// ============================================================
// CHECK: Volatility Limit
// ============================================================

export function checkVolatility(volatility) {
  // Skip if volatility too high (unpredictable price action)
  if (volatility > SAFETY_CONFIG.maxVolatility) {
    return {
      passed: false,
      reason: `Volatility too high (${volatility.toFixed(2)}% > ${SAFETY_CONFIG.maxVolatility}%)`,
      volatility
    };
  }

  return {
    passed: true,
    volatility
  };
}

// ============================================================
// CHECK: Liquidity Depth
// ============================================================

export function checkLiquidity(bidDepth, askDepth) {
  const totalDepth = bidDepth + askDepth;

  // Check total liquidity
  if (totalDepth < SAFETY_CONFIG.minLiquidity) {
    return {
      passed: false,
      reason: `Low liquidity ($${totalDepth.toFixed(0)} < $${SAFETY_CONFIG.minLiquidity})`,
      bidDepth,
      askDepth,
      totalDepth
    };
  }

  // Check bid side
  if (SAFETY_CONFIG.antiLowLiquidity.enabled && bidDepth < SAFETY_CONFIG.antiLowLiquidity.minBidDepth) {
    return {
      passed: false,
      reason: `Low bid depth ($${bidDepth.toFixed(0)} < $${SAFETY_CONFIG.antiLowLiquidity.minBidDepth})`,
      bidDepth,
      askDepth
    };
  }

  // Check ask side
  if (SAFETY_CONFIG.antiLowLiquidity.enabled && askDepth < SAFETY_CONFIG.antiLowLiquidity.minAskDepth) {
    return {
      passed: false,
      reason: `Low ask depth ($${askDepth.toFixed(0)} < $${SAFETY_CONFIG.antiLowLiquidity.minAskDepth})`,
      bidDepth,
      askDepth
    };
  }

  return {
    passed: true,
    bidDepth,
    askDepth,
    totalDepth
  };
}

// ============================================================
// CHECK: Anti-Pump Protection
// ============================================================

export function checkAntiPump(priceChange5m, priceChange15m) {
  if (!SAFETY_CONFIG.antiPump.enabled) {
    return { passed: true };
  }

  // Check 5 min pump
  if (Math.abs(priceChange5m) > SAFETY_CONFIG.antiPump.maxPriceChange5m) {
    return {
      passed: false,
      reason: `Pump detected (${priceChange5m.toFixed(2)}% in 5m > ${SAFETY_CONFIG.antiPump.maxPriceChange5m}%)`,
      priceChange5m,
      priceChange15m
    };
  }

  // Check 15 min pump
  if (priceChange15m !== null && Math.abs(priceChange15m) > SAFETY_CONFIG.antiPump.maxPriceChange15m) {
    return {
      passed: false,
      reason: `Large pump (${priceChange15m.toFixed(2)}% in 15m > ${SAFETY_CONFIG.antiPump.maxPriceChange15m}%)`,
      priceChange5m,
      priceChange15m
    };
  }

  return {
    passed: true,
    priceChange5m,
    priceChange15m
  };
}

// ============================================================
// CHECK: Anti-Rug Protection
// ============================================================

export function checkAntiRug(listingAge, volume24h) {
  if (!SAFETY_CONFIG.antiRug.enabled) {
    return { passed: true };
  }

  // Check listing age (skip new listings)
  if (listingAge !== null && listingAge < SAFETY_CONFIG.antiRug.minListingAge) {
    return {
      passed: false,
      reason: `New listing (${listingAge} days < ${SAFETY_CONFIG.antiRug.minListingAge} days)`,
      listingAge,
      volume24h
    };
  }

  // Check 24h volume (skip low volume coins)
  if (volume24h !== null && volume24h < SAFETY_CONFIG.antiRug.minVolume24h) {
    return {
      passed: false,
      reason: `Low 24h volume ($${(volume24h/1000).toFixed(0)}k < $${(SAFETY_CONFIG.antiRug.minVolume24h/1000).toFixed(0)}k)`,
      listingAge,
      volume24h
    };
  }

  return {
    passed: true,
    listingAge,
    volume24h
  };
}

// ============================================================
// CHECK: Position Limits
// ============================================================

export function checkPositionLimits(symbol, activePositions) {
  // Check max one position per symbol
  if (SAFETY_CONFIG.maxOnePerSymbol) {
    const existingPosition = activePositions.find(p => p.symbol === symbol);
    if (existingPosition) {
      return {
        passed: false,
        reason: `Already in position on ${symbol}`,
        existingPosition
      };
    }
  }

  // Check max total positions
  if (activePositions.length >= SAFETY_CONFIG.maxTotalPositions) {
    return {
      passed: false,
      reason: `Max positions reached (${activePositions.length}/${SAFETY_CONFIG.maxTotalPositions})`,
      activeCount: activePositions.length
    };
  }

  return {
    passed: true,
    activeCount: activePositions.length
  };
}

// ============================================================
// RUN ALL SAFETY CHECKS
// ============================================================

export function runAllSafetyChecks(signal, liveData, activePositions) {
  const checks = {
    minProfit: checkMinProfit(signal.tp, signal.sl, signal.entry),
    marketHeat: checkMarketHeat(liveData.orderFlowNet60s),
    volatility: checkVolatility(liveData.volatility || 0),
    liquidity: checkLiquidity(liveData.bidDepth || 0, liveData.askDepth || 0),
    antiPump: checkAntiPump(liveData.priceChange5m || 0, liveData.priceChange15m || 0),
    antiRug: checkAntiRug(liveData.listingAge, liveData.volume24h),
    positionLimits: checkPositionLimits(signal.symbol, activePositions)
  };

  // Collect failed checks
  const failed = Object.entries(checks)
    .filter(([key, result]) => !result.passed)
    .map(([key, result]) => ({ check: key, reason: result.reason }));

  const allPassed = failed.length === 0;

  return {
    passed: allPassed,
    checks,
    failed,
    summary: allPassed
      ? 'All safety checks passed'
      : `Failed: ${failed.map(f => f.check).join(', ')}`
  };
}

// Export config for external modification
export { SAFETY_CONFIG };

export default {
  checkMinProfit,
  checkMarketHeat,
  checkVolatility,
  checkLiquidity,
  checkAntiPump,
  checkAntiRug,
  checkPositionLimits,
  runAllSafetyChecks,
  SAFETY_CONFIG
};
