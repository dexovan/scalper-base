#!/usr/bin/env node
/**
 * Create a test LTC position in tpsl_snapshot for Quick TP testing
 *
 * Usage: node scripts/create-test-ltc-position.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.join(__dirname, '../data/system/tpsl_snapshot.json');

// Create test LTC position
// Entry: 77.75
// Current: ~77.80
// Quick TP target: 77.78 (breakeven + 0.05% buffer)
const testPosition = {
  symbol: 'LTCUSDT',
  side: 'LONG',
  entryPrice: 77.75,
  qty: 10,
  breakEvenPrice: 77.75,
  quickTpPrice: 77.78,  // breakeven + 0.05% = 77.75 * 1.0005 = 77.78375
  tp1Price: 78.25,      // 0.50% above entry
  tp2Price: 78.53,      // 1.00% above entry
  stopLossPrice: 77.56, // 0.25% below entry
  openedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  status: 'ACTIVE'
};

// Create snapshot with the test position
const snapshot = {
  timestamp: new Date().toISOString(),
  positions: {
    'LTCUSDT_LONG': testPosition
  }
};

// Ensure directory exists
const dir = path.dirname(snapshotPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
  console.log(`✅ Created directory: ${dir}`);
}

// Write snapshot
fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
console.log(`✅ Created test LTC position in snapshot:`);
console.log(`   Symbol: ${testPosition.symbol}`);
console.log(`   Side: ${testPosition.side}`);
console.log(`   Entry: $${testPosition.entryPrice}`);
console.log(`   Quick TP Target: $${testPosition.quickTpPrice}`);
console.log(`   TP1: $${testPosition.tp1Price}`);
console.log(`   TP2: $${testPosition.tp2Price}`);
console.log(`   SL: $${testPosition.stopLossPrice}`);
console.log(`\n📄 Snapshot saved to: ${snapshotPath}`);
console.log(`\n🔍 Next steps:`);
console.log(`   1. Run: npm start`);
console.log(`   2. Monitor logs for "[RiskEngine] LTC Price Update" messages`);
console.log(`   3. When price >= $${testPosition.quickTpPrice}, Quick TP should trigger`);
console.log(`   4. Look for: "[TpslEngine] 🚀 QUICK TP HIT for LTCUSDT_LONG"`);
