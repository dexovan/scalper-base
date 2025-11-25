/**
 * Historical Data Fetcher - Bybit USDT Perpetuals
 *
 * Preuzima istorijske podatke sa Bybit API-ja za backtesting.
 * Podržava: OHLCV candles, trade history, osnovnu statistiku
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
  symbol: 'AAVEUSDT',
  interval: '1',        // 1min candles
  limit: 1000,          // max 1000 po requestu (16+ sati za 1min)
  outputDir: path.join(__dirname, '../../data/backtest')
};

const BYBIT_API = 'https://api.bybit.com/v5';

// ===========================================
// FETCH CANDLES
// ===========================================

async function fetchCandles(symbol, interval, limit) {
  const url = `${BYBIT_API}/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;

  console.log(`📥 Fetching ${limit} candles for ${symbol} (${interval}min interval)...`);
  console.log(`   URL: ${url}`);

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.retCode !== 0) {
      throw new Error(`Bybit API Error: ${data.retMsg}`);
    }

    // Bybit vraća candles od najnovijih ka starijim, hajde da ih okrenemo
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

    console.log(`✅ Fetched ${candles.length} candles`);
    console.log(`   Period: ${candles[0].datetime} → ${candles[candles.length - 1].datetime}`);

    return candles;

  } catch (error) {
    console.error('❌ Error fetching candles:', error.message);
    throw error;
  }
}

// ===========================================
// FETCH RECENT TRADES
// ===========================================

async function fetchRecentTrades(symbol, limit = 1000) {
  const url = `${BYBIT_API}/market/recent-trade?category=linear&symbol=${symbol}&limit=${limit}`;

  console.log(`\n📥 Fetching ${limit} recent trades for ${symbol}...`);

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.retCode !== 0) {
      throw new Error(`Bybit API Error: ${data.retMsg}`);
    }

    const trades = data.result.list.map(t => ({
      timestamp: parseInt(t.time),
      datetime: new Date(parseInt(t.time)).toISOString(),
      price: parseFloat(t.price),
      size: parseFloat(t.size),
      side: t.side,
      isBlockTrade: t.isBlockTrade
    }));

    console.log(`✅ Fetched ${trades.length} trades`);

    return trades;

  } catch (error) {
    console.error('❌ Error fetching trades:', error.message);
    return [];
  }
}

// ===========================================
// ANALYZE CANDLES
// ===========================================

function analyzeCandles(candles) {
  console.log('\n📊 ANALYZING CANDLES...\n');

  // Basic statistics
  const prices = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const totalVolume = volumes.reduce((a, b) => a + b, 0);

  console.log('📈 PRICE STATS:');
  console.log(`   Min:     $${minPrice.toFixed(2)}`);
  console.log(`   Max:     $${maxPrice.toFixed(2)}`);
  console.log(`   Average: $${avgPrice.toFixed(2)}`);
  console.log(`   Range:   $${(maxPrice - minPrice).toFixed(2)} (${((maxPrice - minPrice) / avgPrice * 100).toFixed(2)}%)`);

  console.log('\n📊 VOLUME STATS:');
  console.log(`   Total:   ${totalVolume.toFixed(2)}`);
  console.log(`   Average: ${(totalVolume / candles.length).toFixed(2)} per candle`);

  // Volatility analysis
  const volatilities = candles.map(c => {
    const range = c.high - c.low;
    const midPrice = (c.high + c.low) / 2;
    return (range / midPrice) * 100;
  });

  const avgVolatility = volatilities.reduce((a, b) => a + b, 0) / volatilities.length;
  const maxVolatility = Math.max(...volatilities);
  const highVolCandles = volatilities.filter(v => v > 0.3).length;

  console.log('\n🔥 VOLATILITY STATS:');
  console.log(`   Average:      ${avgVolatility.toFixed(3)}% per candle`);
  console.log(`   Max:          ${maxVolatility.toFixed(3)}%`);
  console.log(`   High vol (>0.3%): ${highVolCandles} candles (${(highVolCandles / candles.length * 100).toFixed(1)}%)`);

  // Price movements (candle to candle)
  const movements = [];
  for (let i = 1; i < candles.length; i++) {
    const change = ((candles[i].close - candles[i - 1].close) / candles[i - 1].close) * 100;
    movements.push(change);
  }

  const positiveMovements = movements.filter(m => m > 0);
  const negativeMovements = movements.filter(m => m < 0);
  const bigMoves = movements.filter(m => Math.abs(m) > 0.2);

  console.log('\n📉 PRICE MOVEMENTS:');
  console.log(`   Positive: ${positiveMovements.length} (${(positiveMovements.length / movements.length * 100).toFixed(1)}%)`);
  console.log(`   Negative: ${negativeMovements.length} (${(negativeMovements.length / movements.length * 100).toFixed(1)}%)`);
  console.log(`   Big moves (>0.2%): ${bigMoves.length} (${(bigMoves.length / movements.length * 100).toFixed(1)}%)`);

  // Opportunities for scalping (0.3%+ move in next 5 candles)
  let opportunities = 0;
  const lookAhead = 5;

  for (let i = 0; i < candles.length - lookAhead; i++) {
    const currentPrice = candles[i].close;
    const maxPriceAhead = Math.max(...candles.slice(i + 1, i + lookAhead + 1).map(c => c.high));
    const minPriceAhead = Math.min(...candles.slice(i + 1, i + lookAhead + 1).map(c => c.low));

    const upMove = ((maxPriceAhead - currentPrice) / currentPrice) * 100;
    const downMove = ((currentPrice - minPriceAhead) / currentPrice) * 100;

    if (upMove >= 0.3 || downMove >= 0.3) {
      opportunities++;
    }
  }

  console.log('\n💰 SCALPING OPPORTUNITIES:');
  console.log(`   0.3%+ move in next 5min: ${opportunities} times`);
  console.log(`   Frequency: ${(opportunities / (candles.length - lookAhead) * 100).toFixed(1)}% of candles`);
  console.log(`   Average: ${((opportunities / (candles.length - lookAhead)) * 60).toFixed(1)} opportunities per hour`);

  return {
    priceStats: { minPrice, maxPrice, avgPrice, range: maxPrice - minPrice },
    volumeStats: { totalVolume, avgVolume: totalVolume / candles.length },
    volatilityStats: { avgVolatility, maxVolatility, highVolCandles },
    movementStats: {
      positive: positiveMovements.length,
      negative: negativeMovements.length,
      bigMoves: bigMoves.length
    },
    scalpingStats: {
      opportunities,
      frequency: opportunities / (candles.length - lookAhead),
      perHour: (opportunities / (candles.length - lookAhead)) * 60
    }
  };
}

// ===========================================
// SAVE DATA
// ===========================================

function saveData(symbol, candles, trades, analysis) {
  // Kreiraj output direktorijum ako ne postoji
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

  // Sačuvaj candles
  const candlesFile = path.join(CONFIG.outputDir, `${symbol}_candles_${timestamp}.json`);
  fs.writeFileSync(candlesFile, JSON.stringify({
    symbol,
    interval: `${CONFIG.interval}min`,
    count: candles.length,
    fetched: new Date().toISOString(),
    period: {
      start: candles[0].datetime,
      end: candles[candles.length - 1].datetime
    },
    data: candles
  }, null, 2));

  console.log(`\n💾 Saved candles: ${candlesFile}`);

  // Sačuvaj trades (ako postoje)
  if (trades && trades.length > 0) {
    const tradesFile = path.join(CONFIG.outputDir, `${symbol}_trades_${timestamp}.json`);
    fs.writeFileSync(tradesFile, JSON.stringify({
      symbol,
      count: trades.length,
      fetched: new Date().toISOString(),
      data: trades
    }, null, 2));

    console.log(`💾 Saved trades:  ${tradesFile}`);
  }

  // Sačuvaj analizu
  const analysisFile = path.join(CONFIG.outputDir, `${symbol}_analysis_${timestamp}.json`);
  fs.writeFileSync(analysisFile, JSON.stringify({
    symbol,
    interval: `${CONFIG.interval}min`,
    candleCount: candles.length,
    analyzed: new Date().toISOString(),
    analysis
  }, null, 2));

  console.log(`💾 Saved analysis: ${analysisFile}`);
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log('\n🚀 HISTORICAL DATA FETCHER\n');
  console.log('='.repeat(50));
  console.log(`Symbol:   ${CONFIG.symbol}`);
  console.log(`Interval: ${CONFIG.interval} minute(s)`);
  console.log(`Limit:    ${CONFIG.limit} candles`);
  console.log('='.repeat(50));

  try {
    // 1. Fetch candles
    const candles = await fetchCandles(CONFIG.symbol, CONFIG.interval, CONFIG.limit);

    // 2. Fetch trades (opciono, može biti sporije)
    const trades = await fetchRecentTrades(CONFIG.symbol, 500);

    // 3. Analyze
    const analysis = analyzeCandles(candles);

    // 4. Save
    saveData(CONFIG.symbol, candles, trades, analysis);

    console.log('\n✅ ALL DONE!\n');

  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error.message);
    process.exit(1);
  }
}

// Run
main();
