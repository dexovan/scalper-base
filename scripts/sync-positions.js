#!/usr/bin/env node
/**
 * sync-positions.js
 * Load ALL active positions from Bybit and sync them to snapshot
 * UNIVERSAL - works with any positions, no hardcoding
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import CONFIG from '../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file manually (no dotenv dependency)
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');
        if (key && value) {
          process.env[key.trim()] = value.trim();
        }
      }
    });
  }
}

loadEnv();

const snapshotPath = path.join(__dirname, '../data/system/tpsl_snapshot.json');
const RECV_WINDOW = 5000;

// ================================================================
// API FUNCTIONS
// ================================================================

function generateSignature(timestamp, apiKey, recvWindow, queryString, apiSecret) {
  const message = timestamp + apiKey + recvWindow + queryString;
  return crypto.createHmac("sha256", apiSecret).update(message).digest("hex");
}

function getCredentials() {
  const apiKey = process.env.BYBIT_API_KEY || CONFIG.bybit.apiKey || "";
  const apiSecret = process.env.BYBIT_API_SECRET || CONFIG.bybit.apiSecret || "";
  const env = process.env.BYBIT_ENV || "MAINNET";

  if (!apiKey || !apiSecret) {
    throw new Error("❌ Bybit API credentials not configured");
  }

  return { apiKey, apiSecret, env };
}

function getBaseUrl(env) {
  return env === "MAINNET" ? "https://api.bybit.com" : "https://api-testnet.bybit.com";
}

async function makeRequest(method, endpoint, params = {}) {
  const { apiKey, apiSecret, env } = getCredentials();
  const baseUrl = getBaseUrl(env);
  const timestamp = Date.now().toString();
  const recvWindow = RECV_WINDOW.toString();

  let url = `${baseUrl}${endpoint}`;
  let queryString = "";

  if (method === "GET") {
    queryString = new URLSearchParams(params).toString();
    if (queryString) url += `?${queryString}`;
  } else {
    queryString = JSON.stringify(params);
  }

  const signature = generateSignature(timestamp, apiKey, recvWindow, queryString, apiSecret);

  const headers = {
    "X-BAPI-SIGN": signature,
    "X-BAPI-API-KEY": apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-RECV-WINDOW": recvWindow,
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? queryString : undefined,
  });

  const data = await response.json();
  if (data.retCode !== 0) {
    throw new Error(`Bybit API: ${data.retMsg}`);
  }

  return data.result || {};
}

async function getAllActivePositions() {
  const result = await makeRequest("GET", "/v5/position/list", {
    category: "linear",
    settleCoin: "USDT"
  });
  const positions = result.list || [];

  return positions
    .filter(p => parseFloat(p.size) !== 0)
    .map(p => ({
      symbol: p.symbol,
      side: p.side,
      size: parseFloat(p.size),
      entryPrice: parseFloat(p.avgPrice),
      markPrice: parseFloat(p.markPrice),
      unrealisedPnl: parseFloat(p.unrealisedPnl),
      leverage: parseFloat(p.leverage),
    }));
}

// ================================================================
// TP/SL CALCULATION
// ================================================================

function calculateTpSlPrices(entryPrice, side) {
  // More realistic scalping targets
  const tp1Pct = 0.0015;     // +0.15% (tight scalp)
  const tp2Pct = 0.0035;     // +0.35% (medium scalp)
  const slPct = 0.0010;      // -0.10% (tight SL)
  const bePct = 0.0002;      // +0.02% (BE buffer)

  if (side === 'Buy' || side === 'LONG') {
    return {
      tp1Price: entryPrice * (1 + tp1Pct),
      tp2Price: entryPrice * (1 + tp2Pct),
      stopLossPrice: entryPrice * (1 - slPct),
      breakEvenPrice: entryPrice,
      quickTpPrice: entryPrice * (1 + bePct)
    };
  } else {
    return {
      tp1Price: entryPrice * (1 - tp1Pct),
      tp2Price: entryPrice * (1 - tp2Pct),
      stopLossPrice: entryPrice * (1 + slPct),
      breakEvenPrice: entryPrice,
      quickTpPrice: entryPrice * (1 - bePct)
    };
  }
}

function convertToTpslFormat(bybitPosition) {
  const { symbol, side, size, entryPrice, leverage } = bybitPosition;
  const internalSide = side === 'Buy' ? 'LONG' : 'SHORT';
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

// ================================================================
// MAIN
// ================================================================

async function main() {
  try {
    console.log('\n📡 Loading all active positions from Bybit...\n');

    const bybitPositions = await getAllActivePositions();

    if (bybitPositions.length === 0) {
      console.log('ℹ️  No active positions found on Bybit');
      process.exit(0);
    }

    console.log(`📊 Found ${bybitPositions.length} active position(s) on Bybit\n`);

    let snapshot;
    if (fs.existsSync(snapshotPath)) {
      const data = fs.readFileSync(snapshotPath, 'utf8');
      snapshot = JSON.parse(data);
    } else {
      snapshot = { timestamp: new Date().toISOString(), positions: {} };
    }

    let addedCount = 0;

    for (const bybitPosition of bybitPositions) {
      const tpslState = convertToTpslFormat(bybitPosition);
      const key = `${bybitPosition.symbol}_${tpslState.side}`;

      snapshot.positions[key] = tpslState;
      addedCount++;

      console.log(`✅ ${key}`);
      console.log(`   Entry: $${tpslState.entryPrice.toFixed(4)}`);
      console.log(`   Quick TP: $${tpslState.quickTpPrice.toFixed(4)}`);
      console.log(`   TP1: $${tpslState.tp1Price.toFixed(4)}`);
      console.log(`   TP2: $${tpslState.tp2Price.toFixed(4)}`);
      console.log(`   SL: $${tpslState.stopLossPrice.toFixed(4)}`);
      console.log(`   Qty: ${tpslState.qty}\n`);
    }

    snapshot.timestamp = new Date().toISOString();
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    console.log(`✅ Snapshot synced: ${addedCount} position(s)`);
    console.log(`📁 ${snapshotPath}\n`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
