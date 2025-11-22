    # FAZA 4 – IMPLEMENTATION PLAN

## AI Scalper Project – Phase 4 Strategy & Technical Roadmap

---

## 📋 TABLE OF CONTENTS

1. [Phase Overview](#overview)
2. [FAZA 5: Regime Engine](#faza5)
3. [FAZA 6: Scoring System](#faza6)
4. [FAZA 7: State Machine](#faza7)
5. [FAZA 8: Risk Management](#faza8)
6. [FAZA 9: TP/SL Engine](#faza9)
7. [Implementation Timeline](#timeline)
8. [Success Criteria](#success)

---

## 🎯 1. PHASE OVERVIEW {#overview}

**Primary Goal:** Build complete AI trading decision-making and execution system

**Key Deliverables:**

- ✅ Regime detection for market context awareness
- ✅ Multi-factor signal scoring system
- ✅ Trade lifecycle state machine
- ✅ Risk management and position sizing
- ✅ Dynamic TP/SL calculation engine
- ✅ Paper trading simulation mode
- ✅ Performance analytics dashboard

**Foundation from Phase 3:**

- Real-time orderbook imbalance (<100ms)
- Flow delta tracking (98% accuracy)
- Microcandles (15s/1m/5m timeframes)
- Memory-optimized architecture (65MB RAM)
- Stable disk usage (9% / 3GB)

---

## 🏗️ 2. FAZA 5: REGIME ENGINE {#faza5}

### 2.1 Objective

**Detect and classify current market conditions to adapt trading strategy**

**Regime Types:**

1. **Trending:** Clear directional movement (bull/bear)
2. **Ranging:** Sideways consolidation within bounds
3. **Volatile:** High volatility, unpredictable swings
4. **Quiet:** Low volume, tight ranges

### 2.2 Technical Implementation

**File:** `src/regime/regimeEngine.js`

**Core Functions:**

```javascript
// Regime classification
function detectRegime(symbol) {
  const candles = getCandleHistory(symbol, "5m", 20); // Last 100 minutes

  // 1. Trend Detection
  const trendScore = calculateTrendStrength(candles);

  // 2. Volatility Analysis
  const volatility = calculateVolatility(candles);

  // 3. Volume Profile
  const volumeRegime = analyzeVolume(candles);

  // 4. Range Detection
  const rangeData = detectTradingRange(candles);

  return {
    regime: classifyRegime(trendScore, volatility, rangeData),
    confidence: calculateConfidence(trendScore, volatility, volumeRegime),
    metadata: { trendScore, volatility, volumeRegime, rangeData },
  };
}
```

**Trend Strength Calculation:**

```javascript
function calculateTrendStrength(candles) {
  // Method 1: Price momentum (20-period)
  const prices = candles.map((c) => c.close);
  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const priceChange = (lastPrice - firstPrice) / firstPrice;

  // Method 2: Higher highs / lower lows count
  let hhCount = 0,
    llCount = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].high > candles[i - 1].high) hhCount++;
    if (candles[i].low < candles[i - 1].low) llCount++;
  }

  // Method 3: ADX-like directional movement
  const upMoves = candles.filter(
    (c, i) => i > 0 && c.close > candles[i - 1].close
  ).length;
  const downMoves = candles.filter(
    (c, i) => i > 0 && c.close < candles[i - 1].close
  ).length;
  const directionalBias = (upMoves - downMoves) / candles.length;

  // Combine factors
  return {
    momentum: priceChange,
    hhll_ratio: hhCount > llCount ? hhCount / llCount : -(llCount / hhCount),
    directional: directionalBias,
    strength: Math.abs(priceChange) + Math.abs(directionalBias),
  };
}
```

**Volatility Calculation:**

```javascript
function calculateVolatility(candles) {
  // Method 1: True Range average
  const trueRanges = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const high = c.high;
    const low = c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
  });
  const avgTR = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
  const currentPrice = candles[candles.length - 1].close;
  const atrPercent = (avgTR / currentPrice) * 100;

  // Method 2: Standard deviation of returns
  const returns = candles.map((c, i) => {
    if (i === 0) return 0;
    return (c.close - candles[i - 1].close) / candles[i - 1].close;
  });
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
    returns.length;
  const stdDev = Math.sqrt(variance) * 100; // Percentage

  return {
    atr_percent: atrPercent,
    std_dev: stdDev,
    classification:
      atrPercent > 3 ? "HIGH" : atrPercent > 1.5 ? "MEDIUM" : "LOW",
  };
}
```

**Regime Classification:**

```javascript
function classifyRegime(trendScore, volatility, rangeData) {
  const { strength } = trendScore;
  const { classification } = volatility;
  const { isRanging, rangeStrength } = rangeData;

  // Strong trend + medium/high volatility = TRENDING
  if (strength > 0.02 && classification !== "LOW") {
    return {
      type: "TRENDING",
      direction: trendScore.momentum > 0 ? "BULLISH" : "BEARISH",
      volatility: classification,
    };
  }

  // Low volatility + range detected = RANGING
  if (isRanging && classification === "LOW") {
    return {
      type: "RANGING",
      support: rangeData.support,
      resistance: rangeData.resistance,
      volatility: classification,
    };
  }

  // High volatility + no clear trend = VOLATILE
  if (classification === "HIGH" && strength < 0.015) {
    return {
      type: "VOLATILE",
      volatility: classification,
      warning: "Unpredictable movements expected",
    };
  }

  // Low volatility + no trend + no range = QUIET
  return {
    type: "QUIET",
    volatility: classification,
    note: "Low trading opportunity",
  };
}
```

### 2.3 Integration with Phase 3 Data

**Input Sources:**

- Microcandles (5m timeframe) from `OrderbookManager`
- Flow delta trends (buy/sell pressure)
- Orderbook imbalance shifts (support/resistance)

**Output Usage:**

- FAZA 6: Adjust signal scoring based on regime
- FAZA 7: Filter entry signals by regime type
- FAZA 8: Modify risk parameters per regime

### 2.4 Performance Targets

| Metric                     | Target          | Status |
| -------------------------- | --------------- | ------ |
| **Regime Detection Speed** | <200ms          | ⏳ TBD |
| **Update Frequency**       | Every 5m candle | ⏳ TBD |
| **Accuracy (backtested)**  | >75%            | ⏳ TBD |
| **Memory Overhead**        | <10MB           | ⏳ TBD |

---

## 📊 3. FAZA 6: SCORING SYSTEM {#faza6}

### 3.1 Objective

**Generate trade signals by scoring multiple technical factors and market conditions**

**Scoring Factors:**

1. **Orderbook Imbalance** (Phase 3 data)
2. **Flow Delta Momentum** (Phase 3 data)
3. **Regime Alignment** (FAZA 5)
4. **Candle Patterns** (Phase 3 microcandles)
5. **Volume Confirmation** (Phase 3 trade data)

### 3.2 Technical Implementation

**File:** `src/scoring/signalScorer.js`

**Multi-Factor Scoring:**

```javascript
function scoreSignal(symbol) {
  const scores = {
    imbalance: 0, // -1.0 to +1.0
    flowDelta: 0, // -1.0 to +1.0
    regime: 0, // 0.0 to +1.0
    pattern: 0, // -1.0 to +1.0
    volume: 0, // 0.0 to +1.0
    total: 0, // Final weighted score
    confidence: 0, // 0.0 to 1.0
  };

  // Factor 1: Orderbook Imbalance (30% weight)
  const imbalance = getOrderbookImbalance(symbol);
  if (imbalance > 0.6) {
    scores.imbalance = (imbalance - 0.5) * 2; // 0.6 → +0.2, 1.0 → +1.0
  } else if (imbalance < 0.4) {
    scores.imbalance = (imbalance - 0.5) * 2; // 0.4 → -0.2, 0.0 → -1.0
  }

  // Factor 2: Flow Delta (25% weight)
  const flowDelta = getFlowDelta(symbol);
  const flowNormalized = normalizeFlowDelta(flowDelta); // -1.0 to +1.0
  scores.flowDelta = flowNormalized;

  // Factor 3: Regime Alignment (20% weight)
  const regime = getRegime(symbol);
  scores.regime = regimeScore(regime);

  // Factor 4: Candle Pattern (15% weight)
  const pattern = detectPattern(symbol);
  scores.pattern = pattern.score; // -1.0 (bearish) to +1.0 (bullish)

  // Factor 5: Volume Confirmation (10% weight)
  const volumeData = getVolumeProfile(symbol);
  scores.volume = volumeData.confirmation; // 0.0 (no confirm) to 1.0 (strong)

  // Weighted Total
  scores.total =
    scores.imbalance * 0.3 +
    scores.flowDelta * 0.25 +
    scores.regime * 0.2 +
    scores.pattern * 0.15 +
    scores.volume * 0.1;

  // Confidence based on factor alignment
  scores.confidence = calculateConfidence(scores);

  return scores;
}
```

**Imbalance Scoring:**

```javascript
function scoreImbalance(imbalance) {
  // imbalance range: 0.0 (all asks) to 1.0 (all bids)
  // Neutral zone: 0.45 - 0.55

  if (imbalance >= 0.55 && imbalance < 0.65) {
    // Mild bullish: 0.55 → +0.2, 0.65 → +0.4
    return (imbalance - 0.55) * 2;
  } else if (imbalance >= 0.65) {
    // Strong bullish: 0.65 → +0.4, 1.0 → +1.0
    return 0.4 + ((imbalance - 0.65) / 0.35) * 0.6;
  } else if (imbalance <= 0.45 && imbalance > 0.35) {
    // Mild bearish: 0.45 → -0.2, 0.35 → -0.4
    return -(0.45 - imbalance) * 2;
  } else if (imbalance <= 0.35) {
    // Strong bearish: 0.35 → -0.4, 0.0 → -1.0
    return -0.4 - ((0.35 - imbalance) / 0.35) * 0.6;
  }

  return 0; // Neutral zone
}
```

**Signal Generation:**

```javascript
function generateSignal(symbol, scores) {
  const { total, confidence } = scores;

  // Thresholds
  const STRONG_LONG = 0.6;
  const WEAK_LONG = 0.3;
  const WEAK_SHORT = -0.3;
  const STRONG_SHORT = -0.6;
  const MIN_CONFIDENCE = 0.6;

  if (confidence < MIN_CONFIDENCE) {
    return { signal: "NO_SIGNAL", reason: "Low confidence" };
  }

  if (total >= STRONG_LONG) {
    return {
      signal: "STRONG_LONG",
      score: total,
      confidence: confidence,
      factors: scores,
    };
  } else if (total >= WEAK_LONG) {
    return {
      signal: "WEAK_LONG",
      score: total,
      confidence: confidence,
      factors: scores,
    };
  } else if (total <= STRONG_SHORT) {
    return {
      signal: "STRONG_SHORT",
      score: total,
      confidence: confidence,
      factors: scores,
    };
  } else if (total <= WEAK_SHORT) {
    return {
      signal: "WEAK_SHORT",
      score: total,
      confidence: confidence,
      factors: scores,
    };
  }

  return { signal: "NO_SIGNAL", reason: "Neutral zone" };
}
```

### 3.3 Andre Strategy Integration

**From `andre_strategy_analysis.md` (95% confidence):**

**Funding Rate Integration:**

```javascript
// Andre uses funding rate as PRIMARY filter
function incorporateFundingRate(symbol, baseScore) {
  const fundingRate = getFundingRate(symbol); // From Bybit API

  // Extreme negative FR = long opportunity
  if (fundingRate < -0.01) {
    // -1.0% or more
    baseScore.fundingBoost = 0.3; // High boost
    baseScore.confidence += 0.15;
  } else if (fundingRate < -0.005) {
    // -0.5% to -1.0%
    baseScore.fundingBoost = 0.15; // Moderate boost
    baseScore.confidence += 0.1;
  }

  // Extreme positive FR = short opportunity
  if (fundingRate > 0.02) {
    // +2.0% or more
    baseScore.fundingBoost = -0.3; // Strong short bias
    baseScore.confidence += 0.15;
  } else if (fundingRate > 0.01) {
    // +1.0% to +2.0%
    baseScore.fundingBoost = -0.15; // Moderate short bias
    baseScore.confidence += 0.1;
  }

  baseScore.total += baseScore.fundingBoost;
  return baseScore;
}
```

**Volume Anomaly Detection:**

```javascript
// Andre looks for 3x+ volume spikes
function detectVolumeAnomaly(symbol) {
  const currentVolume = getRecentVolume(symbol, "1m");
  const baseline = getAverageVolume(symbol, "24h");

  const multiplier = currentVolume / baseline;

  if (multiplier >= 8.0) {
    return {
      anomaly: "EXTREME",
      multiplier: multiplier,
      confidence: 0.9,
      note: "Exceptional volume spike",
    };
  } else if (multiplier >= 3.0) {
    return {
      anomaly: "HIGH",
      multiplier: multiplier,
      confidence: 0.75,
      note: "Significant volume increase",
    };
  } else if (multiplier >= 2.0) {
    return {
      anomaly: "MODERATE",
      multiplier: multiplier,
      confidence: 0.5,
      note: "Notable volume uptick",
    };
  }

  return {
    anomaly: "NONE",
    multiplier: multiplier,
    confidence: 0.0,
  };
}
```

**Time-of-Day Filter:**

```javascript
// Andre observes: European morning best, Asian evening dangerous for shorts
function applyTimeOfDayFilter(signal) {
  const hour = new Date().getUTCHours(); // UTC time

  // European morning (6-12 UTC) = GOLD TIME
  if (hour >= 6 && hour < 12) {
    signal.timeBonus = 0.1;
    signal.timeNote = "European morning - optimal";
  }

  // Asian evening (12-18 UTC) = DANGER for shorts
  else if (hour >= 12 && hour < 18 && signal.signal.includes("SHORT")) {
    signal.timeBonus = -0.2;
    signal.timeNote = "Asian evening - risky for shorts";
    signal.confidence *= 0.8; // Reduce confidence
  }

  // Night hours (18-6 UTC) = CAUTION
  else {
    signal.timeBonus = -0.05;
    signal.timeNote = "Off-hours trading";
  }

  signal.score += signal.timeBonus;
  return signal;
}
```

### 3.4 Performance Targets

| Metric                  | Target  | Status |
| ----------------------- | ------- | ------ |
| **Scoring Speed**       | <100ms  | ⏳ TBD |
| **Signal Frequency**    | 2-5/day | ⏳ TBD |
| **Win Rate (paper)**    | >60%    | ⏳ TBD |
| **False Positive Rate** | <30%    | ⏳ TBD |

---

## 🔄 4. FAZA 7: STATE MACHINE {#faza7}

### 4.1 Objective

**Manage complete trade lifecycle from signal detection to position exit**

**States:**

1. **IDLE** - Waiting for signal
2. **SIGNAL_DETECTED** - Signal generated, validating
3. **PRE_ENTRY** - Risk checks passed, preparing order
4. **ENTRY_PENDING** - Order submitted, waiting fill
5. **IN_POSITION** - Position active, monitoring
6. **PARTIAL_EXIT** - TP1/TP2 hit, managing runner
7. **EXIT_PENDING** - Exit order submitted
8. **CLOSED** - Position closed, logging P&L

### 4.2 Technical Implementation

**File:** `src/state/tradingStateMachine.js`

**State Machine Class:**

```javascript
class TradingStateMachine {
  constructor(symbol) {
    this.symbol = symbol;
    this.state = "IDLE";
    this.position = null;
    this.signal = null;
    this.entry = null;
    this.exits = [];
    this.pnl = 0;
    this.history = [];
  }

  // State transitions
  async transition(newState, data = {}) {
    const oldState = this.state;
    console.log(`[${this.symbol}] State: ${oldState} → ${newState}`);

    this.history.push({
      from: oldState,
      to: newState,
      timestamp: Date.now(),
      data: data,
    });

    this.state = newState;

    // State entry actions
    await this.onEnter(newState, data);
  }

  async onEnter(state, data) {
    switch (state) {
      case "SIGNAL_DETECTED":
        await this.handleSignalDetected(data);
        break;
      case "PRE_ENTRY":
        await this.handlePreEntry(data);
        break;
      case "ENTRY_PENDING":
        await this.handleEntryPending(data);
        break;
      case "IN_POSITION":
        await this.handleInPosition(data);
        break;
      case "PARTIAL_EXIT":
        await this.handlePartialExit(data);
        break;
      case "CLOSED":
        await this.handleClosed(data);
        break;
    }
  }

  async handleSignalDetected(signal) {
    this.signal = signal;

    // Validate signal strength
    if (signal.confidence < 0.6) {
      console.log(`[${this.symbol}] Signal rejected: Low confidence`);
      await this.transition("IDLE");
      return;
    }

    // Check if regime allows entry
    const regime = getRegime(this.symbol);
    if (!this.isRegimeCompatible(signal, regime)) {
      console.log(`[${this.symbol}] Signal rejected: Regime incompatible`);
      await this.transition("IDLE");
      return;
    }

    // Proceed to risk checks
    await this.transition("PRE_ENTRY", signal);
  }

  async handlePreEntry(signal) {
    // Risk management checks (FAZA 8)
    const riskCheck = await performRiskChecks(this.symbol, signal);

    if (!riskCheck.passed) {
      console.log(`[${this.symbol}] Risk check failed: ${riskCheck.reason}`);
      await this.transition("IDLE");
      return;
    }

    // Calculate position size
    const positionSize = calculatePositionSize(signal, riskCheck);

    // Prepare entry order
    this.entry = {
      signal: signal,
      size: positionSize,
      entryPrice: signal.entryPrice,
      stopLoss: riskCheck.stopLoss,
      takeProfits: riskCheck.takeProfits,
    };

    // Submit order (paper trading or live)
    await this.transition("ENTRY_PENDING", this.entry);
  }

  async handleEntryPending(entry) {
    // In paper trading: simulate instant fill
    // In live trading: wait for order fill confirmation

    const filled = await waitForFill(entry);

    if (filled.success) {
      this.position = {
        symbol: this.symbol,
        side: entry.signal.signal.includes("LONG") ? "LONG" : "SHORT",
        size: filled.filledSize,
        entryPrice: filled.avgFillPrice,
        entryTime: Date.now(),
        stopLoss: entry.stopLoss,
        takeProfits: entry.takeProfits,
        status: "ACTIVE",
      };

      await this.transition("IN_POSITION", this.position);
    } else {
      console.log(`[${this.symbol}] Entry failed: ${filled.reason}`);
      await this.transition("IDLE");
    }
  }

  async handleInPosition(position) {
    // Start monitoring loop
    this.monitorPosition();
  }

  async monitorPosition() {
    // Check exit conditions every second
    const interval = setInterval(async () => {
      if (this.state !== "IN_POSITION" && this.state !== "PARTIAL_EXIT") {
        clearInterval(interval);
        return;
      }

      const currentPrice = getCurrentPrice(this.symbol);

      // Check stop loss
      if (this.checkStopLoss(currentPrice)) {
        clearInterval(interval);
        await this.exitPosition("STOP_LOSS");
        return;
      }

      // Check take profits
      const tpHit = this.checkTakeProfits(currentPrice);
      if (tpHit) {
        if (tpHit.level === "TP1" || tpHit.level === "TP2") {
          await this.partialExit(tpHit);
        } else {
          clearInterval(interval);
          await this.exitPosition(tpHit.level);
        }
      }
    }, 1000); // Check every second
  }

  async partialExit(tpData) {
    // Andre strategy: 40% @ TP1, 30% @ TP2, 30% runner
    let exitPercent = 0;

    if (tpData.level === "TP1") {
      exitPercent = 0.4;
      // Move stop loss to break-even
      this.position.stopLoss = this.position.entryPrice;
      console.log(`[${this.symbol}] TP1 hit! Exiting 40%, SL to BE`);
    } else if (tpData.level === "TP2") {
      exitPercent = 0.3;
      console.log(`[${this.symbol}] TP2 hit! Exiting 30%`);
    }

    const exitSize = this.position.size * exitPercent;
    await executePartialExit(this.symbol, exitSize, tpData.price);

    this.position.size -= exitSize;
    this.exits.push({
      level: tpData.level,
      size: exitSize,
      price: tpData.price,
      time: Date.now(),
    });

    await this.transition("PARTIAL_EXIT", tpData);

    // If still have runner, continue monitoring
    if (this.position.size > 0) {
      await this.transition("IN_POSITION", this.position);
    }
  }

  async exitPosition(reason) {
    const exitPrice = getCurrentPrice(this.symbol);

    await executeFullExit(this.symbol, this.position.size, exitPrice);

    // Calculate P&L
    this.pnl = this.calculatePnL(exitPrice);

    console.log(
      `[${this.symbol}] Position closed: ${reason} | P&L: ${this.pnl}%`
    );

    await this.transition("CLOSED", {
      reason: reason,
      exitPrice: exitPrice,
      pnl: this.pnl,
    });

    // Log trade to database
    await logTrade(this.position, this.exits, this.pnl);

    // Reset to IDLE after 5 seconds
    setTimeout(() => this.transition("IDLE"), 5000);
  }

  calculatePnL(exitPrice) {
    const direction = this.position.side === "LONG" ? 1 : -1;
    const priceChange =
      (exitPrice - this.position.entryPrice) / this.position.entryPrice;
    return direction * priceChange * 100; // Percentage
  }

  checkStopLoss(currentPrice) {
    if (!this.position) return false;

    if (
      this.position.side === "LONG" &&
      currentPrice <= this.position.stopLoss
    ) {
      return true;
    } else if (
      this.position.side === "SHORT" &&
      currentPrice >= this.position.stopLoss
    ) {
      return true;
    }

    return false;
  }

  checkTakeProfits(currentPrice) {
    if (!this.position) return false;

    for (const tp of this.position.takeProfits) {
      if (tp.hit) continue; // Already hit

      if (this.position.side === "LONG" && currentPrice >= tp.price) {
        tp.hit = true;
        return { level: tp.level, price: tp.price };
      } else if (this.position.side === "SHORT" && currentPrice <= tp.price) {
        tp.hit = true;
        return { level: tp.level, price: tp.price };
      }
    }

    return null;
  }

  isRegimeCompatible(signal, regime) {
    // Don't trade in VOLATILE or QUIET regimes
    if (regime.type === "VOLATILE" || regime.type === "QUIET") {
      return false;
    }

    // In TRENDING regime, only trade with trend
    if (regime.type === "TRENDING") {
      if (regime.direction === "BULLISH" && signal.signal.includes("SHORT")) {
        return false; // Don't short in uptrend
      }
      if (regime.direction === "BEARISH" && signal.signal.includes("LONG")) {
        return false; // Don't long in downtrend
      }
    }

    // RANGING regime OK for both directions
    return true;
  }
}
```

### 4.3 State Persistence

**Database Schema (SQLite):**

```sql
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  signal_type TEXT,
  confidence REAL,
  entry_price REAL,
  entry_time INTEGER,
  exit_price REAL,
  exit_time INTEGER,
  exit_reason TEXT,
  position_size REAL,
  leverage INTEGER,
  pnl_percent REAL,
  pnl_usd REAL,
  state_history TEXT, -- JSON
  partial_exits TEXT, -- JSON
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_symbol ON trades(symbol);
CREATE INDEX idx_entry_time ON trades(entry_time);
```

### 4.4 Performance Targets

| Metric                     | Target      | Status |
| -------------------------- | ----------- | ------ |
| **State Transition Speed** | <50ms       | ⏳ TBD |
| **Position Monitoring**    | 1Hz (1/sec) | ⏳ TBD |
| **Exit Execution**         | <2 seconds  | ⏳ TBD |
| **State Persistence**      | <100ms      | ⏳ TBD |

---

## 🛡️ 5. FAZA 8: RISK MANAGEMENT {#faza8}

### 5.1 Objective

**Implement robust risk controls to protect capital and ensure sustainable trading**

**Risk Components:**

1. **Position Sizing** - Calculate safe position size based on account balance and risk tolerance
2. **Stop Loss Calculation** - Dynamic SL placement based on volatility and support/resistance
3. **Daily Loss Limit** - Circuit breaker to prevent catastrophic losses
4. **Drawdown Management** - Reduce position sizing after consecutive losses
5. **Correlation Check** - Prevent overexposure to correlated assets

### 5.2 Technical Implementation

**File:** `src/risk/riskManager.js`

**Position Sizing Algorithm:**

```javascript
function calculatePositionSize(accountBalance, signal, riskPercent = 1.0) {
  // Risk 1% of account per trade (conservative)
  const riskAmount = accountBalance * (riskPercent / 100);

  // Calculate stop loss distance
  const entryPrice = signal.entryPrice;
  const stopLoss = calculateStopLoss(signal);
  const slDistance = Math.abs(entryPrice - stopLoss) / entryPrice; // Percentage

  // Position size = Risk Amount / Stop Loss Distance
  // Example: $1000 account, 1% risk = $10 risk
  //          Entry $100, SL $95 = 5% distance
  //          Position = $10 / 0.05 = $200

  const positionValue = riskAmount / slDistance;

  // Apply leverage (25x for Andre strategy)
  const leverage = 25;
  const marginRequired = positionValue / leverage;

  // Max position: 10% of account balance (prevents over-leveraging)
  const maxPosition = accountBalance * 0.1;

  if (marginRequired > maxPosition) {
    console.warn(
      `Position size ${marginRequired} exceeds max ${maxPosition}, reducing`
    );
    return maxPosition;
  }

  return marginRequired;
}
```

**Dynamic Stop Loss:**

```javascript
function calculateStopLoss(signal) {
  const symbol = signal.symbol;
  const entryPrice = signal.entryPrice;
  const side = signal.signal.includes("LONG") ? "LONG" : "SHORT";

  // Method 1: ATR-based (2x ATR for breathing room)
  const atr = getATR(symbol, "5m", 20);
  const atrDistance = atr * 2;

  // Method 2: Support/Resistance levels
  const levels = getSupportResistance(symbol);
  let levelDistance = 0;

  if (side === "LONG") {
    const nearestSupport = levels.support.find((s) => s < entryPrice);
    if (nearestSupport) {
      levelDistance = entryPrice - nearestSupport;
    }
  } else {
    const nearestResistance = levels.resistance.find((r) => r > entryPrice);
    if (nearestResistance) {
      levelDistance = nearestResistance - entryPrice;
    }
  }

  // Use wider of the two (more conservative)
  const distance = Math.max(atrDistance, levelDistance);

  // Calculate SL price
  let stopLoss;
  if (side === "LONG") {
    stopLoss = entryPrice - distance;
  } else {
    stopLoss = entryPrice + distance;
  }

  // Ensure minimum distance (1% for safety)
  const minDistance = entryPrice * 0.01;
  if (Math.abs(stopLoss - entryPrice) < minDistance) {
    stopLoss =
      side === "LONG" ? entryPrice - minDistance : entryPrice + minDistance;
  }

  return stopLoss;
}
```

**Daily Loss Limit (Andre Strategy):**

```javascript
function checkDailyLossLimit(accountBalance) {
  const today = new Date().toISOString().split("T")[0];
  const todayTrades = getTradesForDate(today);

  // Calculate today's P&L
  const dailyPnL = todayTrades.reduce((sum, trade) => sum + trade.pnl_usd, 0);
  const dailyPnLPercent = (dailyPnL / accountBalance) * 100;

  // Circuit breaker: -5% daily loss
  if (dailyPnLPercent <= -5.0) {
    return {
      allowed: false,
      reason: "Daily loss limit reached (-5%)",
      currentLoss: dailyPnLPercent,
    };
  }

  // Warning at -3%
  if (dailyPnLPercent <= -3.0) {
    return {
      allowed: true,
      warning: "Approaching daily loss limit",
      currentLoss: dailyPnLPercent,
      reducedPositionSize: true, // Reduce next trade size by 50%
    };
  }

  return {
    allowed: true,
    currentLoss: dailyPnLPercent,
  };
}
```

**Daily Profit Lock (Andre Strategy):**

```javascript
function checkDailyProfitLock(accountBalance) {
  const today = new Date().toISOString().split("T")[0];
  const todayTrades = getTradesForDate(today);

  const dailyPnL = todayTrades.reduce((sum, trade) => sum + trade.pnl_usd, 0);
  const dailyPnLPercent = (dailyPnL / accountBalance) * 100;

  // Andre stops trading after +5% daily profit
  if (dailyPnLPercent >= 5.0) {
    return {
      stopTrading: true,
      reason: "Daily profit target reached (+5%)",
      currentProfit: dailyPnLPercent,
      note: "Won't throw away what we earned",
    };
  }

  return {
    stopTrading: false,
    currentProfit: dailyPnLPercent,
  };
}
```

**Drawdown Management:**

```javascript
function adjustForDrawdown(basePositionSize) {
  const recentTrades = getRecentTrades(10); // Last 10 trades
  const losses = recentTrades.filter((t) => t.pnl_percent < 0);

  // Calculate consecutive losses
  let consecutiveLosses = 0;
  for (let i = recentTrades.length - 1; i >= 0; i--) {
    if (recentTrades[i].pnl_percent < 0) {
      consecutiveLosses++;
    } else {
      break;
    }
  }

  // Reduce position size after 2+ consecutive losses
  if (consecutiveLosses >= 3) {
    return basePositionSize * 0.25; // 75% reduction
  } else if (consecutiveLosses === 2) {
    return basePositionSize * 0.5; // 50% reduction
  }

  return basePositionSize;
}
```

**Correlation Check:**

```javascript
function checkCorrelationRisk(symbol, openPositions) {
  // Prevent multiple positions in correlated assets
  // Example: BTC, ETH highly correlated

  const correlatedPairs = {
    BTCUSDT: ["ETHUSDT", "SOLUSDT", "XRPUSDT"],
    ETHUSDT: ["BTCUSDT", "SOLUSDT"],
    // ... more pairs
  };

  const correlatedSymbols = correlatedPairs[symbol] || [];

  for (const position of openPositions) {
    if (correlatedSymbols.includes(position.symbol)) {
      return {
        allowed: false,
        reason: `Correlated position exists: ${position.symbol}`,
        correlation: "HIGH",
      };
    }
  }

  return { allowed: true };
}
```

### 5.3 Risk Checks Before Entry

**Comprehensive Pre-Trade Validation:**

```javascript
async function performRiskChecks(symbol, signal) {
  const accountBalance = getAccountBalance();
  const openPositions = getOpenPositions();

  // Check 1: Daily loss limit
  const lossCheck = checkDailyLossLimit(accountBalance);
  if (!lossCheck.allowed) {
    return { passed: false, reason: lossCheck.reason };
  }

  // Check 2: Daily profit lock
  const profitCheck = checkDailyProfitLock(accountBalance);
  if (profitCheck.stopTrading) {
    return { passed: false, reason: profitCheck.reason };
  }

  // Check 3: Max open positions (Andre: 1-2 at a time)
  if (openPositions.length >= 2) {
    return { passed: false, reason: "Max open positions reached (2)" };
  }

  // Check 4: Correlation risk
  const corrCheck = checkCorrelationRisk(symbol, openPositions);
  if (!corrCheck.allowed) {
    return { passed: false, reason: corrCheck.reason };
  }

  // Check 5: Calculate position size
  let positionSize = calculatePositionSize(accountBalance, signal);

  // Check 6: Adjust for drawdown
  if (lossCheck.reducedPositionSize) {
    positionSize *= 0.5;
  }
  positionSize = adjustForDrawdown(positionSize);

  // Check 7: Calculate stop loss
  const stopLoss = calculateStopLoss(signal);

  // Check 8: Calculate take profits (FAZA 9)
  const takeProfits = calculateTakeProfits(signal);

  return {
    passed: true,
    positionSize: positionSize,
    stopLoss: stopLoss,
    takeProfits: takeProfits,
    adjustments: {
      drawdownReduction: lossCheck.reducedPositionSize || false,
      dailyLossWarning: lossCheck.warning || null,
    },
  };
}
```

### 5.4 Performance Targets

| Metric                     | Target | Status |
| -------------------------- | ------ | ------ |
| **Risk Check Speed**       | <100ms | ⏳ TBD |
| **Max Drawdown**           | <15%   | ⏳ TBD |
| **Max Daily Loss**         | -5%    | ⏳ TBD |
| **Position Size Accuracy** | ±5%    | ⏳ TBD |

---

## 🎯 6. FAZA 9: TP/SL ENGINE {#faza9}

### 6.1 Objective

**Implement dynamic take profit and stop loss management with partial exit strategy**

**Key Features:**

1. **Exponential TP Scaling** (Andre: 20% / 40% / 100% / 200%+)
2. **Partial Exits** (40% @ TP1, 30% @ TP2, 30% runner)
3. **Break-Even Lock** (Move SL to entry after TP1)
4. **Trailing Stop** (For high-risk trades)
5. **Dynamic Adjustment** (Based on volatility and regime)

### 6.2 Technical Implementation

**File:** `src/execution/tpslEngine.js`

**Take Profit Calculation (Andre Strategy):**

```javascript
function calculateTakeProfits(signal) {
  const entryPrice = signal.entryPrice;
  const side = signal.signal.includes("LONG") ? "LONG" : "SHORT";
  const confidence = signal.confidence;

  // Base TP percentages (Andre's standard)
  const baseTP1 = 0.008; // 0.8% = 20% ROI @ 25x leverage
  const baseTP2 = 0.016; // 1.6% = 40% ROI
  const baseTP3 = 0.04; // 4.0% = 100% ROI
  const baseTP4 = 0.08; // 8.0% = 200% ROI (optional)

  // Adjust based on confidence (higher confidence = wider targets)
  const multiplier = confidence > 0.8 ? 1.2 : confidence > 0.7 ? 1.0 : 0.8;

  const tp1Dist = baseTP1 * multiplier;
  const tp2Dist = baseTP2 * multiplier;
  const tp3Dist = baseTP3 * multiplier;
  const tp4Dist = baseTP4 * multiplier;

  // Calculate prices
  let takeProfits;
  if (side === "LONG") {
    takeProfits = [
      {
        level: "TP1",
        price: entryPrice * (1 + tp1Dist),
        percent: 40,
        hit: false,
      },
      {
        level: "TP2",
        price: entryPrice * (1 + tp2Dist),
        percent: 30,
        hit: false,
      },
      {
        level: "TP3",
        price: entryPrice * (1 + tp3Dist),
        percent: 30,
        hit: false,
      },
    ];

    // Add TP4 for high confidence signals
    if (confidence > 0.85) {
      takeProfits.push({
        level: "TP4",
        price: entryPrice * (1 + tp4Dist),
        percent: "RUNNER",
        hit: false,
      });
    }
  } else {
    takeProfits = [
      {
        level: "TP1",
        price: entryPrice * (1 - tp1Dist),
        percent: 40,
        hit: false,
      },
      {
        level: "TP2",
        price: entryPrice * (1 - tp2Dist),
        percent: 30,
        hit: false,
      },
      {
        level: "TP3",
        price: entryPrice * (1 - tp3Dist),
        percent: 30,
        hit: false,
      },
    ];

    if (confidence > 0.85) {
      takeProfits.push({
        level: "TP4",
        price: entryPrice * (1 - tp4Dist),
        percent: "RUNNER",
        hit: false,
      });
    }
  }

  return takeProfits;
}
```

**DCA Levels (Andre Strategy - Safety Net):**

```javascript
function calculateDCALevels(signal, riskLevel = "NORMAL") {
  const entryPrice = signal.entryPrice;
  const side = signal.signal.includes("LONG") ? "LONG" : "SHORT";

  // Standard DCA: +5% / +15% / +35% from entry
  // High Risk DCA: +2% / +5% / +10% / +20% / +40% (5 levels)

  let dcaLevels;

  if (riskLevel === "HIGH") {
    // Tighter DCA for risky trades (like BR example)
    if (side === "LONG") {
      dcaLevels = [
        { level: "DCA1", price: entryPrice * 0.98, size: 1.5 }, // 1.5x base
        { level: "DCA2", price: entryPrice * 0.95, size: 2.0 },
        { level: "DCA3", price: entryPrice * 0.9, size: 3.0 },
        { level: "DCA4", price: entryPrice * 0.8, size: 4.0 },
        { level: "DCA5", price: entryPrice * 0.6, size: 5.0 },
      ];
    } else {
      dcaLevels = [
        { level: "DCA1", price: entryPrice * 1.02, size: 1.5 },
        { level: "DCA2", price: entryPrice * 1.05, size: 2.0 },
        { level: "DCA3", price: entryPrice * 1.1, size: 3.0 },
        { level: "DCA4", price: entryPrice * 1.2, size: 4.0 },
        { level: "DCA5", price: entryPrice * 1.4, size: 5.0 },
      ];
    }
  } else {
    // Standard 3-level DCA
    if (side === "LONG") {
      dcaLevels = [
        { level: "DCA1", price: entryPrice * 0.95, size: 1.5 },
        { level: "DCA2", price: entryPrice * 0.85, size: 2.0 },
        { level: "DCA3", price: entryPrice * 0.65, size: 3.0 },
      ];
    } else {
      dcaLevels = [
        { level: "DCA1", price: entryPrice * 1.05, size: 1.5 },
        { level: "DCA2", price: entryPrice * 1.15, size: 2.0 },
        { level: "DCA3", price: entryPrice * 1.35, size: 3.0 },
      ];
    }
  }

  return dcaLevels;
}
```

**Break-Even Lock (After TP1):**

```javascript
function updateStopLossAfterTP1(position) {
  // Andre strategy: Move SL to entry price after TP1 hit
  // This guarantees minimum 0% loss (but TP1 profit already banked!)

  position.stopLoss = position.entryPrice;
  position.slType = "BREAK_EVEN";

  console.log(
    `[${position.symbol}] TP1 hit! Stop loss moved to break-even: ${position.stopLoss}`
  );

  // Log partial profit
  const tp1Profit =
    (position.takeProfits[0].price - position.entryPrice) / position.entryPrice;
  const tp1ROI = tp1Profit * 25 * 100; // 25x leverage, percentage

  console.log(`[${position.symbol}] TP1 Profit locked: ${tp1ROI.toFixed(1)}%`);
}
```

**Trailing Stop (High-Risk Trades):**

```javascript
function updateTrailingStop(position, currentPrice) {
  // Only for high-risk trades with trailing stop enabled
  if (position.slType !== "TRAILING") return;

  const side = position.side;
  const trailDistance = position.entryPrice * 0.01; // 1% trail

  if (side === "LONG") {
    // Trail up as price rises
    const newSL = currentPrice - trailDistance;
    if (newSL > position.stopLoss) {
      position.stopLoss = newSL;
      console.log(
        `[${position.symbol}] Trailing SL updated: ${newSL.toFixed(4)}`
      );
    }
  } else {
    // Trail down as price falls
    const newSL = currentPrice + trailDistance;
    if (newSL < position.stopLoss) {
      position.stopLoss = newSL;
      console.log(
        `[${position.symbol}] Trailing SL updated: ${newSL.toFixed(4)}`
      );
    }
  }
}
```

**Partial Exit Execution:**

```javascript
async function executePartialExit(symbol, size, price, tpLevel) {
  // In paper trading: simulate instant fill
  // In live trading: submit market order

  const exitOrder = {
    symbol: symbol,
    side: "CLOSE", // Close position
    size: size,
    type: "MARKET",
    timestamp: Date.now(),
  };

  // Log partial exit
  console.log(
    `[${symbol}] Executing partial exit: ${tpLevel} | Size: ${size} @ ${price}`
  );

  // Calculate partial profit
  const position = getPosition(symbol);
  const direction = position.side === "LONG" ? 1 : -1;
  const priceChange = (price - position.entryPrice) / position.entryPrice;
  const partialPnL = direction * priceChange * 25 * 100; // 25x leverage, %

  console.log(
    `[${symbol}] Partial P&L: ${partialPnL.toFixed(1)}% on ${(
      (size / position.totalSize) *
      100
    ).toFixed(0)}% of position`
  );

  // In paper trading
  if (isPaperTrading()) {
    return {
      success: true,
      filledSize: size,
      avgFillPrice: price,
      timestamp: Date.now(),
    };
  }

  // In live trading (Bybit API)
  // return await bybit.submitOrder(exitOrder);
}
```

### 6.3 Performance Targets

| Metric                     | Target     | Status |
| -------------------------- | ---------- | ------ |
| **TP Calculation Speed**   | <50ms      | ⏳ TBD |
| **Partial Exit Execution** | <2 seconds | ⏳ TBD |
| **SL Update Latency**      | <100ms     | ⏳ TBD |
| **TP Hit Detection**       | <1 second  | ⏳ TBD |

---

## 📅 7. IMPLEMENTATION TIMELINE {#timeline}

### Week 1: FAZA 5 (Regime Engine)

**Days 1-2:** Core regime detection

- Trend strength calculation
- Volatility analysis
- Range detection

**Days 3-4:** Testing & optimization

- Backtest on historical data
- Tune parameters
- Performance validation

**Days 5-7:** Integration

- Connect to Phase 3 microcandle data
- HTTP API endpoints for regime data
- Dashboard visualization prep

**Deliverable:** Working regime classifier with >75% accuracy

---

### Week 2: FAZA 6 (Scoring System)

**Days 1-3:** Multi-factor scoring

- Imbalance scoring
- Flow delta scoring
- Pattern detection
- Volume confirmation

**Days 4-5:** Andre strategy integration

- Funding rate filter
- Volume anomaly detection
- Time-of-day adjustments

**Days 6-7:** Signal generation

- Threshold tuning
- Confidence calculation
- False positive reduction

**Deliverable:** Signal generator producing 2-5 signals/day with >60% paper trading win rate

---

### Week 3: FAZA 7 (State Machine)

**Days 1-2:** State machine core

- State definitions
- Transition logic
- State persistence

**Days 3-4:** Position monitoring

- Entry/exit condition checking
- Partial exit logic
- Stop loss monitoring

**Days 5-7:** Integration testing

- End-to-end trade lifecycle
- Error handling
- Database logging

**Deliverable:** Complete trade lifecycle management from signal to close

---

### Week 4: FAZA 8 & 9 (Risk + TP/SL)

**Days 1-2:** Risk management

- Position sizing
- Stop loss calculation
- Daily limits

**Days 3-4:** TP/SL engine

- Take profit levels
- Partial exit strategy
- Break-even lock

**Days 5-7:** Paper trading launch

- Full system integration
- Real-time testing
- Performance monitoring

**Deliverable:** Complete AI trading system in paper trading mode

---

### Week 5+: Optimization & Live Trading Prep

**Week 5:** Paper trading evaluation

- Analyze first week of paper trades
- Identify issues and optimize
- Tune parameters

**Week 6:** Live trading preparation

- Risk review and approval
- Capital allocation strategy
- Monitoring dashboard completion

**Week 7:** Live trading launch (if approved)

- Start with minimal capital ($100-500)
- Monitor closely
- Scale gradually if successful

---

## ✅ 8. SUCCESS CRITERIA {#success}

### Phase 4 Completion Requirements

**FAZA 5 (Regime Engine):**

- ✅ Classifies 4 regime types (Trending/Ranging/Volatile/Quiet)
- ✅ >75% regime classification accuracy (backtested)
- ✅ <200ms detection latency
- ✅ Updates every 5m candle close

**FAZA 6 (Scoring System):**

- ✅ Multi-factor scoring (5+ factors)
- ✅ Generates 2-5 signals per day
- ✅ >60% win rate in paper trading (7 days minimum)
- ✅ <30% false positive rate
- ✅ Andre strategy filters integrated (FR, volume, time)

**FAZA 7 (State Machine):**

- ✅ Manages complete trade lifecycle (8 states)
- ✅ Handles partial exits correctly (40/30/30)
- ✅ State persistence to database
- ✅ <50ms state transition latency
- ✅ Zero crashes during paper trading week

**FAZA 8 (Risk Management):**

- ✅ Position sizing algorithm operational
- ✅ Daily loss limit enforced (-5% max)
- ✅ Daily profit lock enforced (+5% target)
- ✅ Drawdown management active (3-loss reduction)
- ✅ Correlation checks preventing overexposure

**FAZA 9 (TP/SL Engine):**

- ✅ Exponential TP scaling (20%/40%/100%+)
- ✅ Partial exit execution (40% TP1, 30% TP2, 30% runner)
- ✅ Break-even lock after TP1
- ✅ DCA levels calculated (3 or 5 levels based on risk)
- ✅ <2 second exit execution

### Paper Trading Performance Targets

**Week 1 Goals:**

- Win rate: >55%
- Max drawdown: <10%
- Daily trades: 2-5
- No system crashes

**Week 2 Goals:**

- Win rate: >60%
- Max drawdown: <8%
- Average win: >30% ROI
- Max consecutive losses: <3

**Live Trading Readiness:**

- Paper trading: 4+ weeks successful
- Win rate: >65%
- Max drawdown: <5%
- Sharpe ratio: >1.5
- Capital allocation: $100-500 initial

---

## 🎯 CONCLUSION

**Phase 4 Represents:**

- Complete AI decision-making system
- 95% confidence strategy from Andre analysis
- Memory-optimized architecture (Phase 3)
- Stable data pipeline (Phase 2/3)
- Production-ready infrastructure (Phase 1-3)

**Expected Outcome:**

- Autonomous trading system (paper mode)
- 2-5 trades per day
- 60-70% win rate target
- Sustainable risk management
- Full performance analytics

**Timeline:** 4-5 weeks to completion
**Next Milestone:** FAZA 5 (Regime Engine) - Start Week 1

---

_Document Created: November 21, 2025_
_Phase 4 Status: PLANNING COMPLETE - Ready to Begin_
_Foundation: Phase 1-3 Complete (100% stable)_
_Strategy: Andre analysis complete (95% confidence)_
_Target Start: Week of November 25, 2025_
