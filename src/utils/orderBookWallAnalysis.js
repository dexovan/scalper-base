// ============================================================
// ORDER BOOK WALL ANALYSIS
// Detects large buy/sell walls and analyzes if they're real or fake
// Used for better entry timing and support/resistance validation
// ============================================================

/**
 * Detects large sell/buy walls in order book
 * A wall is a concentration of orders at a specific price level
 *
 * @param {Array} orderBook - Order book data from Bybit
 * @param {Object} config - { wallThreshold: 0.05 } (5% of total book size)
 * @returns {Object} - { buyWalls: [...], sellWalls: [...], largestBuyWall, largestSellWall }
 */
export function detectOrderBookWalls(orderBook, config = {}) {
  const { wallThreshold = 0.05 } = config;

  if (!orderBook || !orderBook.b || !orderBook.a) {
    return {
      buyWalls: [],
      sellWalls: [],
      largestBuyWall: null,
      largestSellWall: null,
      totalBookSize: 0
    };
  }

  const bids = orderBook.b || []; // [[price, size], ...]
  const asks = orderBook.a || [];

  // Calculate total book size
  const totalBidSize = bids.reduce((sum, [_, size]) => sum + parseFloat(size), 0);
  const totalAskSize = asks.reduce((sum, [_, size]) => sum + parseFloat(size), 0);
  const totalBookSize = totalBidSize + totalAskSize;

  const wallThresholdSize = totalBookSize * wallThreshold;

  // Detect BUY WALLS (large bid concentrations)
  const buyWalls = [];
  let largestBuyWall = null;

  for (let i = 0; i < bids.length; i++) {
    const [price, size] = bids[i];
    const sizeNum = parseFloat(size);

    if (sizeNum > wallThresholdSize) {
      const wall = {
        type: 'BUY',
        price: parseFloat(price),
        size: sizeNum,
        percentOfBook: ((sizeNum / totalBookSize) * 100).toFixed(2),
        level: i, // Distance from mid
        strength: calculateWallStrength(bids, i) // How concentrated is this wall
      };
      buyWalls.push(wall);

      if (!largestBuyWall || sizeNum > largestBuyWall.size) {
        largestBuyWall = wall;
      }
    }
  }

  // Detect SELL WALLS (large ask concentrations)
  const sellWalls = [];
  let largestSellWall = null;

  for (let i = 0; i < asks.length; i++) {
    const [price, size] = asks[i];
    const sizeNum = parseFloat(size);

    if (sizeNum > wallThresholdSize) {
      const wall = {
        type: 'SELL',
        price: parseFloat(price),
        size: sizeNum,
        percentOfBook: ((sizeNum / totalBookSize) * 100).toFixed(2),
        level: i,
        strength: calculateWallStrength(asks, i)
      };
      sellWalls.push(wall);

      if (!largestSellWall || sizeNum > largestSellWall.size) {
        largestSellWall = wall;
      }
    }
  }

  return {
    buyWalls,
    sellWalls,
    largestBuyWall,
    largestSellWall,
    totalBookSize,
    wallThresholdSize
  };
}

/**
 * Analyzes if a wall is being absorbed (fake wall being sold through)
 * Absorption = volume quickly taking out orders from the wall
 *
 * @param {Object} wallAnalysis - Result from detectOrderBookWalls
 * @param {Array} recentTrades - Recent trades from last 60 seconds
 * @param {Number} currentPrice - Current market price
 * @returns {Object} - { wallStatus: 'STRONG|WEAK|ABSORBING|BROKEN', confidenceScore, analysis }
 */
export function analyzeWallAbsorption(wallAnalysis, recentTrades = [], currentPrice = 0) {
  if (!wallAnalysis.largestBuyWall && !wallAnalysis.largestSellWall) {
    return {
      wallStatus: 'NO_WALLS',
      confidenceScore: 0,
      buyWallStatus: null,
      sellWallStatus: null
    };
  }

  const analysis = {};

  // Analyze BUY WALL (support)
  if (wallAnalysis.largestBuyWall) {
    const buyWall = wallAnalysis.largestBuyWall;
    analysis.buyWall = analyzeWallByType(buyWall, recentTrades, currentPrice, 'BUY');
  }

  // Analyze SELL WALL (resistance)
  if (wallAnalysis.largestSellWall) {
    const sellWall = wallAnalysis.largestSellWall;
    analysis.sellWall = analyzeWallByType(sellWall, recentTrades, currentPrice, 'SELL');
  }

  // Determine overall wall status
  const buyWallStatus = analysis.buyWall?.status || 'NONE';
  const sellWallStatus = analysis.sellWall?.status || 'NONE';

  // If either wall is breaking, we have a directional move
  let wallStatus = 'STABLE';
  let confidenceScore = 50;

  if (buyWallStatus === 'ABSORBING' || sellWallStatus === 'ABSORBING') {
    wallStatus = 'ABSORBING';
    confidenceScore = 70; // High confidence wall is breaking
  } else if (buyWallStatus === 'BROKEN' || sellWallStatus === 'BROKEN') {
    wallStatus = 'BROKEN';
    confidenceScore = 85; // Very high confidence
  } else if (buyWallStatus === 'STRONG' || sellWallStatus === 'STRONG') {
    wallStatus = 'STRONG';
    confidenceScore = 40; // Wall holding
  }

  return {
    wallStatus,
    confidenceScore,
    buyWallStatus,
    sellWallStatus,
    buyWallAnalysis: analysis.buyWall,
    sellWallAnalysis: analysis.sellWall
  };
}

/**
 * Internal helper - analyzes specific wall by type
 */
function analyzeWallByType(wall, recentTrades, currentPrice, wallType) {
  // Find trades that hit this wall
  const tradesHittingWall = recentTrades.filter(trade => {
    const tradePrice = parseFloat(trade.price);
    // If BUY wall (support), trades below it are hitting it
    // If SELL wall (resistance), trades above it are hitting it
    if (wallType === 'BUY') {
      return tradePrice <= wall.price && tradePrice > wall.price * 0.99; // Within 1% of wall
    } else {
      return tradePrice >= wall.price && tradePrice < wall.price * 1.01; // Within 1% of wall
    }
  });

  const volumeHittingWall = tradesHittingWall.reduce((sum, trade) => {
    return sum + parseFloat(trade.qty || 0);
  }, 0);

  const absorptionRatio = wall.size > 0 ? (volumeHittingWall / wall.size) : 0;

  let status = 'STRONG'; // Wall is strong, not absorbing
  if (absorptionRatio > 0.3) {
    status = 'ABSORBING'; // More than 30% absorbed
  }
  if (absorptionRatio > 0.7) {
    status = 'BROKEN'; // More than 70% absorbed
  }

  // Check if price is close to wall
  const distanceToWall = Math.abs(currentPrice - wall.price) / wall.price;
  const isCloseToWall = distanceToWall < 0.005; // Within 0.5%

  return {
    price: wall.price,
    size: wall.size,
    status,
    absorptionRatio: (absorptionRatio * 100).toFixed(2),
    volumeHitting: volumeHittingWall,
    isCloseToWall,
    distanceToWall: (distanceToWall * 100).toFixed(3),
    strength: wall.strength
  };
}

/**
 * Calculates wall strength (how much concentration at this level)
 * Higher = stronger wall
 */
function calculateWallStrength(levels, wallIndex) {
  if (wallIndex < 0 || wallIndex >= levels.length) return 0;

  const wallSize = parseFloat(levels[wallIndex][1]);
  const neighborhoodSize = wallSize;

  // Sum surrounding levels (3 levels before and after)
  let surroundingSum = 0;
  for (let i = Math.max(0, wallIndex - 3); i < Math.min(levels.length, wallIndex + 4); i++) {
    if (i !== wallIndex) {
      surroundingSum += parseFloat(levels[i][1]);
    }
  }

  // Strength = how much bigger is this wall compared to neighbors
  const strength = surroundingSum > 0 ? (wallSize / (surroundingSum / 6)) : 0;
  return parseFloat(strength.toFixed(2));
}

/**
 * Integrates wall analysis with price and trend data for better entry prediction
 *
 * @param {Object} wallAnalysis - Absorption analysis
 * @param {Object} priceData - { currentPrice, support, resistance, trend }
 * @returns {Object} - Integrated recommendation with entry adjustment
 */
export function integrateWallsWithPrice(wallAnalysis, priceData = {}) {
  const {
    wallStatus,
    confidenceScore,
    buyWallAnalysis,
    sellWallAnalysis
  } = wallAnalysis;

  const {
    currentPrice = 0,
    support = 0,
    resistance = 0,
    trend = 'NEUTRAL'
  } = priceData;

  let entryAdjustment = 0;
  let timingScore = 50;
  let recommendation = 'WAIT';

  // LONG scenario (trend is bullish, trying to break above resistance)
  if (trend === 'BULLISH' && sellWallAnalysis) {
    const sellWall = sellWallAnalysis;

    if (sellWall.status === 'BROKEN') {
      // Sell wall at resistance is broken - STRONG BULLISH
      recommendation = 'ENTER_LONG_NOW';
      timingScore = 90;
      entryAdjustment = sellWall.price - (sellWall.size * 0.0001); // Just below broken wall
    } else if (sellWall.status === 'ABSORBING') {
      // Sell wall is being eaten - good time to prepare
      recommendation = 'PREPARE_ENTRY';
      timingScore = 75;
      entryAdjustment = Math.min(currentPrice, sellWall.price * 0.995); // Just below wall
    } else if (sellWall.isCloseToWall) {
      // Price approaching wall - wait for absorption
      recommendation = 'MONITOR_ABSORPTION';
      timingScore = 60;
    } else {
      // Wall is strong, price far away
      recommendation = 'WAIT_FOR_APPROACH';
      timingScore = 30;
    }
  }

  // SHORT scenario (trend is bearish, trying to break below support)
  if (trend === 'BEARISH' && buyWallAnalysis) {
    const buyWall = buyWallAnalysis;

    if (buyWall.status === 'BROKEN') {
      // Buy wall at support is broken - STRONG BEARISH
      recommendation = 'ENTER_SHORT_NOW';
      timingScore = 90;
      entryAdjustment = buyWall.price + (buyWall.size * 0.0001); // Just above broken wall
    } else if (buyWall.status === 'ABSORBING') {
      // Buy wall is being eaten - good time to prepare
      recommendation = 'PREPARE_ENTRY';
      timingScore = 75;
      entryAdjustment = Math.max(currentPrice, buyWall.price * 1.005); // Just above wall
    } else if (buyWall.isCloseToWall) {
      // Price approaching wall - wait for absorption
      recommendation = 'MONITOR_ABSORPTION';
      timingScore = 60;
    } else {
      // Wall is strong, price far away
      recommendation = 'WAIT_FOR_APPROACH';
      timingScore = 30;
    }
  }

  return {
    wallStatus,
    recommendation,
    timingScore,
    confidenceScore,
    entryAdjustment,
    buyWallStatus: buyWallAnalysis?.status,
    sellWallStatus: sellWallAnalysis?.status,
    analysis: {
      buyWall: buyWallAnalysis,
      sellWall: sellWallAnalysis
    }
  };
}

/**
 * Validates support/resistance levels against actual order book walls
 * If wall exists where we think support/resistance is, that's validation
 */
export function validateSupportResistanceWithWalls(
  support,
  resistance,
  wallAnalysis,
  currentPrice
) {
  let supportValidation = {
    isValid: false,
    hasWall: false,
    wallPrice: null,
    wallSize: null,
    wallStrength: 0,
    distance: Infinity
  };

  let resistanceValidation = {
    isValid: false,
    hasWall: false,
    wallPrice: null,
    wallSize: null,
    wallStrength: 0,
    distance: Infinity
  };

  // Check if buy wall exists near support
  if (wallAnalysis.largestBuyWall) {
    const buyWall = wallAnalysis.largestBuyWall;
    const distToSupport = Math.abs(buyWall.price - support) / support;

    if (distToSupport < 0.01) {
      // Wall is within 1% of support
      supportValidation.isValid = true;
      supportValidation.hasWall = true;
      supportValidation.wallPrice = buyWall.price;
      supportValidation.wallSize = buyWall.size;
      supportValidation.wallStrength = buyWall.strength;
      supportValidation.distance = distToSupport;
    }
  }

  // Check if sell wall exists near resistance
  if (wallAnalysis.largestSellWall) {
    const sellWall = wallAnalysis.largestSellWall;
    const distToResistance = Math.abs(sellWall.price - resistance) / resistance;

    if (distToResistance < 0.01) {
      // Wall is within 1% of resistance
      resistanceValidation.isValid = true;
      resistanceValidation.hasWall = true;
      resistanceValidation.wallPrice = sellWall.price;
      resistanceValidation.wallSize = sellWall.size;
      resistanceValidation.wallStrength = sellWall.strength;
      resistanceValidation.distance = distToResistance;
    }
  }

  return {
    supportValidation,
    resistanceValidation,
    isValidated: supportValidation.isValid && resistanceValidation.isValid
  };
}
