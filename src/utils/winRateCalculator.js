// ============================================================
// WIN RATE CALCULATOR
// Calculates probability of successful trade based on:
// - Risk/Reward ratio
// - Entry positioning (support/resistance)
// - Trend strength & direction
// - Order imbalance
// - Volatility
// - Order book wall status
// - Momentum & velocity
// ============================================================

/**
 * Comprehensive win rate calculation based on ALL trading factors
 *
 * @param {Object} params - Trading parameters
 *   - riskRewardRatio: TP distance / SL distance
 *   - entryPrice, support, resistance, currentPrice
 *   - trendStrength: 0-100 (confidence in direction)
 *   - trendDirection: 'BULLISH' or 'BEARISH'
 *   - imbalance: 0.5-2.0 (1.0 = neutral, >1.0 = bullish, <1.0 = bearish)
 *   - volatility: 0.1-0.5 (as percentage, lower is better for scalping)
 *   - velocity: price change per minute (positive = up, negative = down)
 *   - wallStatus: 'STRONG' | 'ABSORBING' | 'BROKEN' | 'NO_DATA'
 *   - wallConfidence: 0-100 (how confident we are in wall analysis)
 * @returns {Object} - { winRate, factors, breakdown, recommendation }
 */
export function calculateWinRate(params) {
  const {
    riskRewardRatio = 1.0,
    entryPrice = 0,
    support = 0,
    resistance = 0,
    currentPrice = 0,
    trendStrength = 50,
    trendDirection = 'NEUTRAL',
    imbalance = 1.0,
    volatility = 0.2,
    velocity = 0,
    wallStatus = 'NO_DATA',
    wallConfidence = 0,
    positionSize = 54 // $18 margin * 3x leverage
  } = params;

  let winRate = 50; // Start with 50% baseline
  const factors = {};

  // ===== FACTOR 1: RISK/REWARD RATIO =====
  // Better R:R = Higher win rate needed but higher profit per win
  // R:R of 2:1 means we profit 2x our risk if we win
  let rrScore = 0;
  if (riskRewardRatio >= 2.0) {
    rrScore = 25; // Excellent R:R, even 40% win rate is profitable
  } else if (riskRewardRatio >= 1.5) {
    rrScore = 20; // Good R:R
  } else if (riskRewardRatio >= 1.0) {
    rrScore = 10; // OK R:R, need 50%+ win rate
  } else {
    rrScore = -10; // Poor R:R, risky
  }
  factors.rrScore = rrScore;
  winRate += rrScore;

  // ===== FACTOR 2: ENTRY POSITIONING =====
  // How close are we to support/resistance?
  // Closer to support for LONG = safer entry = higher win rate
  let entryPositionScore = 0;

  if (trendDirection === 'BULLISH') {
    // For LONG, entry should be close to support
    const distanceFromSupport = ((entryPrice - support) / support) * 100;
    const rangeSize = ((resistance - support) / support) * 100;
    const entryZonePercent = (distanceFromSupport / rangeSize) * 100;

    if (entryZonePercent < 10) {
      entryPositionScore = 20; // Excellent - at support
    } else if (entryZonePercent < 25) {
      entryPositionScore = 15; // Good - near support
    } else if (entryZonePercent < 50) {
      entryPositionScore = 5; // OK - middle of range
    } else {
      entryPositionScore = -10; // Bad - too close to resistance
    }
  } else if (trendDirection === 'BEARISH') {
    // For SHORT, entry should be close to resistance
    const distanceFromResistance = ((resistance - entryPrice) / resistance) * 100;
    const rangeSize = ((resistance - support) / resistance) * 100;
    const entryZonePercent = (distanceFromResistance / rangeSize) * 100;

    if (entryZonePercent < 10) {
      entryPositionScore = 20; // Excellent - at resistance
    } else if (entryZonePercent < 25) {
      entryPositionScore = 15; // Good - near resistance
    } else if (entryZonePercent < 50) {
      entryPositionScore = 5; // OK - middle of range
    } else {
      entryPositionScore = -10; // Bad - too close to support
    }
  }
  factors.entryPositionScore = entryPositionScore;
  winRate += entryPositionScore;

  // ===== FACTOR 3: TREND STRENGTH =====
  // How confident are we in the trend direction?
  // 0-30: Weak (not reliable)
  // 30-60: Medium (OK)
  // 60-100: Strong (very reliable)
  let trendScore = 0;
  if (trendStrength >= 70) {
    trendScore = 25; // Very strong trend
  } else if (trendStrength >= 55) {
    trendScore = 15; // Good trend
  } else if (trendStrength >= 40) {
    trendScore = 5; // Medium trend
  } else {
    trendScore = -15; // Weak trend - risky
  }
  factors.trendScore = trendScore;
  winRate += trendScore;

  // ===== FACTOR 4: IMBALANCE (Buy/Sell Pressure) =====
  // Imbalance > 1.1 = Strong buying (bullish)
  // Imbalance < 0.9 = Strong selling (bearish)
  let imbalanceScore = 0;
  const imbalanceDev = Math.abs(imbalance - 1.0);

  if (trendDirection === 'BULLISH') {
    // For LONG, we want imbalance > 1.0 (more bids)
    if (imbalance > 1.15) {
      imbalanceScore = 15; // Strong bullish imbalance
    } else if (imbalance > 1.05) {
      imbalanceScore = 10; // Mild bullish imbalance
    } else if (imbalance >= 0.95) {
      imbalanceScore = 0; // Neutral
    } else {
      imbalanceScore = -15; // Bearish imbalance (bad for LONG)
    }
  } else if (trendDirection === 'BEARISH') {
    // For SHORT, we want imbalance < 1.0 (more asks)
    if (imbalance < 0.85) {
      imbalanceScore = 15; // Strong bearish imbalance
    } else if (imbalance < 0.95) {
      imbalanceScore = 10; // Mild bearish imbalance
    } else if (imbalance <= 1.05) {
      imbalanceScore = 0; // Neutral
    } else {
      imbalanceScore = -15; // Bullish imbalance (bad for SHORT)
    }
  }
  factors.imbalanceScore = imbalanceScore;
  winRate += imbalanceScore;

  // ===== FACTOR 5: VOLATILITY =====
  // Lower volatility = more predictable = higher win rate
  // Higher volatility = more risk
  let volatilityScore = 0;
  if (volatility < 0.15) {
    volatilityScore = 15; // Very low volatility - predictable
  } else if (volatility < 0.25) {
    volatilityScore = 10; // Low volatility
  } else if (volatility < 0.35) {
    volatilityScore = 0; // Medium volatility
  } else if (volatility < 0.5) {
    volatilityScore = -10; // High volatility
  } else {
    volatilityScore = -20; // Very high volatility - risky
  }
  factors.volatilityScore = volatilityScore;
  winRate += volatilityScore;

  // ===== FACTOR 6: MOMENTUM (Velocity) =====
  // Positive velocity aligned with trend = stronger signal
  let momentumScore = 0;
  if (trendDirection === 'BULLISH') {
    // For LONG, we want positive velocity (price going up)
    if (velocity > 0.05) {
      momentumScore = 15; // Strong upward momentum
    } else if (velocity > 0.02) {
      momentumScore = 10; // Good upward momentum
    } else if (velocity > -0.02) {
      momentumScore = 0; // Neutral
    } else {
      momentumScore = -20; // Strong downward momentum (bad for LONG)
    }
  } else if (trendDirection === 'BEARISH') {
    // For SHORT, we want negative velocity (price going down)
    if (velocity < -0.05) {
      momentumScore = 15; // Strong downward momentum
    } else if (velocity < -0.02) {
      momentumScore = 10; // Good downward momentum
    } else if (velocity < 0.02) {
      momentumScore = 0; // Neutral
    } else {
      momentumScore = -20; // Strong upward momentum (bad for SHORT)
    }
  }
  factors.momentumScore = momentumScore;
  winRate += momentumScore;

  // ===== FACTOR 7: ORDER BOOK WALL STATUS =====
  // Walls validating our entry = higher confidence
  let wallScore = 0;
  if (wallStatus === 'BROKEN') {
    wallScore = 20; // Wall is broken - strong signal
  } else if (wallStatus === 'ABSORBING') {
    wallScore = 15; // Wall is absorbing volume - trend continuing
  } else if (wallStatus === 'STRONG') {
    wallScore = -5; // Strong wall might stop us (risk)
  } else {
    wallScore = 0; // No wall data
  }

  // Reduce wall score if confidence is low
  const wallWeighting = (wallConfidence / 100) * 0.5 + 0.5; // 0.5-1.0
  wallScore = wallScore * wallWeighting;

  factors.wallScore = wallScore;
  winRate += wallScore;

  // ===== APPLY CAPS =====
  // Win rate should stay between 20% and 95%
  // (Never 100% - there's always risk)
  winRate = Math.max(20, Math.min(95, winRate));

  // ===== EXPECTED VALUE CALCULATION =====
  // EV = (Win% * Profit per win) - (Loss% * Loss per loss)
  const winProbability = winRate / 100;
  const lossProbability = 1 - winProbability;

  // Assuming average profit per win = $positionSize * riskRewardRatio
  const profitPerWin = positionSize * Math.max(0.001, riskRewardRatio); // min $0.05
  const lossPerLoss = positionSize; // lose the full position (1:1 risk)

  const expectedValue = winProbability * profitPerWin - lossProbability * lossPerLoss;
  const expectedValuePercent = (expectedValue / positionSize) * 100;

  // ===== RECOMMENDATION =====
  let recommendation = '';
  let riskLevel = '';

  if (winRate >= 65) {
    recommendation = '🚀 ODLIČAN SETUP - Visoka šansa za profit!';
    riskLevel = 'LOW RISK';
  } else if (winRate >= 55) {
    recommendation = '✅ DOBAR SETUP - Uđi sa povjerenjem';
    riskLevel = 'MEDIUM RISK';
  } else if (winRate >= 45) {
    recommendation = '⏳ NEUTRALAN SETUP - Mogu, ali čekaj bolji signal';
    riskLevel = 'MEDIUM RISK';
  } else if (winRate >= 35) {
    recommendation = '⚠️ SLAB SETUP - Previše rizika, čekaj';
    riskLevel = 'HIGH RISK';
  } else {
    recommendation = '❌ LOŠ SETUP - Izbjegni ovaj trade!';
    riskLevel = 'VERY HIGH RISK';
  }

  return {
    winRate: parseFloat(winRate.toFixed(2)),
    expectedValuePercent: parseFloat(expectedValuePercent.toFixed(2)),
    riskLevel,
    recommendation,
    factors: {
      riskReward: rrScore,
      entryPosition: entryPositionScore,
      trendStrength: trendScore,
      imbalance: imbalanceScore,
      volatility: volatilityScore,
      momentum: momentumScore,
      wallAnalysis: wallScore
    },
    breakdown: `
      RR: ${rrScore > 0 ? '+' : ''}${rrScore} |
      Entry: ${entryPositionScore > 0 ? '+' : ''}${entryPositionScore} |
      Trend: ${trendScore > 0 ? '+' : ''}${trendScore} |
      Imbalance: ${imbalanceScore > 0 ? '+' : ''}${imbalanceScore} |
      Vol: ${volatilityScore > 0 ? '+' : ''}${volatilityScore} |
      Momentum: ${momentumScore > 0 ? '+' : ''}${momentumScore} |
      Walls: ${wallScore > 0 ? '+' : ''}${wallScore.toFixed(1)}
    `
  };
}

/**
 * Calculate position sizing based on win rate and risk tolerance
 */
export function calculatePositionSize(winRate, accountSize = 100, riskPercent = 2) {
  // Risk 2% of account per trade (industry standard)
  const riskAmount = (accountSize * riskPercent) / 100;

  // Adjust risk based on win rate
  // High win rate = can risk more per trade
  // Low win rate = must risk less
  const riskAdjustment =
    winRate >= 65 ? 1.5 : // High win rate - can risk 1.5x more
    winRate >= 55 ? 1.0 : // Normal risk
    winRate >= 45 ? 0.7 : // Conservative
    0.5; // Very conservative

  const adjustedRisk = riskAmount * riskAdjustment;

  return {
    baseRisk: riskAmount,
    adjustedRisk: adjustedRisk,
    positionSizeUSD: adjustedRisk * 3, // 3x leverage (our default)
    recommendation:
      winRate >= 65 ? 'Možeš uzeti veću poziciju' :
      winRate >= 55 ? 'Standardna pozicija' :
      winRate >= 45 ? 'Manja pozicija (biti oprezan)' :
      'Izbjegni trade ili mini pozicija'
  };
}
