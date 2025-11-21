// =======================================
// test-feature-engine-api.js — FAZA 4 API Test
// =======================================

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8080/api/features';

// Test data for API calls
const sampleMarketData = {
  symbol: 'BTCUSDT',
  orderbook: {
    bids: [
      [43500.12, 0.5],
      [43499.88, 1.2],
      [43499.50, 0.8],
      [43498.90, 2.1],
      [43498.00, 1.5]
    ],
    asks: [
      [43500.50, 0.7],
      [43501.20, 1.0],
      [43501.80, 0.9],
      [43502.40, 1.8],
      [43503.00, 2.2]
    ]
  },
  trades: [
    { price: 43500.25, size: 0.1, side: 'buy', timestamp: Date.now() - 1000 },
    { price: 43500.15, size: 0.2, side: 'sell', timestamp: Date.now() - 2000 },
    { price: 43500.35, size: 0.15, side: 'buy', timestamp: Date.now() - 3000 }
  ],
  ticker: {
    price: 43500.25,
    volume24h: 15420.5,
    change24h: 2.15
  },
  candles: [
    { open: 43480, high: 43520, low: 43470, close: 43500, volume: 125.5, timestamp: Date.now() - 60000 },
    { open: 43500, high: 43510, low: 43490, close: 43505, volume: 98.2, timestamp: Date.now() - 120000 }
  ]
};

// Helper function for API calls
async function apiCall(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const data = await response.json();

    console.log(`\\n📡 ${method} ${endpoint}`);
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));

    return { response, data };
  } catch (error) {
    console.error(`❌ API Call Failed - ${method} ${endpoint}:`, error.message);
    return { error };
  }
}

// Main test function
async function testFeatureEngineAPI() {
  console.log('🚀 Starting Feature Engine API Tests');
  console.log('=====================================');

  // 1. Health Check
  console.log('\\n1️⃣ Testing Health Check');
  await apiCall('/health');

  // 2. Get Configuration
  console.log('\\n2️⃣ Testing Configuration');
  await apiCall('/config');

  // 3. Get Overview (empty initially)
  console.log('\\n3️⃣ Testing Overview (should be empty)');
  await apiCall('/overview');

  // 4. Update Single Symbol
  console.log('\\n4️⃣ Testing Single Symbol Update');
  await apiCall('/update/BTCUSDT', 'POST', { marketData: sampleMarketData });

  // 5. Get Single Symbol Features
  console.log('\\n5️⃣ Testing Single Symbol Retrieval');
  await apiCall('/symbol/BTCUSDT');

  // 6. Get Overview (should have data now)
  console.log('\\n6️⃣ Testing Overview (should have BTCUSDT)');
  await apiCall('/overview');

  // 7. Get Performance Metrics
  console.log('\\n7️⃣ Testing Performance Metrics');
  await apiCall('/performance');

  // 8. Get Risk Summary
  console.log('\\n8️⃣ Testing Risk Summary');
  await apiCall('/risks');

  // 9. Test Bulk Update
  console.log('\\n9️⃣ Testing Bulk Update');
  const bulkData = {
    updates: [
      { symbol: 'ETHUSDT', marketData: { ...sampleMarketData, symbol: 'ETHUSDT' } },
      { symbol: 'ADAUSDT', marketData: { ...sampleMarketData, symbol: 'ADAUSDT' } }
    ]
  };
  await apiCall('/bulk-update', 'POST', bulkData);

  // 10. Get Updated Overview
  console.log('\\n🔟 Testing Overview (should have 3 symbols)');
  await apiCall('/overview');

  // 11. Test Reset Specific Symbol
  console.log('\\n1️⃣1️⃣ Testing Reset Specific Symbol');
  await apiCall('/reset', 'POST', { symbol: 'ETHUSDT' });

  // 12. Test Error Handling - Invalid Symbol
  console.log('\\n1️⃣2️⃣ Testing Error Handling - Invalid Symbol');
  await apiCall('/symbol/INVALID_SYMBOL');

  // 13. Test Reset All
  console.log('\\n1️⃣3️⃣ Testing Reset All');
  await apiCall('/reset', 'POST', {});

  // 14. Final Overview Check
  console.log('\\n1️⃣4️⃣ Final Overview Check (should be empty again)');
  await apiCall('/overview');

  console.log('\\n✅ All Feature Engine API Tests Completed!');
  console.log('=========================================');
}

// Run tests
testFeatureEngineAPI().catch(console.error);
