// ============================================================
// SCALP SIGNAL SCANNER
// Combines historical candle data + live market state
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  minVolatility: 0.3,        // 0.3% minimum range
  minVolumeSpike: 3.0,       // 3x average volume
  minVelocity: 0.05,         // 0.05%/min price change speed
  minPriceChange1m: 0.2,     // 0.2% momentum in last minute

  // Live filters (from Engine API)
  minImbalance: 2.5,         // 2.5x bid/ask ratio
  maxSpread: 0.05,           // 0.05% max spread
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
  const checks = {
    // Historical checks
    volatility: candle.volatility >= CONFIG.minVolatility,
    volumeSpike: candle.volumeSpike >= CONFIG.minVolumeSpike,
    velocity: Math.abs(candle.velocity) >= CONFIG.minVelocity,
    momentum: Math.abs(candle.priceChange1m) >= CONFIG.minPriceChange1m,

    // Live checks
    imbalance: liveData.imbalance >= CONFIG.minImbalance,
    spread: liveData.spread <= CONFIG.maxSpread,
    orderFlow: liveData.orderFlowNet60s === null || liveData.orderFlowNet60s >= CONFIG.minOrderFlow,
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

      const signal = {
        symbol,
        direction,
        confidence: evaluation.confidence,
        timestamp: new Date().toISOString(),

        // Entry/Exit prices
        entry: direction === 'LONG' ? liveData.ask : liveData.bid,
        tp: direction === 'LONG'
          ? (liveData.ask * 1.0022).toFixed(4)  // +0.22% for LONG
          : (liveData.bid * 0.9978).toFixed(4), // -0.22% for SHORT
        sl: direction === 'LONG'
          ? (liveData.bid * 0.9985).toFixed(4)  // -0.15% stop loss for LONG
          : (liveData.ask * 1.0015).toFixed(4), // +0.15% stop loss for SHORT

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
    // Get all symbol files
    const files = fs.readdirSync(CONFIG.dataDir);
    const symbolFiles = files.filter(f => f.endsWith('_live.json'));
    const symbols = symbolFiles.map(f => f.replace('_live.json', ''));

    console.log(`📊 Scanning ${symbols.length} symbols...`);

    // Scan all symbols
    const signals = [];
    for (const symbol of symbols) {
      const signal = await scanSymbol(symbol);
      if (signal) {
        signals.push(signal);
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

  // Run first scan immediately
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
