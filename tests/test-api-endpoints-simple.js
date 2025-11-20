// tests/test-api-endpoints-simple.js
// =========================================
// SIMPLE API ENDPOINTS TEST
// Jednostavan test koji samo proverava HTTP status kodove
// =========================================

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function testEndpointStatus(url) {
  try {
    const { stdout } = await execAsync(`curl -s -w "%{http_code}" -o /dev/null "${url}"`, {
      timeout: 5000
    });
    return parseInt(stdout.trim());
  } catch (error) {
    console.log(`   ❌ Connection error: ${error.message}`);
    return 0;
  }
}

async function main() {
  console.log("🧪 TEST 5: API Endpoints (Simple)");
  console.log("=" .repeat(50));
  console.log("🌐 Testing endpoint availability (HTTP status only)");
  console.log("⚠️ NOTE: Engine must be running on port 8090\n");

  const endpoints = [
    "http://localhost:8090/api/monitor/summary",
    "http://localhost:8090/api/monitor/logs",
    "http://localhost:8090/api/monitor/tickers",
    "http://localhost:8090/api/monitor/trades",
    "http://localhost:8090/api/monitor/storage",
    "http://localhost:8090/api/monitor/universe",
    "http://localhost:8090/api/symbols",
    "http://localhost:8090/api/symbol/BTCUSDT/basic"
  ];

  let passed = 0;
  let failed = 0;
  const failedEndpoints = [];

  for (const endpoint of endpoints) {
    console.log(`🔍 Testing: ${endpoint}`);

    const statusCode = await testEndpointStatus(endpoint);

    if (statusCode >= 200 && statusCode < 300) {
      console.log(`   ✅ SUCCESS (HTTP ${statusCode})`);
      passed++;
    } else {
      console.log(`   ❌ FAILED (HTTP ${statusCode})`);
      failed++;
      failedEndpoints.push({ endpoint, statusCode });
    }
  }

  console.log("\n📊 TEST RESULTS:");
  console.log("=" .repeat(50));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success rate: ${Math.round((passed / endpoints.length) * 100)}%`);

  if (failedEndpoints.length > 0) {
    console.log("\n❌ FAILED ENDPOINTS:");
    failedEndpoints.forEach(({ endpoint, statusCode }) => {
      console.log(`   ${endpoint} (HTTP ${statusCode})`);
    });
  }

  const success = failed === 0;
  console.log(`\n${success ? '✅' : '❌'} TEST 5 ${success ? 'PASSED' : 'FAILED'}: ${success ? 'All endpoints respond correctly' : 'Some endpoints have issues'}`);

  process.exit(success ? 0 : 1);
}

main().catch(console.error);
