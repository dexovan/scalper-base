#!/usr/bin/env node
// Add BCH position to snapshot for automatic TP/SL tracking

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const snapshotPath = path.join(__dirname, '../data/system/tpsl_snapshot.json');

// BCH position data from Bybit
const bchPosition = {
  symbol: 'BCHUSDTPerp',
  side: 'LONG',
  entryPrice: 521.00,
  qty: 0.10,
  leverage: 3.00,
  breakEvenPrice: 521.00,      // Entry price
  quickTpPrice: 521.52,         // BE + 0.05%
  tp1Price: 523.00,             // First TP
  tp2Price: 524.00,             // Second TP (calculate based on your strategy)
  stopLossPrice: 519.60,        // SL from your current position
  openedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  status: 'ACTIVE',
  // TP/SL state flags
  isBreakEvenHit: false,
  trailingActive: false,
  isTp1Hit: false,
  isTp2Hit: false,
  pumpOverrideApplied: false,
  spoofingOverrideApplied: false,
  volatilityOverrideApplied: false,
  trailingDistancePct: 0.10
};

try {
  // Read current snapshot
  let snapshot;
  if (fs.existsSync(snapshotPath)) {
    const data = fs.readFileSync(snapshotPath, 'utf8');
    snapshot = JSON.parse(data);
  } else {
    snapshot = { timestamp: new Date().toISOString(), positions: {} };
  }

  // Add BCH position
  const key = `${bchPosition.symbol}_${bchPosition.side}`;
  snapshot.positions[key] = bchPosition;
  snapshot.timestamp = new Date().toISOString();

  // Write back
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  console.log(`✅ Added ${key} to snapshot`);
  console.log(`   Entry: $${bchPosition.entryPrice}`);
  console.log(`   Quick TP: $${bchPosition.quickTpPrice}`);
  console.log(`   TP1: $${bchPosition.tp1Price}`);
  console.log(`   SL: $${bchPosition.stopLossPrice}`);
  console.log(`   Qty: ${bchPosition.qty}`);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
