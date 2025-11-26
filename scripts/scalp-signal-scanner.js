// ============================================================
// SCALP SIGNAL SCANNER
// Combines historical candle data + live market state
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// SIGNAL PERSISTENCE TRACKER
// Tracks how many consecutive cycles a signal has been valid
// ============================================================

const signalHistory = new Map(); // symbol -> { direction, count, firstSeen }

const PERSISTENCE_CONFIG = {
  minCycles: 3,           // Signal must persist for 3 cycles (3 seconds at 1s interval)
  maxAge: 10000,          // Clear old signals after 10 seconds
  resetOnDirectionChange: true  // Reset counter if direction flips
};

function updateSignalPersistence(symbol, direction) {
  const now = Date.now();
  const existing = signalHistory.get(symbol);

  if (!existing) {
    // First time seeing this signal
    signalHistory.set(symbol, { direction, count: 1, firstSeen: now, lastSeen: now });
    return 1;
  }

  // Check if direction changed
  if (PERSISTENCE_CONFIG.resetOnDirectionChange && existing.direction !== direction) {
    signalHistory.set(symbol, { direction, count: 1, firstSeen: now, lastSeen: now });
    return 1;
  }

  // Same direction, increment count
  existing.count++;
  existing.lastSeen = now;
  return existing.count;
}

function cleanupOldSignals() {
  const now = Date.now();
  for (const [symbol, data] of signalHistory.entries()) {
    if (now - data.lastSeen > PERSISTENCE_CONFIG.maxAge) {
      signalHistory.delete(symbol);
    }
  }
}

function isSignalPersistent(symbol) {
  const data = signalHistory.get(symbol);
  return data && data.count >= PERSISTENCE_CONFIG.minCycles;
}

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  dataDir: path.join(__dirname, '../data/live'),
  engineApiUrl: 'http://localhost:8090',

  // Scan interval - MICRO SCALPING NEEDS FAST UPDATES!
  scanInterval: 1000, // 1 second (0.22% TP needs real-time scanning)
  // Candles update every 60s, but we scan LIVE market data every 1s

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
  signalsFile: path.join(__dirname, '../data/signals.json')
};

// ============================================================
// LOAD CANDLE DATA FROM JSON
// ============================================================

function loadCandleData(symbol) {
  try {
    const filePath = path.join(CONFIG.dataDir, `${symbol}_live.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);

    return data;
  } catch (error) {
    console.error(`❌ Error loading candles for ${symbol}:`, error.message);
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
    const data = await response.json();

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
  const spread = liveData.spread ?? 999;

  // Penalty for wide spread (harder to enter/exit)
  const spreadPenalty = spread > CONFIG.maxSpread ? 0.5 : 1.0;

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
  const spread = liveData.spread ?? 999; // High default so it fails spread check
  const orderFlow = liveData.orderFlowNet60s;

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
    spread: spread <= CONFIG.maxSpread,
    orderFlow: orderFlow === null || orderFlow >= CONFIG.minOrderFlow,
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

      // Calculate TP/SL with proper precision (use more decimals, let Dashboard format)
      const tp = direction === 'LONG'
        ? ask * 1.0022  // +0.22% for LONG
        : bid * 0.9978; // -0.22% for SHORT (price goes down)

      const sl = direction === 'LONG'
        ? bid * 0.9985  // -0.15% stop loss for LONG
        : ask * 1.0015; // +0.15% stop loss for SHORT

      // Calculate expected profit (assuming $25 margin at 5x leverage = $125 position)
      const positionSize = 125; // $25 * 5x
      const expectedProfit = Math.abs((tp - entry) / entry) * positionSize;

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
      const batchPromises = batch.map(async (symbol) => {
        try {
          // Load candle and live data
          const candleData = loadCandleData(symbol);
          if (!candleData || !candleData.candles || candleData.candles.length === 0) {
            return null;
          }

          const latestCandle = candleData.candles[candleData.candles.length - 1];
          const liveData = await fetchLiveMarketData(symbol);
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
    // STAGE 2: UPDATE HOT LIST (top 30 get trade WS)
    // ===========================================================
    if (candidates.length > 0) {
      // Sort by score (highest first)
      candidates.sort((a, b) => b.score - a.score);

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
        const result = await response.json();

        if (result.ok) {
          console.log(`🔥 Stage 2 complete: Hotlist updated with ${hotSymbols.length} symbols`);
          if (result.result.changed) {
            console.log(`   Added: ${result.result.added.length}, Removed: ${result.result.removed.length}`);
          }
        }
      } catch (error) {
        console.error(`❌ Stage 2 error: Failed to update hotlist:`, error.message);
      }

      // Wait 500ms for trade WS to connect and receive first messages
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // ===========================================================
    // STAGE 3: GENERATE SIGNALS (with orderFlow validation)
    // ===========================================================
    const signals = [];

    for (const candidate of candidates) {
      const { symbol, direction, candle, liveData } = candidate;

      // Update persistence tracker
      const cycleCount = updateSignalPersistence(symbol, direction);

      // Check persistence requirement
      if (!isSignalPersistent(symbol)) {
        continue;
      }

      // Calculate entry prices
      const entryPrice = liveData.price || 0;
      const bid = liveData.bid || entryPrice;
      const ask = liveData.ask || entryPrice;
      const entry = direction === 'LONG' ? ask : bid;

      // Calculate TP/SL
      const tp = direction === 'LONG'
        ? ask * 1.0022
        : bid * 0.9978;

      const sl = direction === 'LONG'
        ? bid * 0.9985
        : ask * 1.0015;

      // Calculate expected profit
      const positionSize = 125;
      const expectedProfit = Math.abs((tp - entry) / entry) * positionSize;

      // Re-evaluate with current data (including orderFlow from hotlist)
      const currentLiveData = await fetchLiveMarketData(symbol);
      if (!currentLiveData) continue;

      const evaluation = evaluateSignal(candle, currentLiveData);
      if (!evaluation.passed) continue;

      const signal = {
        symbol,
        direction,
        confidence: evaluation.confidence,
        timestamp: new Date().toISOString(),
        entry,
        tp,
        sl,
        expectedProfit,
        candle: {
          volatility: candle.volatility,
          velocity: candle.velocity,
          volumeSpike: candle.volumeSpike,
          priceChange1m: candle.priceChange1m
        },
        live: {
          price: currentLiveData.price,
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
        console.log(`  ${s.symbol} ${s.direction} @ ${s.entry} (confidence: ${s.confidence}%)`);
        console.log(`    TP: ${s.tp} | SL: ${s.sl}`);
        console.log(`    Volatility: ${s.candle.volatility}% | Volume Spike: ${s.candle.volumeSpike}x`);
        console.log(`    Imbalance: ${s.live.imbalance} | OrderFlow: ${s.live.orderFlowNet60s}\n`);
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
  console.log(`Scan Interval:    ${CONFIG.scanInterval / 1000}s (MICRO SCALPING MODE)`);
  console.log(`Persistence:      ${PERSISTENCE_CONFIG.minCycles} cycles (${PERSISTENCE_CONFIG.minCycles}s minimum)`);
  console.log('='.repeat(60));
  console.log('\nFilters:');
  console.log(`  Min Volatility:    ${CONFIG.minVolatility}%`);
  console.log(`  Min Volume Spike:  ${CONFIG.minVolumeSpike}x`);
  console.log(`  Min Velocity:      ${CONFIG.minVelocity}%/min`);
  console.log(`  Min Momentum:      ${CONFIG.minPriceChange1m}%`);
  console.log(`  Min Imbalance:     ${CONFIG.minImbalance}`);
  console.log(`  Max Spread:        ${CONFIG.maxSpread}%`);
  console.log('='.repeat(60) + '\n');

  // Wait 5 seconds for Engine to be ready
  console.log('⏳ Waiting 5s for Engine to initialize...\n');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Run first scan
  await scanAllSymbols();

  // Then run periodic scans
  setInterval(async () => {
    await scanAllSymbols();
  }, CONFIG.scanInterval);

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
