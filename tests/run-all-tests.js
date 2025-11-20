// tests/run-all-tests.js
// =========================================
// MASTER TEST RUNNER - Complete Faza 2 Validation
// Runs all 7 tests in sequence and provides summary
// =========================================

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.log("🧪 MASTER TEST RUNNER - FAZA 2 COMPLETE VALIDATION");
console.log("=" .repeat(60));
console.log("Running comprehensive test suite to validate Phase 2 implementation\n");

const tests = [
  {
    name: "Bybit REST API",
    file: "test-bybit-rest.js",
    description: "Tests Bybit instrument fetching (~500 symbols, valid fields)"
  },
  {
    name: "Bybit WebSocket",
    file: "test-bybit-ws.js",
    description: "Tests WebSocket connectivity and message parsing"
  },
  {
    name: "Universe v2",
    file: "test-universe.mjs",
    description: "Tests symbol categorization and management"
  },
  {
    name: "SymbolProfile System",
    file: "test-symbol-profile.js",
    description: "Tests profile loading, saving, and persistence"
  },
  {
    name: "API Endpoints",
    file: "test-api-endpoints.js",
    description: "Tests all HTTP API endpoints including new /basic endpoint"
  },
  {
    name: "Dashboard UI",
    file: "test-dashboard-ui.js",
    description: "Tests dashboard availability and proxy functionality"
  },
  {
    name: "PM2 Processes",
    file: "test-pm2-processes.js",
    description: "Tests process management and service stability"
  }
];

async function runAllTests() {
  console.log(`🎯 Executing ${tests.length} test suites...\n`);

  const results = [];
  let totalPassed = 0;

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const testNum = i + 1;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 TEST ${testNum}/${tests.length}: ${test.name}`);
    console.log(`📋 ${test.description}`);
    console.log(`${'='.repeat(60)}`);

    try {
      const startTime = Date.now();

      await execAsync(`node ${test.file}`, {
        cwd: process.cwd(),
        timeout: 60000 // 60 second timeout per test
      });

      const duration = Date.now() - startTime;

      console.log(`✅ TEST ${testNum} PASSED (${duration}ms)`);
      results.push({
        name: test.name,
        status: 'PASS',
        duration: duration,
        error: null
      });
      totalPassed++;

    } catch (error) {
      const duration = Date.now() - (results[results.length - 1]?.startTime || Date.now());

      console.log(`❌ TEST ${testNum} FAILED`);
      console.log(`Error: ${error.message}`);

      results.push({
        name: test.name,
        status: 'FAIL',
        duration: duration,
        error: error.message
      });
    }

    // Small delay between tests
    if (i < tests.length - 1) {
      console.log("\n⏳ Waiting 2 seconds before next test...");
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Final Summary
  console.log("\n" + "=".repeat(60));
  console.log("🏁 FAZA 2 TEST SUITE COMPLETE");
  console.log("=" .repeat(60));

  console.log(`\n📊 OVERALL RESULTS:`);
  console.log(`✅ Passed: ${totalPassed}/${tests.length}`);
  console.log(`❌ Failed: ${tests.length - totalPassed}/${tests.length}`);
  console.log(`📈 Success Rate: ${Math.round((totalPassed / tests.length) * 100)}%`);

  // Detailed results
  console.log(`\n📋 DETAILED RESULTS:`);
  results.forEach((result, index) => {
    const status = result.status === 'PASS' ? '✅' : '❌';
    console.log(`${status} ${index + 1}. ${result.name} (${result.duration}ms)`);
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
  });

  // Failed tests details
  const failedTests = results.filter(r => r.status === 'FAIL');
  if (failedTests.length > 0) {
    console.log(`\n❌ FAILED TESTS SUMMARY:`);
    failedTests.forEach(test => {
      console.log(`   • ${test.name}: ${test.error}`);
    });
  }

  // Success criteria
  console.log(`\n🎯 FAZA 2 COMPLETION STATUS:`);

  if (totalPassed === tests.length) {
    console.log("🎉 FAZA 2 FULLY COMPLETE - ALL TESTS PASSED!");
    console.log("✅ Ready to proceed to Faza 3");
    console.log("✅ All systems validated and operational");

    console.log("\n🚀 NEXT STEPS:");
    console.log("   1. Commit changes: git add -A && git commit -m 'Complete Faza 2 implementation'");
    console.log("   2. Start Faza 3 planning");
    console.log("   3. Begin advanced dashboard features");

  } else if (totalPassed >= tests.length * 0.8) {
    console.log("⚠️  FAZA 2 MOSTLY COMPLETE - Minor issues detected");
    console.log("✅ Core functionality validated");
    console.log("⚠️ Some edge cases need attention");

    console.log("\n🔧 RECOMMENDED ACTIONS:");
    console.log("   1. Review failed tests above");
    console.log("   2. Fix critical issues");
    console.log("   3. Re-run: node tests/run-all-tests.js");

  } else {
    console.log("❌ FAZA 2 INCOMPLETE - Major issues detected");
    console.log("❌ Core systems need attention");
    console.log("🚨 DO NOT proceed to Faza 3");

    console.log("\n🆘 CRITICAL ACTIONS NEEDED:");
    console.log("   1. Review all failed tests");
    console.log("   2. Check PM2 process status");
    console.log("   3. Verify engine is running");
    console.log("   4. Check network connectivity");
  }

  const overallSuccess = totalPassed === tests.length;
  return overallSuccess;
}

// Run all tests
runAllTests()
  .then(success => {
    console.log("\n" + "=".repeat(60));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("💥 Master test runner failed:", error);
    process.exit(1);
  });
