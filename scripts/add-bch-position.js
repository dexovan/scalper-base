#!/usr/bin/env node
// Load all active positions from Bybit and add them to snapshot for automatic TP/SL tracking

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as bybitPrivateRest from '../src/connectors/bybitPrivateRest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const snapshotPath = path.join(__dirname, '../data/system/tpsl_snapshot.json');

/**
 * Get all positions for a symbol (calls Bybit API to get current position details)
 * @param {string} symbol - e.g., 'BCHUSDTPerp'
 * @returns {Promise<Object|null>}
 */
async function fetchPositionFromBybit(symbol) {
  try {
    return await bybitPrivateRest.getPosition(symbol);
  } catch (error) {
    console.error(`❌ Error fetching ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Calculate TP/SL prices based on entry and side
 * Using standard scalping strategy: TP1 +0.5%, TP2 +1%, SL -0.25%
 */
function calculateTpSlPrices(entryPrice, side) {
  const tp1Pct = 0.005;      // +0.5%
  const tp2Pct = 0.010;      // +1.0%
  const slPct = 0.0025;      // -0.25%
  const bePct = 0.0005;      // +0.05% (breakeven buffer)

  if (side === 'Buy' || side === 'LONG') {
    return {
      tp1Price: entryPrice * (1 + tp1Pct),
      tp2Price: entryPrice * (1 + tp2Pct),
      stopLossPrice: entryPrice * (1 - slPct),
      breakEvenPrice: entryPrice,
      quickTpPrice: entryPrice * (1 + bePct)
    };
  } else {
    // SHORT position
    return {
      tp1Price: entryPrice * (1 - tp1Pct),
      tp2Price: entryPrice * (1 - tp2Pct),
      stopLossPrice: entryPrice * (1 + slPct),
      breakEvenPrice: entryPrice,
      quickTpPrice: entryPrice * (1 - bePct)
    };
  }
}

/**
 * Convert Bybit position to TPSL format
 */
function convertToTpslFormat(bybitPosition) {
  const { symbol, side, size, entryPrice, leverage } = bybitPosition;

  // Convert Bybit side (Buy/Sell) to internal format (LONG/SHORT)
  const internalSide = side === 'Buy' ? 'LONG' : 'SHORT';

  // Calculate TP/SL
  const tpslPrices = calculateTpSlPrices(entryPrice, side);

  return {
    symbol,
    side: internalSide,
    entryPrice,
    qty: size,
    leverage,
    breakEvenPrice: tpslPrices.breakEvenPrice,
    quickTpPrice: tpslPrices.quickTpPrice,
    tp1Price: tpslPrices.tp1Price,
    tp2Price: tpslPrices.tp2Price,
    stopLossPrice: tpslPrices.stopLossPrice,
    openedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'ACTIVE',
    isBreakEvenHit: false,
    trailingActive: false,
    isTp1Hit: false,
    isTp2Hit: false,
    pumpOverrideApplied: false,
    spoofingOverrideApplied: false,
    volatilityOverrideApplied: false,
    trailingDistancePct: 0.10
  };
}

async function main() {
  try {
    // For now, fetch the known active positions
    // TODO: Fetch from Bybit which symbols have active positions
    const symbolsToCheck = ['BCHUSDTPerp', 'DOTUSDTPerp', 'ORDIUSDTPerp', 'INJUSDTPerp'];

    // Read current snapshot
    let snapshot;
    if (fs.existsSync(snapshotPath)) {
      const data = fs.readFileSync(snapshotPath, 'utf8');
      snapshot = JSON.parse(data);
    } else {
      snapshot = { timestamp: new Date().toISOString(), positions: {} };
    }

    let addedCount = 0;

    // Fetch each position from Bybit
    for (const symbol of symbolsToCheck) {
      console.log(`\n📡 Fetching ${symbol}...`);
      const bybitPosition = await fetchPositionFromBybit(symbol);

      if (bybitPosition && bybitPosition.size > 0) {
        const tpslState = convertToTpslFormat(bybitPosition);
        const key = `${symbol}_${tpslState.side}`;

        snapshot.positions[key] = tpslState;
        addedCount++;

        console.log(`✅ Added ${key} to snapshot`);
        console.log(`   Entry: $${tpslState.entryPrice.toFixed(4)}`);
        console.log(`   Quick TP: $${tpslState.quickTpPrice.toFixed(4)}`);
        console.log(`   TP1: $${tpslState.tp1Price.toFixed(4)}`);
        console.log(`   TP2: $${tpslState.tp2Price.toFixed(4)}`);
        console.log(`   SL: $${tpslState.stopLossPrice.toFixed(4)}`);
        console.log(`   Qty: ${tpslState.qty}`);
      } else {
        console.log(`   ℹ️  No active position for ${symbol}`);
      }
    }

    // Update snapshot timestamp and write
    snapshot.timestamp = new Date().toISOString();
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    console.log(`\n✅ Snapshot updated with ${addedCount} position(s)`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
