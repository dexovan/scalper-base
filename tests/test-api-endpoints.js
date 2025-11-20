// tests/test-api-endpoints.js
// =========================================
// TEST 5 - API Endpoints Test
// Validates all API endpoints return JSON without errors
// =========================================

// Jednostavan test koristi curl komande umesto komplikovane HTTP implementacije
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function testEndpoint(url) {
  try {
    const { stdout, stderr } = await execAsync(`curl -s -w "%{http_code}" -o /tmp/response.json "${url}" ; echo ; cat /tmp/response.json`, {
      timeout: 10000
    });

    const lines = stdout.trim().split('\n');
    const httpCode = parseInt(lines[0]);
    const responseBody = lines.slice(1).join('\n');

    return {
      ok: httpCode >= 200 && httpCode < 300,
      status: httpCode,
      text: () => Promise.resolve(responseBody),
      json: () => Promise.resolve(JSON.parse(responseBody))
    };
  } catch (error) {
    throw new Error(`Connection failed: ${error.message}`);
  }
}console.log("🧪 TEST 5: API Endpoints");
console.log("=" .repeat(50));

async function testAPIEndpoints() {
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

  console.log(`🌐 Testing ${endpoints.length} API endpoints...`);
  console.log("⚠️ NOTE: Engine must be running on port 8090 for this test\n");

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const endpoint of endpoints) {
    try {
      console.log(`🔍 Testing: ${endpoint}`);

      const response = await testEndpoint(endpoint);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Basic validation
      if (typeof data !== 'object' || data === null) {
        throw new Error("Response is not a valid JSON object");
      }

      // Check for specific endpoint requirements
      if (endpoint.includes('/summary')) {
        if (!data.timestamp || !data.engine || !data.system) {
          console.warn("⚠️ WARNING: Summary missing expected fields");
        }

        // Check new fields we added
        if (data.universe) {
          console.log("   ✔️ Universe metrics present");
        }
        if (data.marketData) {
          console.log("   ✔️ Market data metrics present");
        }
      }

      if (endpoint.includes('/basic')) {
        if (!data.symbol || (!data.meta && !data.profile)) {
          console.warn("⚠️ WARNING: Basic endpoint missing expected fields");
        } else {
          console.log("   ✔️ Symbol basic data complete");
        }
      }

      if (endpoint.includes('/tickers')) {
        if (Array.isArray(data) && data.length > 0) {
          console.log(`   ✔️ Tickers: ${data.length} symbols`);
        } else {
          console.warn("   ⚠️ WARNING: No ticker data");
        }
      }

      console.log("   ✔️ SUCCESS");
      passed++;
      results.push({ endpoint, status: 'PASS', error: null });

    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}`);
      failed++;
      results.push({ endpoint, status: 'FAIL', error: error.message });
    }

    console.log(""); // Empty line for readability
  }

  // Summary
  console.log("📊 TEST RESULTS:");
  console.log("=" .repeat(50));
  console.log(`✔️ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success rate: ${Math.round((passed / endpoints.length) * 100)}%\n`);

  // Detailed results
  if (failed > 0) {
    console.log("❌ FAILED ENDPOINTS:");
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => {
        console.log(`   ${r.endpoint}`);
        console.log(`     Error: ${r.error}\n`);
      });
  }

  // Universe and marketData validation
  const summaryResult = results.find(r => r.endpoint.includes('/summary'));
  if (summaryResult && summaryResult.status === 'PASS') {
    console.log("🔍 ADDITIONAL VALIDATIONS:");

    try {
      const summaryResponse = await fetch("http://localhost:8090/api/monitor/summary");
      const summaryData = await summaryResponse.json();

      if (summaryData.universe) {
        console.log("✔️ Universe metrics in summary");
        console.log(`   Total symbols: ${summaryData.universe.totalSymbols}`);
        console.log(`   Prime count: ${summaryData.universe.primeCount}`);
      } else {
        console.log("❌ Universe metrics missing from summary");
      }

      if (summaryData.marketData) {
        console.log("✔️ Market data metrics in summary");
        console.log(`   WS connected: ${summaryData.marketData.wsConnected}`);
      } else {
        console.log("❌ Market data metrics missing from summary");
      }

    } catch (error) {
      console.log("⚠️ WARNING: Could not validate summary details");
    }
  }

  const success = failed === 0;

  if (success) {
    console.log("\n🎉 TEST 5 PASSED: All API endpoints working correctly");
  } else {
    console.log("\n❌ TEST 5 FAILED: Some endpoints have issues");
  }

  return success;
}

// Check if we can import fetch (Node.js 18+ or polyfill needed)
if (typeof fetch === 'undefined') {
  console.log("⚠️ WARNING: fetch not available, using simple http request...");

  // Simple fetch polyfill for Node.js
  global.fetch = async function(url, options = {}) {
    const https = await import('https');
    const http = await import('http');
    const urlModule = await import('url');

    return new Promise((resolve, reject) => {
      const parsedUrl = new urlModule.URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.request(parsedUrl, {
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: {
              get: (name) => res.headers[name.toLowerCase()]
            },
            json: async () => JSON.parse(data),
            text: async () => data
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
      req.end(options.body);
    });
  };
}

// Run test
testAPIEndpoints()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("💥 Test execution failed:", error);
    process.exit(1);
  });
