#!/usr/bin/env node

/**
 * DEBUG SCANNER - Detaljno provjerava zašto nema signala
 * Pokreni na serveru sa: node scripts/debug-scanner.js
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  engineApiUrl: 'http://localhost:8090',
  dataDir: path.join(__dirname, '../data/live')
};

// Scanner filter config (kopirano iz scalp-signal-scanner.js)
const SCANNER_CONFIG = {
  minVolatility: 0.15,       // 0.15% minimum range
  minVolumeSpike: 1.5,       // 1.5x average volume
  minVelocity: 0.03,         // 0.03%/min price change speed
  minPriceChange1m: 0.1,     // 0.1% momentum in last minute
  minImbalance: 1.5,         // 1.5x bid/ask ratio
  maxSpread: 0.1             // 0.1% max spread
};

async function analyzeSymbol(symbol) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 ANALYZING: ${symbol}`);
  console.log('='.repeat(70));

  try {
    // 1. Load candle data
    const candleFile = path.join(CONFIG.dataDir, `${symbol}_live.json`);
    if (!fs.existsSync(candleFile)) {
      console.log(`❌ NO CANDLE DATA - ${candleFile} not found`);
      return;
    }

    const candleData = JSON.parse(fs.readFileSync(candleFile, 'utf8'));
    if (!candleData.candles || candleData.candles.length === 0) {
      console.log(`❌ EMPTY CANDLES - file exists but no data`);
      return;
    }

    const latestCandle = candleData.candles[candleData.candles.length - 1];
    console.log(`\n✅ CANDLE DATA LOADED:`);
    console.log(`   Volatility: ${latestCandle.volatility?.toFixed(4)}% (need: ${SCANNER_CONFIG.minVolatility}%)`);
    console.log(`   Volume Spike: ${latestCandle.volumeSpike?.toFixed(2)}x (need: ${SCANNER_CONFIG.minVolumeSpike}x)`);
    console.log(`   Velocity: ${latestCandle.velocity?.toFixed(4)}%/min (need: ${SCANNER_CONFIG.minVelocity}%/min)`);
    console.log(`   Price Change 1m: ${latestCandle.priceChange1m?.toFixed(4)}% (need: ${SCANNER_CONFIG.minPriceChange1m}%)`);

    // Check candle filters
    const candleChecks = {
      volatility: (latestCandle.volatility || 0) >= SCANNER_CONFIG.minVolatility,
      volumeSpike: (latestCandle.volumeSpike || 0) >= SCANNER_CONFIG.minVolumeSpike,
      velocity: Math.abs(latestCandle.velocity || 0) >= SCANNER_CONFIG.minVelocity,
      momentum: Math.abs(latestCandle.priceChange1m || 0) >= SCANNER_CONFIG.minPriceChange1m
    };

    console.log(`\n📋 CANDLE FILTERS:`);
    Object.entries(candleChecks).forEach(([name, passed]) => {
      console.log(`   ${passed ? '✅' : '❌'} ${name}`);
    });

    // 2. Fetch live market data
    console.log(`\n🔄 Fetching live market data...`);
    const liveResponse = await fetch(`${CONFIG.engineApiUrl}/api/live-market/${symbol}`);
    const liveData = await liveResponse.json();

    if (!liveData.ok || !liveData.live) {
      console.log(`❌ NO LIVE DATA - API returned: ${liveData.error || 'unknown error'}`);
      return;
    }

    const live = liveData.live;
    console.log(`\n✅ LIVE DATA RECEIVED:`);
    console.log(`   Price: ${live.price?.toFixed(8)}`);
    console.log(`   Bid: ${live.bid?.toFixed(8)}`);
    console.log(`   Ask: ${live.ask?.toFixed(8)}`);
    console.log(`   Spread: ${live.spread?.toFixed(8)} (${live.spreadPercent?.toFixed(4)}%)`);
    console.log(`   Imbalance: ${live.imbalance?.toFixed(4)} (need: ${SCANNER_CONFIG.minImbalance})`);
    console.log(`   Order Flow 60s: $${live.orderFlowNet60s?.toFixed(0) || 0}`);
    console.log(`   Volume 60s: $${live.volumeAbs60s?.toFixed(0) || 0}`);

    // Check live filters
    const liveChecks = {
      spread: (live.spreadPercent || 0) <= SCANNER_CONFIG.maxSpread,
      imbalance: (live.imbalance || 0) >= SCANNER_CONFIG.minImbalance
    };

    console.log(`\n📋 LIVE FILTERS:`);
    Object.entries(liveChecks).forEach(([name, passed]) => {
      console.log(`   ${passed ? '✅' : '❌'} ${name}`);
    });

    // 3. Summary
    const allChecksPassed = Object.values(candleChecks).every(c => c) &&
                            Object.values(liveChecks).every(c => c);

    console.log(`\n${'='.repeat(70)}`);
    if (allChecksPassed) {
      console.log(`✅ RESULT: SIGNAL CANDIDATE - Would generate signal!`);
    } else {
      console.log(`❌ RESULT: FILTERED OUT - Does not meet requirements`);
      const failedChecks = [
        ...Object.entries(candleChecks).filter(([, v]) => !v).map(([k]) => `candle.${k}`),
        ...Object.entries(liveChecks).filter(([, v]) => !v).map(([k]) => `live.${k}`)
      ];
      console.log(`   Failed filters: ${failedChecks.join(', ')}`);
    }
    console.log('='.repeat(70));

  } catch (error) {
    console.error(`❌ ERROR: ${error.message}`);
  }
}

async function main() {
  console.log('\n🔍 SCALP SIGNAL SCANNER - DEBUG MODE\n');

  // Prime symbols
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT'];

  for (const symbol of symbols) {
    await analyzeSymbol(symbol);
    await new Promise(resolve => setTimeout(resolve, 500)); // Delay between calls
  }

  console.log('\n✅ Debug analysis complete\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
