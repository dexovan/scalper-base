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
// CONFIGURATION
// ============================================================

const CONFIG = {
  dataDir: path.join(__dirname, '../data/live'),
  engineApiUrl: 'http://localhost:8090',

  // Scan interval
  scanInterval: 60000, // 60 seconds (match candle update frequency)

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

    // 4. If signal passes all checks, return it
    if (evaluation.passed) {
      // Determine direction based on velocity and imbalance
      const direction = latestCandle.velocity > 0 && liveData.imbalance > 1 ? 'LONG' : 'SHORT';

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
// SCAN ALL SYMBOLS
// ============================================================

async function scanAllSymbols() {
  console.log(`\n🔍 [${new Date().toISOString()}] Starting signal scan...`);

  try {
    // Get tracked symbols from Engine (only symbols with orderbook data)
    let symbols = [];
    try {
      const response = await fetch(`${CONFIG.engineApiUrl}/api/tracked-symbols`);
      const data = await response.json();

      if (data.ok && data.symbols) {
        symbols = data.symbols;
        console.log(`📊 Scanning ${symbols.length} tracked symbols (with orderbook data)...`);
      } else {
        console.log(`⚠️  Could not fetch tracked symbols, falling back to file scan`);
        // Fallback to file scan
        const files = fs.readdirSync(CONFIG.dataDir);
        const symbolFiles = files.filter(f => f.endsWith('_live.json'));
        symbols = symbolFiles.map(f => f.replace('_live.json', ''));
        console.log(`📊 Scanning ${symbols.length} symbols from files...`);
      }
    } catch (error) {
      console.error(`❌ Error fetching tracked symbols:`, error.message);
      // Fallback to file scan
      const files = fs.readdirSync(CONFIG.dataDir);
      const symbolFiles = files.filter(f => f.endsWith('_live.json'));
      symbols = symbolFiles.map(f => f.replace('_live.json', ''));
      console.log(`📊 Scanning ${symbols.length} symbols from files (fallback)...`);
    }

    // Debug: Sample a few symbols to see actual values
    let debugSampleCount = 0;
    const maxDebugSamples = 3;

    // Scan all symbols
    const signals = [];
    for (const symbol of symbols) {
      const signal = await scanSymbol(symbol);
      if (signal) {
        signals.push(signal);
      }

      // Debug: Log sample data from first few symbols
      if (debugSampleCount < maxDebugSamples && signal === null) {
        const candleData = loadCandleData(symbol);
        const liveData = await fetchLiveMarketData(symbol);

        if (candleData && liveData && candleData.candles.length > 0) {
          const c = candleData.candles[candleData.candles.length - 1];
          console.log(`\n📋 Sample: ${symbol}`);
          console.log(`  Volatility: ${c.volatility != null ? c.volatility.toFixed(2) + '%' : 'N/A'} (need ${CONFIG.minVolatility}%)`);
          console.log(`  Volume Spike: ${c.volumeSpike != null ? c.volumeSpike.toFixed(2) + 'x' : 'N/A'} (need ${CONFIG.minVolumeSpike}x)`);
          console.log(`  Velocity: ${Math.abs(c.velocity || 0).toFixed(3)}%/min (need ${CONFIG.minVelocity}%/min)`);
          console.log(`  Momentum (1m): ${Math.abs(c.priceChange1m || 0).toFixed(2)}% (need ${CONFIG.minPriceChange1m}%)`);
          console.log(`  Imbalance: ${liveData.imbalance != null ? liveData.imbalance.toFixed(2) : 'N/A'} (need ${CONFIG.minImbalance})`);
          console.log(`  Spread: ${liveData.spread != null ? liveData.spread.toFixed(3) + '%' : 'N/A'} (need <${CONFIG.maxSpread}%)`);
          debugSampleCount++;
        }
      }
    }

    // Log results
    if (signals.length > 0) {
      console.log(`\n🎯 Found ${signals.length} signals:\n`);
      signals.forEach(s => {
        console.log(`  ${s.symbol} ${s.direction} @ ${s.entry} (confidence: ${s.confidence}%)`);
        console.log(`    TP: ${s.tp} | SL: ${s.sl}`);
        console.log(`    Volatility: ${s.candle.volatility}% | Volume Spike: ${s.candle.volumeSpike}x`);
        console.log(`    Imbalance: ${s.live.imbalance} | Spread: ${s.live.spread}%\n`);
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
