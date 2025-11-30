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
import { formatPriceByTick } from './utils/priceFormatter.js';
import { fetchInstrumentsUSDTPerp } from '../src/connectors/bybitPublic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// TICKSIZE & QTYSTEP CACHE (LOADED ONCE AT START)
// ============================================================

let instrumentMeta = new Map();

async function preloadInstrumentsCache() {
  try {
    const instruments = await fetchInstrumentsUSDTPerp();
    if (instruments.success && instruments.symbols) {
      for (const s of instruments.symbols) {
        instrumentMeta.set(s.symbol, {
          tickSize: parseFloat(s.tickSize),
          qtyStep: parseFloat(s.qtyStep)
        });
      }
      console.log(`🔧 Loaded ${instrumentMeta.size} instruments into tickSize cache`);
    }
  } catch (err) {
    console.error("❌ Failed to preload instrument metadata:", err.message);
  }
}

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
  minCycles: 0,           // INSTANT: 0 cycles (signal appears immediately when detected)
  maxAge: 120000,         // Clear old signals after 2 minutes
  resetOnDirectionChange: true,  // Reset counter if direction flips

  // Score-based persistence (for micro-scalping 0.22% TP)
  scoreThresholds: {
    instant: 0,   // Score > 90: instant (0s)
    fast: 0,      // Score > 75: instant (0s)
    normal: 0     // Score <= 75: instant (0s)
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

// Smart Entry Timing: Optimal entry detection (Hybrid approach)
const SMART_ENTRY_CONFIG = {
  // Hard filters - ABORT signal immediately
  hardFilters: {
    LONG: {
      maxRangePosition: 85,    // Skip if price > 85% of range (too high, top catching)
      minRangePosition: 10     // Skip if price < 10% of range (falling knife)
    },
    SHORT: {
      maxRangePosition: 90,    // Skip if price > 90% of range (knife catching top)
      minRangePosition: 15     // Skip if price < 15% of range (too low for short)
    }
  },

  // Sweet spot detection (optimal entry zone within entry zone)
  sweetSpot: {
    pullbackBestDown: 0.05,    // LONG: 0.05% below ideal = best entry
    pullbackBestUp: 0.03,      // LONG: 0.03% above ideal = acceptable
    maxExtraPullback: 0.20     // Max 0.20% below ideal (deeper = knife)
  },

  // Momentum requirements for entry
  momentum: {
    minImbalanceLong: 1.05,    // LONG needs imbalance > 1.05 (very lenient - was 1.3)
    maxImbalanceShort: 0.95,   // SHORT needs imbalance < 0.95 (very lenient - was 0.77)
    maxSpread: 1.0             // Max 1% spread to execute (was 0.15%)
  }
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
// SMART ENTRY TIMING - HELPER FUNCTIONS
// ============================================================

/**
 * Calculate price position in recent range (0-100%)
 * Uses priceHistory to determine high/low of recent movement
 */
function calculateRangePosition(currentPrice, priceHistory) {
  if (!priceHistory || priceHistory.length < 5) {
    return 50; // Default to middle if not enough data
  }

  const high = Math.max(...priceHistory);
  const low = Math.min(...priceHistory);
  const range = high - low;

  if (range === 0) return 50; // No movement

  const position = ((currentPrice - low) / range) * 100;
  return Math.max(0, Math.min(100, position)); // Clamp 0-100
}

/**
 * Check hard filters - returns { passed: bool, reason: string }
 * LONG: Skip if too high (>85%) or too low (<10%) in range
 * SHORT: Skip if too low (<15%) or too high (>90%) in range
 */
function checkHardFilters(direction, rangePosition) {
  const filters = SMART_ENTRY_CONFIG.hardFilters[direction];
  if (!filters) return { passed: true };

  if (direction === 'LONG') {
    if (rangePosition > filters.maxRangePosition) {
      return { passed: false, reason: `price_too_high_${rangePosition.toFixed(0)}%_of_range` };
    }
    if (rangePosition < filters.minRangePosition) {
      return { passed: false, reason: `falling_knife_${rangePosition.toFixed(0)}%_of_range` };
    }
  } else if (direction === 'SHORT') {
    if (rangePosition < filters.minRangePosition) {
      return { passed: false, reason: `price_too_low_${rangePosition.toFixed(0)}%_of_range` };
    }
    if (rangePosition > filters.maxRangePosition) {
      return { passed: false, reason: `top_catching_${rangePosition.toFixed(0)}%_of_range` };
    }
  }

  return { passed: true };
}

/**
 * Check if price is in sweet spot for optimal entry
 * LONG: Sweet spot is slightly below ideal (pullback zone)
 * SHORT: Sweet spot is slightly above ideal (bounce zone)
 */
function isInSweetSpot(currentPrice, idealEntry, direction) {
  const { pullbackBestDown, pullbackBestUp } = SMART_ENTRY_CONFIG.sweetSpot;

  if (direction === 'LONG') {
    // LONG sweet spot: ideal - 0.05% to ideal + 0.03%
    const goodMin = idealEntry * (1 - pullbackBestDown / 100);
    const goodMax = idealEntry * (1 + pullbackBestUp / 100);
    return currentPrice >= goodMin && currentPrice <= goodMax;
  } else if (direction === 'SHORT') {
    // SHORT sweet spot: ideal - 0.03% to ideal + 0.05% (inverted)
    const goodMin = idealEntry * (1 - pullbackBestUp / 100);
    const goodMax = idealEntry * (1 + pullbackBestDown / 100);
    return currentPrice >= goodMin && currentPrice <= goodMax;
  }

  return false;
}

/**
 * Check if momentum is sufficient for entry
 */
function checkMomentum(liveData, direction, candle) {
  const { minImbalanceLong, maxImbalanceShort, maxSpread } = SMART_ENTRY_CONFIG.momentum;
  const imbalance = liveData.imbalance || 1.0;
  const spreadPercent = parseFloat(liveData.spreadPercent) || 0;
  const velocity = Math.abs(candle?.velocity ?? 0);
  const volumeSpike = candle?.volumeSpike ?? 0;

  // Spread check (common for both)
  if (spreadPercent > maxSpread) {
    return { passed: false, reason: `spread_too_wide_${spreadPercent.toFixed(3)}%` };
  }

  // Minimum velocity check (need some price movement)
  const minVelocity = 0.1; // At least 0.1% price movement
  if (velocity < minVelocity) {
    return { passed: false, reason: `insufficient_velocity_${velocity.toFixed(4)}%_need_${minVelocity}%` };
  }

  // Direction-specific imbalance check
  if (direction === 'LONG') {
    if (imbalance < minImbalanceLong) {
      return { passed: false, reason: `weak_momentum_imb_${imbalance.toFixed(2)}_need_${minImbalanceLong}` };
    }
  } else if (direction === 'SHORT') {
    if (imbalance > maxImbalanceShort) {
      console.log(`❌ [MOMENTUM-REJECT] SHORT failed: imbalance=${imbalance.toFixed(4)} > max=${maxImbalanceShort}`);
      return { passed: false, reason: `weak_momentum_imb_${imbalance.toFixed(2)}_need_max_${maxImbalanceShort}` };
    }
  }

  return { passed: true };
}

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  dataDir: path.join(__dirname, '../data/live'),
  engineApiUrl: 'http://localhost:8090',

  // Scan interval - Balance between responsiveness and resource usage
  scanInterval: 10000, // 10 seconds - FAST for scalping (was 30s)

  // Historical filters (from candles) - ZERO REQUIREMENTS FOR QUIET MARKET
  minVolatility: 0.0,        // 0.0% = NO VOLATILITY REQUIREMENT (accept flat market)
  minVolumeSpike: 0.0,       // 0.0x = NO SPIKE REQUIRED (accept any volume)
  minVelocity: 0.001,        // 0.001%/min (accept ANY movement)
  minPriceChange1m: 0.0,     // 0.0% = NO MOMENTUM REQUIREMENT

  // Live filters (from Engine API)
  minImbalance: 1.0,         // 1.0x = NO IMBALANCE REQUIREMENT (was 1.3 - allows ANY distribution)
  maxSpread: 0.5,            // 0.5% max spread (increased from 0.2% - very lenient)
  minOrderFlow: 0,           // Positive order flow (more buys than sells)

  // Debug mode: show rejection reasons
  debugFilters: false,        // Disable debug for performance

  // Output
  logSignals: true,
  saveSignals: true,
  signalsFile: path.join(__dirname, '../data/signals.json'),
  executionLogFile: path.join(__dirname, '../data/execution_history.json')
};

// ============================================================
// LIVE DATA MANAGER (Centralized API control)
// ============================================================
class LiveDataManager {
  constructor() {
    this.data = new Map(); // symbol -> live data
    this.lastBatchFetch = 0;
    this.trackedSymbols = [];
    this.REFRESH_INTERVAL = 30000; // 30s - synchronized with Stage 1 scan interval
  }

  // Update tracked symbols list
  setTrackedSymbols(symbols) {
    this.trackedSymbols = symbols;
  }

  // Get data for a symbol (from last batch fetch)
  get(symbol) {
    return this.data.get(symbol) || null;
  }

  // Check if data needs refresh
  needsRefresh() {
    const now = Date.now();
    return (now - this.lastBatchFetch) >= this.REFRESH_INTERVAL;
  }

  // Fetch batch data if needed (centralized control)
  async refreshIfNeeded() {
    if (!this.needsRefresh()) {
      return this.data; // Return existing data
    }

    if (this.trackedSymbols.length === 0) {
      return this.data;
    }

    console.log(`🔄 [DATA] Refreshing ${this.trackedSymbols.length} symbols...`);

    try {
      const BATCH_SIZE = 50;
      const newData = new Map();

      for (let i = 0; i < this.trackedSymbols.length; i += BATCH_SIZE) {
        const batch = this.trackedSymbols.slice(i, i + BATCH_SIZE);
        const results = await fetchLiveMarketBatch(batch);

        for (const [symbol, data] of Object.entries(results)) {
          newData.set(symbol, data);
        }

        // Rate limit between batches
        if (i + BATCH_SIZE < this.trackedSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      this.data = newData;
      this.lastBatchFetch = Date.now();
      console.log(`✅ [DATA] Refreshed ${newData.size} symbols`);

      return this.data;
    } catch (error) {
      console.error(`❌ [DATA] Batch refresh failed:`, error.message);
      return this.data; // Return old data on error
    }
  }

  // Force fresh fetch for a single symbol (for execution)
  async fetchFreshSingle(symbol) {
    try {
      const url = `${CONFIG.engineApiUrl}/api/live-market/${symbol}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`⚠️  [DATA] HTTP ${response.status} for ${symbol}`);
        return this.data.get(symbol) || null; // Fallback to cached
      }

      const text = await response.text();
      const data = JSON.parse(text);

      if (data.ok) {
        // Update cache with fresh data
        this.data.set(symbol, data.live);
        return data.live;
      }

      return this.data.get(symbol) || null;
    } catch (error) {
      console.error(`❌ [DATA] Fresh fetch failed for ${symbol}:`, error.message);
      return this.data.get(symbol) || null; // Fallback to cached
    }
  }

  // Get age of last refresh
  getAge() {
    return Date.now() - this.lastBatchFetch;
  }
}

// Global instance
const liveDataManager = new LiveDataManager();

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
// FETCH BATCH LIVE MARKET DATA (used by LiveDataManager)
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

    // Handle engine not ready (support both old and new error strings)
    if (response.status === 503 || data.error === 'metricsWS not initialized' || data.error === 'BybitPublicWS not initialized') {
      console.warn('⏳ [SCANNER] Engine WS not ready (waiting metricsWS). Retrying next cycle...');
      return {};
    }

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

function evaluateSignal(candle, liveData, debugSymbol = null) {
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
    // Historical checks - RELAXED FOR QUIET MARKETS
    volatility: volatility >= CONFIG.minVolatility,
    // Volume spike: OPTIONAL - allow if velocity exists or ANY movement detected
    volumeSpike: volumeSpike >= CONFIG.minVolumeSpike || Math.abs(velocity) > 0.003 || Math.abs(imbalance - 1.0) > 0.05, // Allow with ANY movement or significant imbalance
    velocity: Math.abs(velocity) >= CONFIG.minVelocity,
    // Momentum: OPTIONAL - allow if velocity is present OR momentum meets threshold
    momentum: Math.abs(velocity) > 0.005 || Math.abs(priceChange1m) >= CONFIG.minPriceChange1m,

    // Live checks - REMOVED imbalance check here (it depends on direction which we don't know yet)
    // Imbalance is checked in checkMomentum() after direction is determined
    // Just check spread here
    spread: spreadPercent <= CONFIG.maxSpread,

    // Order flow: RELAXED for low-volume periods
    // Allow signals if we can't evaluate order flow (no volume)
    orderFlow: !orderFlowReliable, // Not enough volume - allow signal to pass (ignore orderFlow check)
  };

  // Count how many checks passed
  const passed = Object.values(checks).filter(v => v).length;
  const total = Object.keys(checks).length;
  const confidence = (passed / total) * 100;

  // DEBUG: Log rejection reasons if enabled
  if (CONFIG.debugFilters && debugSymbol && passed < total) {
    const failedChecks = Object.entries(checks)
      .filter(([k, v]) => !v)
      .map(([k, v]) => k)
      .join(', ');
    console.log(`  [DEBUG] ${debugSymbol} REJECTED: failed=[${failedChecks}] vol=${candle.volatility?.toFixed(4) || '0'}% vs ${CONFIG.minVolatility}%, spike=${candle.volumeSpike?.toFixed(2) || '0'}x vs ${CONFIG.minVolumeSpike}x, vel=${Math.abs(candle.velocity || 0).toFixed(4)}% vs ${CONFIG.minVelocity}%, imb=${liveData.imbalance?.toFixed(2) || '1.0'} vs ${CONFIG.minImbalance}x`);
  }

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
      // Determine direction based on imbalance (> 1.0 = more bids = LONG, <= 1.0 = more asks = SHORT)
      const direction = liveData.imbalance > 1.0 ? 'LONG' : 'SHORT';

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

      // =====================================================
      // GET TICKSIZE FROM CACHE (Precision Fix)
      // =====================================================
      const meta = instrumentMeta.get(symbol);
      const tickSize = meta?.tickSize || 0.0001; // fallback if not in cache

      // Calculate entry
      const entryRaw = direction === 'LONG' ? ask : bid;

      // Calculate TP/SL (raw values first)
      const tpRaw = direction === 'LONG'
        ? ask * 1.0035  // +0.35% for LONG (tighter TP, realistic target)
        : bid * 0.9965; // -0.35% for SHORT (price goes down)

      const slRaw = direction === 'LONG'
        ? bid * 0.9970  // -0.30% stop loss for LONG (wider SL, less noise)
        : ask * 1.0030; // +0.30% stop loss for SHORT

      // Format with tickSize precision (Bybit-compliant)
      const entry = parseFloat(formatPriceByTick(entryRaw, tickSize));
      const tp = parseFloat(formatPriceByTick(tpRaw, tickSize));
      const sl = parseFloat(formatPriceByTick(slRaw, tickSize));

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

  // Check if execution already in progress
  if (signalState.executionInProgress) {
    console.log(`⏳ [EXECUTE] ${symbol} - Execution already in progress, skipping...`);
    return;
  }

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

  const ts = signalState.tickSize || 0.0001;
  console.log(`\n🚀 [EXECUTING] ${symbol} ${signalState.direction} @ ${formatPriceByTick(executionRequest.entry, ts)}`);
  console.log(`   TP: ${formatPriceByTick(executionRequest.tp, ts)} | SL: ${formatPriceByTick(executionRequest.sl, ts)}`);
  console.log(`   Entry Zone: [${signalState.entryZone.min} — ${signalState.entryZone.ideal} — ${signalState.entryZone.max}]`);
  console.log(`   Initial Momentum: ${(executionRequest.initialMomentum * 100).toFixed(1)}% (from signalState)`);

  // Fire-and-forget: Send execution request WITHOUT waiting for response
  // This prevents execution from blocking Stage 1 refresh
  fetch(FAST_TRACK_CONFIG.executionApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(executionRequest)
  }).then(async response => {
    try {
      const result = await response.json();

      if (result.ok) {
        console.log(`✅ [EXECUTED] ${symbol} - Order ID: ${result.orderId || 'DRY-RUN'}`);
        console.log(`   ${result.dryRun ? '🔒 DRY-RUN MODE' : '💰 LIVE TRADE'}`);

        // Update execution history
        executionHistory.set(symbol, {
          lastExecution: Date.now(),
          attempts: (history?.attempts || 0) + 1,
          orderId: result.orderId,
          dryRun: result.dryRun
        });

        // Mark signal as executed and clear in-progress flag
        signalState.executed = true;
        signalState.executionTime = Date.now();
        signalState.executionInProgress = false;

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
        console.log(`❌ [EXECUTE FAILED] ${symbol} - ${result.error}`);

        // Increment attempt counter and clear in-progress flag
        signalState.executionAttempts = (signalState.executionAttempts || 0) + 1;
        signalState.executionInProgress = false;

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
      signalState.executionAttempts = (signalState.executionAttempts || 0) + 1;
      signalState.executionInProgress = false;

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
  }).catch(error => {
    console.error(`❌ [EXECUTE ERROR] ${symbol}:`, error.message);
    signalState.executionAttempts = (signalState.executionAttempts || 0) + 1;
    signalState.executionInProgress = false;

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
  });

  // Mark as execution in progress (prevent duplicate attempts)
  signalState.executionInProgress = true;
  signalState.executionAttempts = attempts + 1;
}

// ============================================================
// FAST TRACK MONITORING LOOP (2s checks)
// ============================================================

async function fastTrackLoop() {
  if (!FAST_TRACK_CONFIG.enabled || fastTrackSymbols.length === 0) return;

  const now = Date.now();

  // Use data from Stage 1 (refreshed every 30s) - NO REFRESH in FastTrack!
  // FastTrack monitors using existing data, Stage 1 is the single source of truth

  for (const ft of fastTrackSymbols) {
    try {
      // Get data from manager (no API call, uses batch refresh)
      const liveData = liveDataManager.get(ft.symbol);
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

      // === SMART ENTRY TIMING LOGIC (HYBRID APPROACH) ===

      // 1. Calculate range position (0-100% of recent price range)
      const rangePosition = calculateRangePosition(currentPrice, signalState.priceHistory);

      // 2. HARD FILTERS - Check falling knife / top catching (ABORT IMMEDIATELY)
      const hardFilterResult = checkHardFilters(signalState.direction, rangePosition);
      if (!hardFilterResult.passed) {
        console.log(`❌ [HARD FILTER] ${ft.symbol} - ${hardFilterResult.reason} - SIGNAL ABORTED`);
        signalStates.delete(ft.symbol);
        signalHistory.delete(ft.symbol);
        continue;
      }

      // 3. Price IN ZONE → Check for optimal entry timing
      if (inZone && !signalState.readyForEntry) {
        const idealEntry = signalState.entryZone.ideal;
        const minEntry = signalState.entryZone.min;
        const maxEntry = signalState.entryZone.max;

        let shouldEnter = false;
        let entryReason = '';

        // 3a. Check if in sweet spot (optimal pullback zone)
        const inSweetSpot = isInSweetSpot(currentPrice, idealEntry, signalState.direction);

        if (inSweetSpot) {
          // Perfect entry - in sweet spot zone
          shouldEnter = true;
          entryReason = 'in_sweet_spot_pullback';
        } else if (signalState.direction === 'LONG') {
          // LONG fallback: Allow entry at lower boundary
          if (currentPrice <= minEntry * 1.0005) {
            shouldEnter = true;
            entryReason = 'at_lower_boundary';
          }
        } else if (signalState.direction === 'SHORT') {
          // SHORT fallback: Allow entry at upper boundary
          if (currentPrice >= maxEntry * 0.9995) {
            shouldEnter = true;
            entryReason = 'at_upper_boundary';
          }
        }

        // 3b. If position looks good, validate momentum
        if (shouldEnter) {
          const momentumCheck = checkMomentum(liveData, signalState.direction);

          if (!momentumCheck.passed) {
            console.log(`⚠️  [MOMENTUM] ${ft.symbol} - ${momentumCheck.reason} - waiting for better momentum`);
            shouldEnter = false;
          }
        }

        // 3c. Execute if all checks passed
        if (shouldEnter) {
          signalState.readyForEntry = true;
          signalState.entryReadyTime = now;

          // Parse tickSize to avoid floating point artifacts with ultra-small values
          const ts = signalState.tickSize ? parseFloat(signalState.tickSize) : 0.0001;

          console.log(`🎯 [ENTRY READY] ${ft.symbol} ${signalState.direction} - Price ${formatPriceByTick(currentPrice, ts)} (${entryReason})`);
          console.log(`   Range Position: ${rangePosition.toFixed(1)}% | Imbalance: ${liveData.imbalance?.toFixed(2)} | Spread: ${liveData.spreadPercent}%`);

          // === AUTO-EXECUTION TRIGGER ===
          if (FAST_TRACK_CONFIG.autoExecute) {
            // Fetch FRESH data for execution (force single fetch)
            const freshData = await liveDataManager.fetchFreshSingle(ft.symbol);
            await attemptExecution(ft.symbol, signalState, freshData || liveData);
          }
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
    // STAGE 1: COLLECT CANDIDATES (using centralized data manager)
    // ===========================================================

    // Set tracked symbols in manager
    liveDataManager.setTrackedSymbols(symbols);

    // Refresh data (batch fetch if needed)
    await liveDataManager.refreshIfNeeded();

    const candidates = [];

    for (const symbol of symbols) {
      try {
        // Load candle
        const candleData = loadCandleData(symbol);
        if (!candleData || !candleData.candles || candleData.candles.length === 0) {
          continue;
        }

        const latestCandle = candleData.candles[candleData.candles.length - 1];

        // Get live data from manager (no API call!)
        const liveData = liveDataManager.get(symbol);
        if (!liveData) {
          continue;
        }

        // Calculate pre-score (for hotlist ranking)
        const score = calculateCandidateScore(latestCandle, liveData);

        // Evaluate if passes basic filters
        const evaluation = evaluateSignal(latestCandle, liveData, symbol);

        // Only consider symbols that pass basic checks
        if (evaluation.passed) {
          const direction = liveData.imbalance > 1.0 ? 'LONG' : 'SHORT';  // imbalance > 1 = more bids (bullish) = LONG
          console.log(`📍 [STAGE1] ${symbol}: imbalance=${(liveData.imbalance || 1.0).toFixed(4)} → direction=${direction}`);
          candidates.push({
            symbol,
            score,
            direction,
            candle: latestCandle,
            liveData
          });
        }
      } catch (error) {
        // Silent fail
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
    // STAGE 3: GENERATE SIGNALS (using manager data - NO API CALLS!)
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

      // Use live data from manager (already fresh from Stage 1, max 2s old)
      const currentLiveData = liveDataManager.get(symbol);
      if (!currentLiveData) continue;

      const evaluation = evaluateSignal(candle, currentLiveData);
      if (!evaluation.passed) continue;

      // ✅ VALIDATION: Check momentum constraints for this direction
      // This ensures LONG signals have sufficient bid pressure and SHORT signals have sufficient ask pressure
      const momentumCheck = checkMomentum(currentLiveData, direction, candle);
      if (!momentumCheck.passed) {
        continue;  // Signal direction doesn't have sufficient momentum, skip it
      }

      // ===== ENTRY ZONE CALCULATION (DEO) =====
      const entryPrice = currentLiveData.price || 0;
      const bid = currentLiveData.bid || entryPrice;
      const ask = currentLiveData.ask || entryPrice;

      // Get tickSize from cache BEFORE calculateEntryZone (no API call!)
      const meta = instrumentMeta.get(symbol);
      const tickSize = meta?.tickSize || 0.0001; // fallback if not in cache

      // Calculate dynamic entry zone with tickSize precision
      const entryZone = calculateEntryZone(direction, bid, ask, entryPrice, tickSize);

      // Entry zone is already tick-rounded by calculateEntryZone, use directly
      const formattedEntryZone = {
        min: entryZone.min,
        ideal: entryZone.ideal,
        max: entryZone.max
      };

      // Calculate TP/SL from IDEAL entry (raw first, then format)
      const tpRaw = direction === 'LONG'
        ? formattedEntryZone.ideal * 1.0035  // +0.35% (tighter, realistic)
        : formattedEntryZone.ideal * 0.9965; // -0.35%

      const slRaw = direction === 'LONG'
        ? formattedEntryZone.ideal * 0.9970  // -0.30% (wider, avoid noise)
        : formattedEntryZone.ideal * 1.0030; // +0.30%

      const tp = parseFloat(formatPriceByTick(tpRaw, tickSize));
      const sl = parseFloat(formatPriceByTick(slRaw, tickSize));

      // Calculate expected profit (from ideal entry)
      const positionSize = 54; // $18 * 3x
      const expectedProfit = Math.abs((tp - formattedEntryZone.ideal) / formattedEntryZone.ideal) * positionSize;

      // Check if price is CURRENTLY in entry zone
      const priceInZone = isPriceInEntryZone(entryPrice, formattedEntryZone);
      const distanceInfo = getDistanceToEntryZone(entryPrice, formattedEntryZone);

      // Extract initial momentum for executor
      // imbalance > 1.0 = more bids (bullish), < 1.0 = more asks (bearish)
      const imbalance = currentLiveData.imbalance || 1.0;

      // DEBUG: Log imbalance values to identify pattern
      console.log(`🔍 [DEBUG] ${symbol}: Stage1_direction=${direction}, CurrentImbalance=${imbalance.toFixed(4)}`);

      let initialMomentum = 0;
      if (direction === 'LONG') {
        // LONG: needs strong bid pressure (imbalance > 1.0)
        initialMomentum = Math.max(0, (imbalance - 1.0));
      } else if (direction === 'SHORT') {
        // SHORT: needs strong ask pressure (imbalance < 1.0)
        // If imbalance is 0.5, momentum = 0.5 (50% excess asks)
        // If imbalance is 0.77, momentum = 0.23 (23% excess asks)
        // If imbalance is > 1.0, momentum = 0 (bullish market - bad for SHORT)
        initialMomentum = imbalance < 1.0 ? Math.max(0, (1.0 - imbalance)) : 0;
      }

      console.log(`📊 [MOMENTUM] ${symbol} ${direction}: imbalance=${imbalance.toFixed(3)}, momentum=${(initialMomentum * 100).toFixed(1)}%`);

      // Initialize signal state tracking
      signalStates.set(symbol, {
        entryZone: formattedEntryZone,
        direction,
        tp,
        sl,
        confidence: evaluation.confidence,
        initialMomentum,  // Store momentum for executor
        tickSize,          // Store tickSize for FastTrack precision
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
          display: `[${formattedEntryZone.min} — ${formattedEntryZone.ideal} — ${formattedEntryZone.max}]`
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
        const currentPrice = s.live.price.toFixed(4);
        console.log(`  ${s.symbol} ${s.direction} | Entry Zone: ${s.entryZone.display}`);
        console.log(`    Status: ${entryStatus} | Current: ${currentPrice}`);
        console.log(`    TP: ${s.tp.toFixed(4)} | SL: ${s.sl.toFixed(4)} | Confidence: ${s.confidence}%`);
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

  // Preload tickSize/qtyStep cache (eliminates 200+ API calls per cycle)
  console.log('🔧 Preloading instrument metadata cache...');
  await preloadInstrumentsCache();
  console.log('');

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
