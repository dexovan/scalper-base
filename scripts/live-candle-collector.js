/**
 * Live Candle Collector - Rolling 6-Hour Window
 *
 * Preuzima najnovije candles sa Bybit API-ja i čuva samo zadnjih 6 sati.
 * Auto-briše sve starije od 6h. Minimal disk footprint (~83 KB per simbol).
 *
 * Usage:
 *   node scripts/live-candle-collector.js
 *   pm2 start scripts/live-candle-collector.js --name "candle-collector"
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===========================================
// CONFIG
// ===========================================

const CONFIG = {
  engineApiUrl: 'http://localhost:8090',  // Engine API
  interval: '1',              // 1-minute candles
  windowHours: 6,             // Keep last 6 hours
  windowSize: 360,            // 6 hours × 60 minutes = 360 candles
  updateInterval: 60000,      // Update every 60 seconds
  symbolRefreshInterval: 300000,  // Refresh symbol list every 5 minutes
  dataDir: path.join(__dirname, '../data/live'),
  minVolume24h: 100000        // Minimum 24h volume (USDT) to track
};

const BYBIT_API = 'https://api.bybit.com/v5';

// Global state
let activeSymbols = [];

// ===========================================
// FETCH ACTIVE SYMBOLS FROM UNIVERSE
// ===========================================

async function fetchActiveSymbols() {
  try {
    const url = `${CONFIG.engineApiUrl}/api/monitor/symbols`;
    console.log(`📥 Fetching active symbols from Universe...`);

    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok || !data.symbols || !Array.isArray(data.symbols)) {
      console.error('❌ Invalid Universe response:', data);
      return activeSymbols; // Return cached list
    }

    // Filter: Trading status, has volume, is USDT perpetual
    const symbols = data.symbols
      .filter(s => {
        const symbol = typeof s === 'string' ? s : s.symbol;
        const volume = typeof s === 'object' ? (s.volume24h || 0) : 0;
        const status = typeof s === 'object' ? s.status : 'Trading';

        return (
          status === 'Trading' &&
          volume > CONFIG.minVolume24h &&
          symbol.endsWith('USDT')
        );
      })
      .map(s => typeof s === 'string' ? s : s.symbol)
      .sort();

    console.log(`✅ Loaded ${symbols.length} active symbols from Universe`);

    // Cache for next time
    activeSymbols = symbols;
    return symbols;

  } catch (error) {
    console.error('❌ Error fetching symbols from Universe:', error.message);
    console.log(`⚠️  Using cached list: ${activeSymbols.length} symbols`);
    return activeSymbols; // Return cached list on error
  }
}

// ===========================================
// ENSURE DATA DIRECTORY EXISTS
// ===========================================

function ensureDataDir() {
  if (!fs.existsSync(CONFIG.dataDir)) {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    console.log(`📁 Created directory: ${CONFIG.dataDir}`);
  }
}

// ===========================================
// FETCH LATEST CANDLES FROM BYBIT
// ===========================================

async function fetchCandles(symbol, limit = 10) {
  const url = `${BYBIT_API}/market/kline?category=linear&symbol=${symbol}&interval=${CONFIG.interval}&limit=${limit}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.retCode !== 0) {
      throw new Error(`Bybit API Error: ${data.retMsg}`);
    }

    // Bybit returns newest first, reverse to oldest→newest
    const candles = data.result.list.reverse().map(c => ({
      timestamp: parseInt(c[0]),
      datetime: new Date(parseInt(c[0])).toISOString(),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      turnover: parseFloat(c[6])
    }));

    return candles;

  } catch (error) {
    console.error(`❌ Error fetching candles for ${symbol}:`, error.message);
    return [];
  }
}

// ===========================================
// LOAD EXISTING DATA
// ===========================================

function loadLiveData(symbol) {
  const filePath = path.join(CONFIG.dataDir, `${symbol}_live.json`);

  if (!fs.existsSync(filePath)) {
    // Create initial structure
    return {
      symbol,
      windowHours: CONFIG.windowHours,
      windowSize: CONFIG.windowSize,
      lastUpdate: null,
      oldestCandle: null,
      newestCandle: null,
      candles: []
    };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`❌ Error loading ${filePath}:`, error.message);
    return {
      symbol,
      windowHours: CONFIG.windowHours,
      windowSize: CONFIG.windowSize,
      lastUpdate: null,
      oldestCandle: null,
      newestCandle: null,
      candles: []
    };
  }
}

// ===========================================
// ENRICH CANDLE WITH COMPUTED FEATURES
// ===========================================

function enrichCandle(candle, previousCandles) {
  // 1. Volatility: price range as % of low
  if (candle.high && candle.low && candle.low > 0) {
    candle.volatility = parseFloat((((candle.high - candle.low) / candle.low) * 100).toFixed(4));
  }

  // 2. Average volume (last 20 candles)
  if (previousCandles.length >= 20) {
    const last20 = previousCandles.slice(-20);
    const sumVolume = last20.reduce((sum, c) => sum + (c.volume || 0), 0);
    candle.avgVolume20 = Math.round(sumVolume / 20);

    // 3. Volume spike: current volume vs avg
    if (candle.avgVolume20 > 0 && candle.volume) {
      candle.volumeSpike = parseFloat((candle.volume / candle.avgVolume20).toFixed(2));
    }
  }

  // 4. Price velocity: % change per minute over 5 minutes
  if (previousCandles.length >= 5) {
    const candle5ago = previousCandles[previousCandles.length - 5];
    if (candle5ago && candle5ago.close && candle.close) {
      const priceChange5m = ((candle.close - candle5ago.close) / candle5ago.close) * 100;
      candle.velocity = parseFloat((priceChange5m / 5).toFixed(4)); // % per minute
      candle.priceChange5m = parseFloat(priceChange5m.toFixed(2));
    }
  }

  // 5. Price change 1 minute ago
  if (previousCandles.length >= 1) {
    const candle1ago = previousCandles[previousCandles.length - 1];
    if (candle1ago && candle1ago.close && candle.close) {
      candle.priceChange1m = parseFloat((((candle.close - candle1ago.close) / candle1ago.close) * 100).toFixed(2));
    }
  }

  // 6. Average range (last 20 candles)
  if (previousCandles.length >= 20) {
    const last20 = previousCandles.slice(-20);
    const sumRange = last20.reduce((sum, c) => {
      if (c.high && c.low && c.low > 0) {
        return sum + ((c.high - c.low) / c.low * 100);
      }
      return sum;
    }, 0);
    candle.avgRange20 = parseFloat((sumRange / 20).toFixed(4));
  }

  return candle;
}

// ===========================================
// SAVE DATA TO DISK
// ===========================================

function saveLiveData(data) {
  const filePath = path.join(CONFIG.dataDir, `${data.symbol}_live.json`);

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`❌ Error saving ${filePath}:`, error.message);
    return false;
  }
}

// ===========================================
// UPDATE SINGLE SYMBOL
// ===========================================

async function updateSymbol(symbol) {
  try {
    // 1. Load existing data
    let data = loadLiveData(symbol);

    // 2. Fetch latest candles
    const newCandles = await fetchCandles(symbol, 5); // Get last 5 to be safe

    if (newCandles.length === 0) {
      console.log(`⚠️  [${symbol}] No new candles received`);
      return;
    }

    // 3. Merge new candles (avoid duplicates) and enrich with features
    const existingTimestamps = new Set(data.candles.map(c => c.timestamp));
    const uniqueNewCandles = newCandles.filter(c => !existingTimestamps.has(c.timestamp));

    if (uniqueNewCandles.length > 0) {
      // Enrich each new candle with computed features
      uniqueNewCandles.forEach(candle => {
        enrichCandle(candle, data.candles);
      });

      data.candles.push(...uniqueNewCandles);
      data.candles.sort((a, b) => a.timestamp - b.timestamp); // Ensure sorted
    }

    // 4. Remove candles older than window (6 hours)
    const cutoffTime = Date.now() - (CONFIG.windowHours * 60 * 60 * 1000);
    const beforeCount = data.candles.length;
    data.candles = data.candles.filter(c => c.timestamp >= cutoffTime);
    const removedCount = beforeCount - data.candles.length;

    // 5. Keep only windowSize candles (safety check)
    if (data.candles.length > CONFIG.windowSize) {
      data.candles = data.candles.slice(-CONFIG.windowSize);
    }

    // 6. Update metadata
    data.lastUpdate = new Date().toISOString();
    data.oldestCandle = data.candles.length > 0 ? data.candles[0].datetime : null;
    data.newestCandle = data.candles.length > 0 ? data.candles[data.candles.length - 1].datetime : null;

    // 7. Save to disk
    const saved = saveLiveData(data);

    if (saved) {
      const stats = [];
      if (uniqueNewCandles.length > 0) stats.push(`+${uniqueNewCandles.length} new`);
      if (removedCount > 0) stats.push(`-${removedCount} old`);
      stats.push(`${data.candles.length} total`);

      console.log(`✅ [${symbol}] ${stats.join(', ')}`);
    }

  } catch (error) {
    console.error(`❌ [${symbol}] Update failed:`, error.message);
  }
}

// ===========================================
// UPDATE ALL SYMBOLS
// ===========================================

async function updateAll() {
  console.log(`\n🔄 [${new Date().toISOString()}] Updating candles...`);

  // Get current active symbols from Universe
  const currentSymbols = await fetchActiveSymbols();

  if (currentSymbols.length === 0) {
    console.log('⚠️  No symbols to update');
    return;
  }

  // Update candles for all active symbols
  for (const symbol of currentSymbols) {
    await updateSymbol(symbol);
  }

  // Cleanup: Remove files for symbols no longer in Universe
  await cleanupInactiveSymbols(currentSymbols);

  console.log(`✅ Update cycle complete (${currentSymbols.length} symbols)\n`);
}

// ===========================================
// CLEANUP INACTIVE SYMBOLS
// ===========================================

async function cleanupInactiveSymbols(activeSymbols) {
  try {
    const files = fs.readdirSync(CONFIG.dataDir);
    const liveFiles = files.filter(f => f.endsWith('_live.json'));

    for (const file of liveFiles) {
      const symbol = file.replace('_live.json', '');

      if (!activeSymbols.includes(symbol)) {
        const filePath = path.join(CONFIG.dataDir, file);
        fs.unlinkSync(filePath);
        console.log(`🗑️  Removed inactive: ${symbol}`);
      }
    }
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
  }
}// ===========================================
// INITIAL LOAD (BOOTSTRAP)
// ===========================================

async function initialLoad() {
  console.log('\n🚀 LIVE CANDLE COLLECTOR - INITIAL LOAD\n');
  console.log('='.repeat(60));

  // Fetch active symbols from Universe
  const symbols = await fetchActiveSymbols();

  if (symbols.length === 0) {
    console.error('❌ No symbols found! Check Universe API at', CONFIG.engineApiUrl);
    process.exit(1);
  }

  console.log(`Symbols:      ${symbols.length} from Universe API`);
  console.log(`Window:       ${CONFIG.windowHours} hours (${CONFIG.windowSize} candles)`);
  console.log(`Update:       Every ${CONFIG.updateInterval / 1000} seconds`);
  console.log(`Data Dir:     ${CONFIG.dataDir}`);
  console.log('='.repeat(60) + '\n');

  ensureDataDir();

  // Bootstrap: Fetch full window for each symbol
  for (const symbol of symbols) {
    console.log(`📥 Bootstrapping ${symbol}...`);

    try {
      // Fetch maximum available candles (up to 1000)
      const limit = Math.min(CONFIG.windowSize, 1000);
      const candles = await fetchCandles(symbol, limit);

      if (candles.length > 0) {
        // Keep only last windowSize candles
        const windowCandles = candles.slice(-CONFIG.windowSize);

        // Enrich all bootstrap candles with features
        for (let i = 0; i < windowCandles.length; i++) {
          const previousCandles = windowCandles.slice(0, i);
          enrichCandle(windowCandles[i], previousCandles);
        }

        const data = {
          symbol,
          windowHours: CONFIG.windowHours,
          windowSize: CONFIG.windowSize,
          lastUpdate: new Date().toISOString(),
          oldestCandle: windowCandles[0].datetime,
          newestCandle: windowCandles[windowCandles.length - 1].datetime,
          candles: windowCandles
        };

        saveLiveData(data);
        console.log(`✅ [${symbol}] Bootstrapped with ${windowCandles.length} candles (enriched)`);
      } else {
        console.log(`⚠️  [${symbol}] No candles received`);
      }
    } catch (error) {
      console.error(`❌ [${symbol}] Bootstrap failed:`, error.message);
    }
  }

  console.log('\n✅ Initial load complete!\n');
}

// ===========================================
// MAIN LOOP
// ===========================================

async function main() {
  // Initial bootstrap
  await initialLoad();

  // Start periodic updates
  console.log(`🔁 Starting periodic updates every ${CONFIG.updateInterval / 1000}s...\n`);

  setInterval(async () => {
    await updateAll();
  }, CONFIG.updateInterval);

  // Refresh symbol list periodically (every 5 minutes)
  setInterval(async () => {
    console.log('🔄 Refreshing symbol list from Universe...');
    await fetchActiveSymbols(); // Updates global cache
  }, CONFIG.symbolRefreshInterval);

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    process.exit(0);
  });

  console.log('✅ Live Candle Collector is running! Press Ctrl+C to stop.\n');
}

// ===========================================
// RUN
// ===========================================

main().catch(error => {
  console.error('\n💥 FATAL ERROR:', error);
  process.exit(1);
});
