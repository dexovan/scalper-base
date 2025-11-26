// ============================================================
// SCALP SIGNAL SCANNER
// Combines historical candle data + live market state
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import {
  calculateEntryZone,
  isPriceInEntryZone,
  getDistanceToEntryZone,
  adjustEntryZoneTowardMarket,
  shouldInvalidateSignal,
  getEntryZoneDisplay,
  CONFIG as ENTRY_ZONE_CONFIG
} from './utils/entryZoneOptimizer.js';
import { runAllSafetyChecks } from './utils/safetyChecks.js';
import { formatPrice, formatEntryZone, formatEntryZoneDisplay } from './utils/priceFormatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// SIGNAL PERSISTENCE TRACKER
// Tracks how many consecutive cycles a signal has been valid
// ============================================================

const signalHistory = new Map(); // symbol -> { direction, count, firstSeen }

// Signal State Tracker (for entry zone monitoring)
const signalStates = new Map(); // symbol -> { entryZone, direction, firstSeen, lastChecked, adjustmentCount, priceHistory, executionAttempts }

// Execution tracker (prevent duplicates)
const executionHistory = new Map(); // symbol -> { lastExecution, attempts }

const PERSISTENCE_CONFIG = {
  minCycles: 2,           // Default: 2 cycles (60s for normal signals)
  maxAge: 120000,         // Clear old signals after 2 minutes
  resetOnDirectionChange: true,  // Reset counter if direction flips

  // Score-based persistence (for micro-scalping 0.22% TP)
  scoreThresholds: {
    instant: 90,   // Score > 90: 1 cycle (30s) - A+ obvious signal
    fast: 75,      // Score > 75: 2 cycles (60s) - Strong signal
    normal: 0      // Score <= 75: 3 cycles (90s) - Standard signal
  }
};

// Fast Track: Rapid monitoring for top candidates
const FAST_TRACK_CONFIG = {
  enabled: true,
  interval: 2000,        // 2s rapid checks for hot candidates
  maxSymbols: 8,         // Monitor top 8 candidates in fast lane
  minScore: 70,          // Only candidates with score > 70 enter fast track
  minOrderFlowVolume: 5000,  // Minimum $5k total volume in 60s to trust orderFlow

  // Auto-execution settings
  autoExecute: true,     // 🚀 AUTO-EXECUTE enabled (DRY-RUN MODE - no real trades)
  executionApiUrl: 'http://localhost:8090/api/execute-trade',
  duplicateWindow: 300000,  // 5 min cooldown per symbol
  maxExecutionAttempts: 3   // Max 3 execution attempts per signal
};

function updateSignalPersistence(symbol, direction, score) {
  const now = Date.now();
  const existing = signalHistory.get(symbol);

  if (!existing) {
    // First time seeing this signal - store initial score
    signalHistory.set(symbol, { direction, count: 1, firstSeen: now, lastSeen: now, initialScore: score });
    return 1;
  }

  // Check if direction changed
  if (PERSISTENCE_CONFIG.resetOnDirectionChange && existing.direction !== direction) {
    signalHistory.set(symbol, { direction, count: 1, firstSeen: now, lastSeen: now, initialScore: score });
    return 1;
  }

  // Same direction, increment count (keep initial score for consistency)
  existing.count++;
  existing.lastSeen = now;
  return existing.count;
}

function cleanupOldSignals() {
  const now = Date.now();

  // Cleanup persistence history
  for (const [symbol, data] of signalHistory.entries()) {
    if (now - data.lastSeen > PERSISTENCE_CONFIG.maxAge) {
      signalHistory.delete(symbol);
    }
  }

  // Cleanup signal states (entry zones)
  for (const [symbol, state] of signalStates.entries()) {
    const age = now - state.firstSeen;

    // Remove if older than 2 minutes or if signal no longer in persistence tracker
    if (age > 120000 || !signalHistory.has(symbol)) {
      signalStates.delete(symbol);
    }
  }
}

function getRequiredCycles(score) {
  const { scoreThresholds } = PERSISTENCE_CONFIG;
  if (score >= scoreThresholds.instant) return 1;  // A+ signal: 30s
  if (score >= scoreThresholds.fast) return 2;     // Strong: 60s
  return 3;  // Normal: 90s
}

function isSignalPersistent(symbol) {
  const data = signalHistory.get(symbol);
  if (!data) return false;

  // Use initial score (from first detection) for consistency
  const required = getRequiredCycles(data.initialScore || 0);
  return data.count >= required;
}

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  dataDir: path.join(__dirname, '../data/live'),
  engineApiUrl: 'http://localhost:8090',

  // Scan interval - Balance between responsiveness and resource usage
  scanInterval: 30000, // 30 seconds (candles update every 60s, so 30s is reasonable)

  // Historical filters (from candles)
  minVolatility: 0.15,       // 0.15% minimum range (reduced from 0.3%)
  minVolumeSpike: 1.5,       // 1.5x average volume (reduced from 3x)
  minVelocity: 0.03,         // 0.03%/min price change speed (reduced from 0.05%)
  minPriceChange1m: 0.1,     // 0.1% momentum in last minute (reduced from 0.2%)

  // Live filters (from Engine API)
  minImbalance: 1.5,         // 1.5x bid/ask ratio (reduced from 2.5)
  maxSpread: 0.1,            // 0.1% max spread (increased from 0.05%)
  minOrderFlow: 0,           // Positive order flow (more buys than sells)

  // Output
  logSignals: true,
  saveSignals: true,
  signalsFile: path.join(__dirname, '../data/signals.json'),
  executionLogFile: path.join(__dirname, '../data/execution_history.json')
};

// ============================================================
// LOAD CANDLE DATA FROM JSON
// ============================================================

function loadCandleData(symbol) {
  const filePath = path.join(CONFIG.dataDir, `${symbol}_live.json`);

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    // Check if file is empty or corrupted
    if (!content || content.trim() === '') {
      console.warn(`⚠️  [DATA] Empty file for ${symbol}, skipping...`);
      return null;
    }

    const data = JSON.parse(content);

    return data;
  } catch (error) {
    // Handle corrupted JSON files
    if (error instanceof SyntaxError) {
      console.error(`❌ [DATA] Corrupted JSON for ${symbol}: ${error.message}`);
      console.error(`   File will be deleted: ${filePath}`);

      // Delete corrupted file so it can be regenerated
      try {
        fs.unlinkSync(filePath);
        console.log(`✅ [DATA] Deleted corrupted file: ${symbol}_live.json`);
      } catch (deleteError) {
        console.error(`❌ [DATA] Failed to delete corrupted file: ${deleteError.message}`);
      }
    } else {
      console.error(`❌ Error loading candles for ${symbol}:`, error.message);
    }
    return null;
  }
}

// ============================================================
// FETCH LIVE MARKET DATA FROM ENGINE
// ============================================================

async function fetchLiveMarketData(symbol) {
  try {
    const url = `${CONFIG.engineApiUrl}/api/live-market/${symbol}`;
    const response = await fetch(url);

    // Check if response is valid
    if (!response.ok) {
      console.warn(`⚠️  [API] HTTP ${response.status} for ${symbol}`);
      return null;
    }

    const text = await response.text();
    if (!text || text.trim() === '') {
      console.warn(`⚠️  [API] Empty response for ${symbol}`);
      return null;
    }

    const data = JSON.parse(text);

    if (!data.ok) {
      return null;
    }

    return data.live;
  } catch (error) {
    console.error(`❌ Error fetching live market for ${symbol}:`, error.message);
    return null;
  }
}

// ============================================================
// FETCH BATCH LIVE MARKET DATA (ANTI-OVERLOAD)
// Requests 50 symbols at once instead of 50 separate HTTP calls
// ============================================================

async function fetchLiveMarketBatch(symbols) {
  try {
    const url = `${CONFIG.engineApiUrl}/api/live-market-batch`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols })
    });

    const data = await response.json();

    if (!data.ok) {
      console.error(`❌ Batch fetch failed:`, data.error);
      return {};
    }

    return data.results || {}; // { BTCUSDT: {...}, ETHUSDT: {...} }
  } catch (error) {
    console.error(`❌ Error fetching batch live market:`, error.message);
    return {};
  }
}

// ============================================================
// CALCULATE CANDIDATE SCORE (for hotlist ranking)
// ============================================================

function calculateCandidateScore(candle, liveData) {
  // Calculate aggressive score based on volatility, volume, and velocity
  // Higher score = more likely to produce strong signal

  const volatility = candle.volatility ?? 0;
  const volumeSpike = candle.volumeSpike ?? 0;
  const velocity = Math.abs(candle.velocity ?? 0);
  const priceChange1m = Math.abs(candle.priceChange1m ?? 0);
  const imbalance = Math.abs((liveData.imbalance ?? 1.0) - 1.0); // distance from neutral
  const spreadPercent = parseFloat(liveData.spreadPercent) ?? 999;

  // Penalty for wide spread (harder to enter/exit)
  const spreadPenalty = spreadPercent > CONFIG.maxSpread ? 0.5 : 1.0;

  // Combine into score (higher = hotter symbol)
  const score = (
    volatility * 10 +           // Volatility is king for scalping
    volumeSpike * 5 +           // Volume spike indicates action
    velocity * 20 +             // Fast price movement
    priceChange1m * 15 +        // Recent momentum
    imbalance * 3               // Orderbook imbalance
  ) * spreadPenalty;

  return score;
}

// ============================================================
// EVALUATE SIGNAL CONFIDENCE
// ============================================================

function evaluateSignal(candle, liveData) {
  // Safe extraction with defaults
  const volatility = candle.volatility ?? 0;
  const volumeSpike = candle.volumeSpike ?? 0;
  const velocity = candle.velocity ?? 0;
  const priceChange1m = candle.priceChange1m ?? 0;

  const imbalance = liveData.imbalance ?? 1.0;
  const spread = liveData.spread ?? 999; // Absolute spread (ask-bid)
  const spreadPercent = parseFloat(liveData.spreadPercent) ?? 999; // Percent for filter
  const orderFlow = liveData.orderFlowNet60s;

  // Order flow volume validation (total volume in 60s)
  const orderFlowTotalVol = (liveData.orderFlowBuyVol60s || 0) + (liveData.orderFlowSellVol60s || 0);
  const orderFlowReliable = orderFlowTotalVol >= FAST_TRACK_CONFIG.minOrderFlowVolume;

  // ADVANCED PATTERN: Detect potential SHORT with high imbalance
  // When price is falling hard (negative momentum + velocity) AND imbalance > 1.5,
  // it suggests a fake bid wall (spoofing) that's being sold through = STRONG SHORT
  const isFallingHard = velocity < -0.04 && priceChange1m < -0.1;
  const hasLargeBidWall = imbalance > 1.5;
  const isSpoofPattern = isFallingHard && hasLargeBidWall;

  const checks = {
    // Historical checks
    volatility: volatility >= CONFIG.minVolatility,
    volumeSpike: volumeSpike >= CONFIG.minVolumeSpike,
    velocity: Math.abs(velocity) >= CONFIG.minVelocity,
    momentum: Math.abs(priceChange1m) >= CONFIG.minPriceChange1m,

    // Live checks - Modified imbalance rule for spoof pattern
    imbalance: imbalance >= CONFIG.minImbalance || isSpoofPattern, // Allow high imbalance for falling price (spoof detection)
    spread: spreadPercent <= CONFIG.maxSpread,

    // Order flow: asymmetric + volume-aware
    // If we don't have enough volume, ignore orderFlow (neutral)
    // If we have volume: LONG needs positive flow, SHORT needs negative flow
    orderFlow: !orderFlowReliable || // Not enough volume - pass
               (velocity > 0 && orderFlow >= 5000) ||  // LONG: need strong buy pressure ($5k+)
               (velocity < 0 && orderFlow <= -5000),   // SHORT: need strong sell pressure
  };

  // Count how many checks passed
  const passed = Object.values(checks).filter(v => v).length;
  const total = Object.keys(checks).length;
  const confidence = (passed / total) * 100;

  return {
    passed: passed === total, // All checks must pass
    confidence: confidence.toFixed(1),
    checks
  };
}

// ============================================================
// SCAN SINGLE SYMBOL
// ============================================================

async function scanSymbol(symbol) {
  try {
    // 1. Load historical candle data
    const candleData = loadCandleData(symbol);
    if (!candleData || !candleData.candles || candleData.candles.length === 0) {
      return null;
    }

    // Get latest candle
    const latestCandle = candleData.candles[candleData.candles.length - 1];

    // 2. Fetch live market data
    const liveData = await fetchLiveMarketData(symbol);
    if (!liveData) {
      return null;
    }

    // 3. Evaluate signal
    const evaluation = evaluateSignal(latestCandle, liveData);

    // 4. If signal passes all checks, UPDATE PERSISTENCE
    if (evaluation.passed) {
      // Determine direction based on velocity and imbalance
      const direction = latestCandle.velocity > 0 && liveData.imbalance > 1 ? 'LONG' : 'SHORT';

      // Update persistence tracker
      const cycleCount = updateSignalPersistence(symbol, direction);

      // 🚨 PERSISTENCE FILTER: Signal must be stable for N cycles
      if (!isSignalPersistent(symbol)) {
        // Signal seen, but not persistent yet (only {cycleCount}/{PERSISTENCE_CONFIG.minCycles} cycles)
        return null;
      }

      // ✅ Signal is PERSISTENT (seen for {cycleCount} cycles)

      // Use bid/ask if available, otherwise use price with estimated spread
      const entryPrice = liveData.price || 0;
      const bid = liveData.bid || entryPrice;
      const ask = liveData.ask || entryPrice;

      // Calculate entry
      const entry = direction === 'LONG' ? ask : bid;

      // Calculate TP/SL (raw values first)
      const tpRaw = direction === 'LONG'
        ? ask * 1.0035  // +0.35% for LONG (tighter TP, realistic target)
        : bid * 0.9965; // -0.35% for SHORT (price goes down)

      const slRaw = direction === 'LONG'
        ? bid * 0.9970  // -0.30% stop loss for LONG (wider SL, less noise)
        : ask * 1.0030; // +0.30% stop loss for SHORT

      // Format with correct precision
      const tp = formatPrice(tpRaw);
      const sl = formatPrice(slRaw);

      // Calculate expected profit (assuming $18 margin at 3x leverage = $54 position)
      const positionSize = 54; // $18 * 3x
      const expectedProfit = Math.abs((tp - entry) / entry) * positionSize;

      // Extract momentum for executor (needed for Phase 2 timing checks)
      // imbalance > 1.0 = more bids (bullish), < 1.0 = more asks (bearish)
      const imbalance = liveData.imbalance || 1.0;
      const initialMomentum = direction === 'LONG'
        ? Math.max(0, (imbalance - 1.0))  // LONG: excess bid pressure (imbalance > 1.0)
        : Math.max(0, (1.0 - imbalance));  // SHORT: excess ask pressure (imbalance < 1.0)

      const signal = {
        symbol,
        direction,
        confidence: evaluation.confidence,
        timestamp: new Date().toISOString(),

        // Entry/Exit prices (keep full precision)
        entry,
        tp,
        sl,
        expectedProfit,
        initialMomentum,  // Add momentum for executor recheck

        // Supporting data
        candle: {
          volatility: latestCandle.volatility,
          velocity: latestCandle.velocity,
          volumeSpike: latestCandle.volumeSpike,
          priceChange1m: latestCandle.priceChange1m
        },

        live: {
          price: liveData.price,
          imbalance: liveData.imbalance,
          spread: liveData.spread,
          orderFlowNet60s: liveData.orderFlowNet60s
        },

        checks: evaluation.checks
      };

      return signal;
    }

    return null;
  } catch (error) {
    console.error(`❌ Error scanning ${symbol}:`, error.message);
    return null;
  }
}

// ============================================================
// FAST TRACK - Rapid monitoring for top candidates
// ============================================================
let fastTrackSymbols = []; // { symbol, score, lastCheck }

async function updateFastTrack(topCandidates) {
  if (!FAST_TRACK_CONFIG.enabled) return;

  // Select top N candidates with score > threshold
  fastTrackSymbols = topCandidates
    .filter(c => c.score >= FAST_TRACK_CONFIG.minScore)
    .slice(0, FAST_TRACK_CONFIG.maxSymbols)
    .map(c => ({ symbol: c.symbol, score: c.score, lastCheck: Date.now() }));

  if (fastTrackSymbols.length > 0) {
    console.log(`⚡ Fast Track: Monitoring ${fastTrackSymbols.length} hot candidates (${fastTrackSymbols.map(f => f.symbol).join(', ')})`);
  }
}

// ============================================================
// LOG EXECUTION HISTORY
// ============================================================

function logExecutionHistory(execution) {
  try {
    const logEntry = JSON.stringify(execution) + '\n';
    fs.appendFileSync(CONFIG.executionLogFile, logEntry, 'utf-8');
  } catch (error) {
    console.error('❌ [LOG] Failed to write execution history:', error.message);
  }
}

// ============================================================
// EXECUTION TRIGGER
// ============================================================

async function attemptExecution(symbol, signalState, liveData) {
  const now = Date.now();

  // Check execution history
  const history = executionHistory.get(symbol);

  // Prevent duplicate executions (cooldown window)
  if (history && (now - history.lastExecution < FAST_TRACK_CONFIG.duplicateWindow)) {
    const remaining = Math.ceil((FAST_TRACK_CONFIG.duplicateWindow - (now - history.lastExecution)) / 1000);
    console.log(`⏸️  [EXECUTE] ${symbol} - Cooldown active (${remaining}s remaining)`);
    return;
  }

  // Check max attempts per signal
  const attempts = signalState.executionAttempts || 0;
  if (attempts >= FAST_TRACK_CONFIG.maxExecutionAttempts) {
    console.log(`⚠️  [EXECUTE] ${symbol} - Max execution attempts reached (${attempts}/${FAST_TRACK_CONFIG.maxExecutionAttempts})`);
    return;
  }

  // ===== RUN SAFETY CHECKS =====
  console.log(`\n🔍 [SAFETY] Running pre-execution checks for ${symbol}...`);

  const safetyResult = runAllSafetyChecks(
    {
      symbol,
      entry: signalState.entryZone.ideal,
      tp: signalState.tp,
      sl: signalState.sl
    },
    liveData,
    [], // activePositions - will be fetched from API
    {
      leverage: 3,           // Must match EXECUTION_CONFIG.defaultLeverage
      feeMode: "MAKER_FIRST" // BALANCED MODE: Maker entry (-0.02%) + Taker exit (0.06%) = 0.04% total
    }
  );

  if (!safetyResult.passed) {
    console.log(`❌ [SAFETY FAILED] ${symbol} - ${safetyResult.summary}`);
    safetyResult.failed.forEach(f => {
      console.log(`   ✗ ${f.check}: ${f.reason}`);
    });

    // Increment attempt counter
    signalState.executionAttempts = attempts + 1;
    return;
  }

  console.log(`✅ [SAFETY PASSED] ${symbol} - All checks OK`);

  // Prepare execution request
  const executionRequest = {
    symbol,
    direction: signalState.direction,
    entry: signalState.entryZone.ideal,
    tp: signalState.tp,
    sl: signalState.sl,
    confidence: signalState.confidence || 0,
    initialMomentum: signalState.initialMomentum || 0,  // Include momentum for executor
    entryZone: signalState.entryZone
  };

  console.log(`\n🚀 [EXECUTING] ${symbol} ${signalState.direction} @ ${formatPrice(executionRequest.entry)}`);
  console.log(`   TP: ${formatPrice(executionRequest.tp)} | SL: ${formatPrice(executionRequest.sl)}`);
  console.log(`   Entry Zone: ${formatEntryZoneDisplay(signalState.entryZone)}`);
  console.log(`   Initial Momentum: ${(executionRequest.initialMomentum * 100).toFixed(1)}% (from signalState)`);

  try {
    const response = await fetch(FAST_TRACK_CONFIG.executionApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(executionRequest)
    });

    const result = await response.json();

    if (result.ok) {
      console.log(`✅ [EXECUTED] ${symbol} - Order ID: ${result.orderId || 'DRY-RUN'}`);
      console.log(`   ${result.dryRun ? '🔒 DRY-RUN MODE' : '💰 LIVE TRADE'}`);

      // Update execution history
      executionHistory.set(symbol, {
        lastExecution: now,
        attempts: (history?.attempts || 0) + 1,
        orderId: result.orderId,
        dryRun: result.dryRun
      });

      // Mark signal as executed
      signalState.executed = true;
      signalState.executionTime = now;

      // Log to execution history file
      logExecutionHistory({
        symbol,
        direction: signalState.direction,
        entry: executionRequest.entry,
        tp: executionRequest.tp,
        sl: executionRequest.sl,
        success: true,
        dryRun: result.dryRun,
        orderId: result.orderId,
        timestamp: new Date().toISOString()
      });

    } else {
      console.log(`❌ [EXECUTE FAILED LINIJA 603 scalp signal scaner] ${symbol} - ${response} - ${result.error}`);

      // Increment attempt counter
      signalState.executionAttempts = attempts + 1;

      // Log failed execution
      logExecutionHistory({
        symbol,
        direction: signalState.direction,
        entry: executionRequest.entry,
        tp: executionRequest.tp,
        sl: executionRequest.sl,
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error(`❌ [EXECUTE ERROR] ${symbol}:`, error.message);
    signalState.executionAttempts = attempts + 1;

    // Log execution error
    logExecutionHistory({
      symbol,
      direction: signalState.direction,
      entry: executionRequest.entry,
      tp: executionRequest.tp,
      sl: executionRequest.sl,
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// ============================================================
// FAST TRACK MONITORING LOOP (2s checks)
// ============================================================

async function fastTrackLoop() {
  if (!FAST_TRACK_CONFIG.enabled || fastTrackSymbols.length === 0) return;

  const now = Date.now();

  for (const ft of fastTrackSymbols) {
    try {
      // Quick check: only live data (no file I/O)
      const liveData = await fetchLiveMarketData(ft.symbol);
      if (!liveData) continue;

      ft.lastCheck = now;

      // Check if this symbol has an active signal with entry zone
      const signalState = signalStates.get(ft.symbol);
      if (!signalState) continue;

      const elapsed = now - signalState.firstSeen;
      const currentPrice = liveData.price;

      // Track price movement
      signalState.priceHistory.push(currentPrice);
      if (signalState.priceHistory.length > 30) {
        signalState.priceHistory.shift(); // Keep last 30 prices (1 minute @ 2s interval)
      }

      // Check if price is in entry zone
      const inZone = isPriceInEntryZone(currentPrice, signalState.entryZone);
      const distanceInfo = getDistanceToEntryZone(currentPrice, signalState.entryZone);

      // Update signal state
      signalState.inZone = inZone;
      signalState.lastChecked = now;

      // === ENTRY ZONE MONITORING LOGIC ===

      // 1. Price IN ZONE → Signal ready for execution
      if (inZone && !signalState.readyForEntry) {
        signalState.readyForEntry = true;
        signalState.entryReadyTime = now;
        console.log(`🎯 [ENTRY READY] ${ft.symbol} ${signalState.direction} - Price ${formatPrice(currentPrice)} IN ZONE ${formatEntryZoneDisplay(signalState.entryZone)}`);

        // === AUTO-EXECUTION TRIGGER ===
        if (FAST_TRACK_CONFIG.autoExecute) {
          await attemptExecution(ft.symbol, signalState, liveData);
        }
      }

      // 2. Price moved OUT of zone after being ready
      if (!inZone && signalState.readyForEntry) {
        console.log(`⚠️  [ENTRY MISSED] ${ft.symbol} - Price moved out of zone (now ${distanceInfo.direction} by ${distanceInfo.distancePercent.toFixed(3)}%)`);
        signalState.readyForEntry = false;
      }

      // 3. Check if signal should be invalidated (timeout or price too far)
      if (shouldInvalidateSignal(currentPrice, signalState.entryZone, elapsed)) {
        console.log(`❌ [SIGNAL INVALID] ${ft.symbol} - Timeout (${(elapsed/1000).toFixed(0)}s) or price too far (${distanceInfo.distancePercent.toFixed(3)}%)`);
        signalStates.delete(ft.symbol);
        signalHistory.delete(ft.symbol);
        continue;
      }

      // 4. Adjust entry zone if timeout approaching and price not in zone
      if (elapsed > ENTRY_ZONE_CONFIG.timeoutMs * 0.7 && !inZone) {
        const adjustmentCount = signalState.adjustmentCount || 0;

        if (adjustmentCount < ENTRY_ZONE_CONFIG.maxAdjustments) {
          const adjustedZone = adjustEntryZoneTowardMarket(signalState.entryZone, currentPrice, signalState.direction);
          signalState.entryZone = adjustedZone;
          signalState.adjustmentCount = adjustedZone.adjustmentCount;

          console.log(`🔧 [ZONE ADJUST] ${ft.symbol} - Nudging entry zone toward market (adjustment ${adjustmentCount + 1}/${ENTRY_ZONE_CONFIG.maxAdjustments})`);
          console.log(`   New Zone: ${getEntryZoneDisplay(adjustedZone)}`);
        }
      }

      // 5. Sample logging (0.5% chance to avoid spam)
      if (Math.random() < 0.005) {
        const status = inZone ? '✅ IN_ZONE' : `⏳ ${distanceInfo.direction} ${distanceInfo.distancePercent.toFixed(3)}%`;
        console.log(`⚡ [FAST] ${ft.symbol}: ${status} | Age: ${(elapsed/1000).toFixed(0)}s | Flow: $${liveData.orderFlowNet60s?.toFixed(0) || 0}`);
      }

    } catch (error) {
      // Silent fail for fast track (don't spam logs)
    }
  }
}

// ============================================================
// SCAN ALL SYMBOLS (3-STAGE PROCESS)
// ============================================================
// STAGE 1: Collect all candidates with pre-score
// STAGE 2: Update hot list (top 30 get trade WS)
// STAGE 3: Generate signals (only for hot symbols with orderFlow)

async function scanAllSymbols() {
  console.log(`\n🔍 [${new Date().toISOString()}] Starting 3-stage signal scan...`);

  try {
    // Get tracked symbols from Engine (only symbols with orderbook data)
    let symbols = [];
    try {
      const response = await fetch(`${CONFIG.engineApiUrl}/api/tracked-symbols`);
      const data = await response.json();

      if (data.ok && data.symbols) {
        symbols = data.symbols;
        console.log(`📊 Stage 1: Scanning ${symbols.length} tracked symbols...`);
      } else {
        console.log(`⚠️  Could not fetch tracked symbols, falling back to file scan`);
        // Fallback to file scan
        const files = fs.readdirSync(CONFIG.dataDir);
        const symbolFiles = files.filter(f => f.endsWith('_live.json'));
        symbols = symbolFiles.map(f => f.replace('_live.json', ''));
        console.log(`📊 Stage 1: Scanning ${symbols.length} symbols from files...`);
      }
    } catch (error) {
      console.error(`❌ Error fetching tracked symbols:`, error.message);
      // Fallback to file scan
      const files = fs.readdirSync(CONFIG.dataDir);
      const symbolFiles = files.filter(f => f.endsWith('_live.json'));
      symbols = symbolFiles.map(f => f.replace('_live.json', ''));
      console.log(`📊 Stage 1: Scanning ${symbols.length} symbols from files (fallback)...`);
    }

    // ===========================================================
    // STAGE 1: COLLECT CANDIDATES (pre-filter with score)
    // ===========================================================
    const BATCH_SIZE = 50;
    const candidates = [];

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      // === BATCH API CALL (50 symbols at once) ===
      const liveDataMap = await fetchLiveMarketBatch(batch);

      // Rate-limit: 100ms pause between batches (prevents Engine overload)
      if (i + BATCH_SIZE < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const batchPromises = batch.map(async (symbol) => {
        try {
          // Load candle
          const candleData = loadCandleData(symbol);
          if (!candleData || !candleData.candles || candleData.candles.length === 0) {
            return null;
          }

          const latestCandle = candleData.candles[candleData.candles.length - 1];

          // Get live data from batch response
          const liveData = liveDataMap[symbol];
          if (!liveData) {
            return null;
          }

          // Calculate pre-score (for hotlist ranking)
          const score = calculateCandidateScore(latestCandle, liveData);

          // Evaluate if passes basic filters
          const evaluation = evaluateSignal(latestCandle, liveData);

          // Only consider symbols that pass basic checks
          if (evaluation.passed) {
            const direction = latestCandle.velocity > 0 && liveData.imbalance > 1 ? 'LONG' : 'SHORT';
            return {
              symbol,
              score,
              direction,
              candle: latestCandle,
              liveData
            };
          }

          return null;
        } catch (error) {
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const candidate of batchResults) {
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    console.log(`✅ Stage 1 complete: ${candidates.length} candidates found`);

    // ===========================================================
    // STAGE 2: UPDATE HOT LIST (top 30 get trade WS) + FAST TRACK
    // ===========================================================
    if (candidates.length > 0) {
      // Sort by score (highest first)
      candidates.sort((a, b) => b.score - a.score);

      // Update Fast Track with top candidates (before hot list API call)
      await updateFastTrack(candidates);

      // Take top 30 for hot list
      const FLOW_SYMBOL_LIMIT = 30;
      const hotSymbols = candidates.slice(0, FLOW_SYMBOL_LIMIT).map(c => c.symbol);

      // Send to Engine API to update trade WS subscriptions
      try {
        const response = await fetch(`${CONFIG.engineApiUrl}/api/flow/hotlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: hotSymbols })
        });

        if (!response.ok) {
          console.log(`⚠️  Stage 2: Engine API not ready yet (${response.status}), skipping hotlist update`);
        } else {
          const result = await response.json();

          if (result.ok) {
            console.log(`🔥 Stage 2 complete: Hotlist updated with ${hotSymbols.length} symbols`);
            if (result.result.changed) {
              console.log(`   Added: ${result.result.added.length}, Removed: ${result.result.removed.length}`);
            }
          } else {
            console.log(`⚠️  Stage 2: Hotlist update failed -`, result.error || 'Unknown error');
          }
        }
      } catch (error) {
        console.log(`⚠️  Stage 2: Cannot reach Engine API (${error.message}), skipping hotlist update`);
      }

      // Wait 500ms for trade WS to connect and receive first messages
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // ===========================================================
    // STAGE 3: GENERATE SIGNALS (with orderFlow validation + ENTRY ZONES)
    // ===========================================================
    const signals = [];

    for (const candidate of candidates) {
      const { symbol, direction, candle, liveData } = candidate;

      // Update persistence tracker with score
      const cycleCount = updateSignalPersistence(symbol, direction, candidate.score);

      // Check persistence requirement (score-based)
      if (!isSignalPersistent(symbol)) {
        continue;
      }

      // Re-evaluate with current data (including orderFlow from hotlist)
      const currentLiveData = await fetchLiveMarketData(symbol);
      if (!currentLiveData) continue;

      const evaluation = evaluateSignal(candle, currentLiveData);
      if (!evaluation.passed) continue;

      // ===== ENTRY ZONE CALCULATION (DEO) =====
      const entryPrice = currentLiveData.price || 0;
      const bid = currentLiveData.bid || entryPrice;
      const ask = currentLiveData.ask || entryPrice;

      // Calculate dynamic entry zone (NOT fixed point)
      const entryZone = calculateEntryZone(direction, bid, ask, entryPrice);

      // Format entry zone with correct precision
      const formattedEntryZone = formatEntryZone(entryZone);

      // Calculate TP/SL from IDEAL entry (raw first, then format)
      const tpRaw = direction === 'LONG'
        ? formattedEntryZone.ideal * 1.0035  // +0.35% (tighter, realistic)
        : formattedEntryZone.ideal * 0.9965; // -0.35%

      const slRaw = direction === 'LONG'
        ? formattedEntryZone.ideal * 0.9970  // -0.30% (wider, avoid noise)
        : formattedEntryZone.ideal * 1.0030; // +0.30%

      const tp = formatPrice(tpRaw);
      const sl = formatPrice(slRaw);

      // Calculate expected profit (from ideal entry)
      const positionSize = 54; // $18 * 3x
      const expectedProfit = Math.abs((tp - formattedEntryZone.ideal) / formattedEntryZone.ideal) * positionSize;

      // Check if price is CURRENTLY in entry zone
      const priceInZone = isPriceInEntryZone(entryPrice, formattedEntryZone);
      const distanceInfo = getDistanceToEntryZone(entryPrice, formattedEntryZone);

      // Extract initial momentum for executor
      // imbalance > 1.0 = more bids (bullish), < 1.0 = more asks (bearish)
      const imbalance = currentLiveData.imbalance || 1.0;
      const initialMomentum = direction === 'LONG'
        ? Math.max(0, (imbalance - 1.0))  // LONG: excess bid pressure (imbalance > 1.0)
        : Math.max(0, (1.0 - imbalance));  // SHORT: excess ask pressure (imbalance < 1.0)

      console.log(`📊 [MOMENTUM] ${symbol} ${direction}: imbalance=${imbalance.toFixed(3)}, momentum=${(initialMomentum * 100).toFixed(1)}%`);

      // Initialize signal state tracking
      signalStates.set(symbol, {
        entryZone: formattedEntryZone,
        direction,
        tp,
        sl,
        confidence: evaluation.confidence,
        initialMomentum,  // Store momentum for executor
        firstSeen: Date.now(),
        lastChecked: Date.now(),
        adjustmentCount: 0,
        priceHistory: [entryPrice],
        inZone: priceInZone,
        executionAttempts: 0
      });

      const signal = {
        symbol,
        direction,
        confidence: evaluation.confidence,
        timestamp: new Date().toISOString(),

        // Entry zone (NOT single point)
        entry: formattedEntryZone.ideal,  // Keep for backward compatibility
        entryZone: {
          min: formattedEntryZone.min,
          ideal: formattedEntryZone.ideal,
          max: formattedEntryZone.max,
          display: formatEntryZoneDisplay(formattedEntryZone)
        },
        entryStatus: {
          inZone: priceInZone,
          distancePercent: distanceInfo.distancePercent,
          direction: distanceInfo.direction
        },

        tp,
        sl,
        expectedProfit,

        // Extract momentum for executor (needed for Phase 2 timing checks)
        initialMomentum,

        candle: {
          volatility: candle.volatility,
          velocity: candle.velocity,
          volumeSpike: candle.volumeSpike,
          priceChange1m: candle.priceChange1m
        },
        live: {
          price: currentLiveData.price,
          bid: currentLiveData.bid,
          ask: currentLiveData.ask,
          imbalance: currentLiveData.imbalance,
          spread: currentLiveData.spread,
          orderFlowNet60s: currentLiveData.orderFlowNet60s
        },
        checks: evaluation.checks
      };

      signals.push(signal);
    }

    console.log(`✅ Stage 3 complete: ${signals.length} persistent signals generated`);

    // Log results
    if (signals.length > 0) {
      console.log(`\n🎯 Found ${signals.length} signals:\n`);
      signals.forEach(s => {
        const entryStatus = s.entryStatus.inZone ? '✅ IN ZONE' : `⏳ ${s.entryStatus.direction} (${s.entryStatus.distancePercent.toFixed(3)}%)`;
        const currentPrice = formatPrice(s.live.price);
        console.log(`  ${s.symbol} ${s.direction} | Entry Zone: ${s.entryZone.display}`);
        console.log(`    Status: ${entryStatus} | Current: ${currentPrice}`);
        console.log(`    TP: ${formatPrice(s.tp)} | SL: ${formatPrice(s.sl)} | Confidence: ${s.confidence}%`);
        console.log(`    Volatility: ${s.candle.volatility?.toFixed(2)}% | Volume: ${s.candle.volumeSpike?.toFixed(1)}x`);
        console.log(`    Imbalance: ${s.live.imbalance?.toFixed(2)} | OrderFlow: $${s.live.orderFlowNet60s?.toFixed(0) || 0}\n`);
      });

      // Save signals to file
      if (CONFIG.saveSignals) {
        const signalsData = {
          timestamp: new Date().toISOString(),
          count: signals.length,
          signals
        };
        fs.writeFileSync(CONFIG.signalsFile, JSON.stringify(signalsData, null, 2));
        console.log(`💾 Signals saved to ${CONFIG.signalsFile}`);
      }
    } else {
      console.log(`⚠️  No signals found in this scan cycle`);
    }

    // Cleanup old signal history entries
    cleanupOldSignals();

    console.log(`✅ Scan complete\n`);
    return signals;

  } catch (error) {
    console.error(`❌ Error during scan:`, error.message);
    return [];
  }
}

// ============================================================
// MAIN LOOP
// ============================================================

async function main() {
  console.log('\n🚀 SCALP SIGNAL SCANNER - STARTING\n');
  console.log('='.repeat(60));
  console.log(`Data Dir:         ${CONFIG.dataDir}`);
  console.log(`Engine API:       ${CONFIG.engineApiUrl}`);
  console.log(`Scan Interval:    ${CONFIG.scanInterval / 1000}s`);
  console.log(`Fast Track:       ${FAST_TRACK_CONFIG.enabled ? `${FAST_TRACK_CONFIG.interval / 1000}s (top ${FAST_TRACK_CONFIG.maxSymbols})` : 'DISABLED'}`);
  console.log(`Persistence:      Score-based (1-3 cycles = 30-90s)`);
  console.log('='.repeat(60));
  console.log('\nFilters:');
  console.log(`  Min Volatility:    ${CONFIG.minVolatility}%`);
  console.log(`  Min Volume Spike:  ${CONFIG.minVolumeSpike}x`);
  console.log(`  Min Velocity:      ${CONFIG.minVelocity}%/min`);
  console.log(`  Min Momentum:      ${CONFIG.minPriceChange1m}%`);
  console.log(`  Min Imbalance:     ${CONFIG.minImbalance}`);
  console.log(`  Max Spread:        ${CONFIG.maxSpread}%`);
  console.log(`  Order Flow Vol:    min $${FAST_TRACK_CONFIG.minOrderFlowVolume} (60s)`);
  console.log('='.repeat(60) + '\n');

  // Wait 15 seconds for Engine to be fully ready (WS connection + initial data)
  console.log('⏳ Waiting 15s for Engine to fully initialize (WS connection + data)...\n');
  await new Promise(resolve => setTimeout(resolve, 15000));

  // Run first scan
  await scanAllSymbols();

  // Start periodic full scans (30s)
  setInterval(async () => {
    await scanAllSymbols();
  }, CONFIG.scanInterval);

  // Start Fast Track loop (2s rapid monitoring for top candidates)
  if (FAST_TRACK_CONFIG.enabled) {
    setInterval(async () => {
      await fastTrackLoop();
    }, FAST_TRACK_CONFIG.interval);
    console.log('⚡ Fast Track loop started (2s interval for hot candidates)\n');
  }

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    process.exit(0);
  });

  console.log('✅ Signal Scanner is running! Press Ctrl+C to stop.\n');
}

// Start the scanner
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
