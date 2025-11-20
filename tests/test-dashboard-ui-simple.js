// tests/test-dashboard-ui-simple.js
// =========================================
// SIMPLE DASHBOARD UI TEST
// Jednostavan test koji proverava dostupnost dashboard servera
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
  console.log("🧪 TEST 6: Dashboard UI (Simple)");
  console.log("=" .repeat(50));
  console.log("🌐 Testing dashboard availability");
  console.log("⚠️ NOTE: Dashboard must be running on port 8080\n");

  const endpoints = [
    { url: "http://localhost:8080/", name: "Dashboard Root", expectRedirect: true },
    { url: "http://localhost:8080/login", name: "Login Page", expectRedirect: false },
    { url: "http://localhost:8080/dashboard", name: "Dashboard Main", expectRedirect: true }
  ];

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const { url, name, expectRedirect } of endpoints) {
    console.log(`🔍 Testing: ${name} (${url})`);

    const statusCode = await testEndpointStatus(url);

    let success = false;
    if (expectRedirect && (statusCode === 302 || statusCode === 301)) {
      success = true;
      console.log(`   ✅ SUCCESS (HTTP ${statusCode} - Redirect as expected)`);
    } else if (!expectRedirect && statusCode === 200) {
      success = true;
      console.log(`   ✅ SUCCESS (HTTP ${statusCode})`);
    } else if (statusCode >= 200 && statusCode < 400) {
      success = true;
      console.log(`   ✅ SUCCESS (HTTP ${statusCode})`);
    } else {
      console.log(`   ❌ FAILED (HTTP ${statusCode})`);
    }

    if (success) {
      passed++;
    } else {
      failed++;
      results.push({ name, url, statusCode });
    }
  }

  console.log("\n📊 TEST RESULTS:");
  console.log("=" .repeat(50));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success rate: ${Math.round((passed / endpoints.length) * 100)}%`);

  if (results.length > 0) {
    console.log("\n❌ FAILED ENDPOINTS:");
    results.forEach(({ name, url, statusCode }) => {
      console.log(`   ${name}: ${url} (HTTP ${statusCode})`);
    });
  }

  const success = failed === 0;
  console.log(`\n${success ? '✅' : '❌'} TEST 6 ${success ? 'PASSED' : 'FAILED'}: ${success ? 'Dashboard is accessible' : 'Dashboard has issues'}`);

  process.exit(success ? 0 : 1);
}

main().catch(console.error);
