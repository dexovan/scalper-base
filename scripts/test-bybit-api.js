// ============================================================
// TEST BYBIT API CONNECTION
// Quick test to verify API keys are valid
// ============================================================

import crypto from 'crypto';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_API_SECRET;
const BASE_URL = 'https://api.bybit.com';

function createSignature(params, apiSecret) {
  const orderedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});

  const queryString = Object.entries(orderedParams)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
}

async function testBybitConnection() {
  console.log('\n🔐 TESTING BYBIT API CONNECTION...\n');

  // Check if keys are loaded
  if (!API_KEY || !API_SECRET) {
    console.log('❌ ERROR: Bybit API keys not found in .env file!');
    console.log('   Add these to .env:');
    console.log('   BYBIT_API_KEY=your_key');
    console.log('   BYBIT_API_SECRET=your_secret');
    return;
  }

  console.log(`✅ API Key loaded: ${API_KEY.substring(0, 8)}...`);
  console.log(`✅ API Secret loaded: ${API_SECRET.substring(0, 8)}...\n`);

  try {
    // Test 1: Get Wallet Balance
    console.log('📊 Test 1: Get Wallet Balance...');
    const timestamp = Date.now();
    const params = {
      api_key: API_KEY,
      timestamp,
      accountType: 'UNIFIED'
    };

    const signature = createSignature(params, API_SECRET);
    params.sign = signature;

    const queryString = new URLSearchParams(params).toString();
    const response = await fetch(`${BASE_URL}/v5/account/wallet-balance?${queryString}`);
    const data = await response.json();

    if (data.retCode === 0) {
      console.log('✅ API Connection: SUCCESS');
      console.log('✅ Authentication: VALID');

      // Display balance
      const usdtCoin = data.result.list[0]?.coin.find(c => c.coin === 'USDT');
      if (usdtCoin) {
        const balance = parseFloat(usdtCoin.walletBalance);
        const available = parseFloat(usdtCoin.availableToWithdraw);
        console.log(`\n💰 USDT Balance:`);
        console.log(`   Total: $${balance.toFixed(2)}`);
        console.log(`   Available: $${available.toFixed(2)}`);

        if (balance < 100) {
          console.log(`\n⚠️  WARNING: Balance below minimum ($100 required)`);
        } else {
          console.log(`\n✅ Balance sufficient for trading`);
        }
      }

      console.log('\n✅ BYBIT API KEYS ARE VALID!\n');

    } else {
      console.log(`❌ API Error: ${data.retMsg}`);
      console.log(`   Code: ${data.retCode}`);

      if (data.retCode === 10003) {
        console.log('\n⚠️  Invalid API key or signature');
        console.log('   Check your .env file:');
        console.log('   - API key correct?');
        console.log('   - API secret correct?');
        console.log('   - No extra spaces?');
      }
    }

  } catch (error) {
    console.log(`❌ Connection Error: ${error.message}`);
    console.log('   Check:');
    console.log('   - Internet connection');
    console.log('   - Bybit API status');
    console.log('   - Firewall settings');
  }
}

// Run test
testBybitConnection();
