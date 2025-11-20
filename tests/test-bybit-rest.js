// tests/test-bybit-rest.js
// =========================================
// TEST 1 - Bybit REST API Test
// Validates: ✔ success, ~500 symbols, valid fields
// =========================================

import { fetchInstrumentsUSDTPerp } from "../src/connectors/bybitPublic.js";

console.log("🧪 TEST 1: Bybit REST API");
console.log("=" .repeat(50));

async function testBybitRest() {
  try {
    console.log("📡 Fetching instruments from Bybit REST API...");

    const startTime = Date.now();
    const instruments = await fetchInstrumentsUSDTPerp();
    const duration = Date.now() - startTime;

    console.log(`⏱️ Fetch completed in ${duration}ms`);

    // Test 1: Success check
    if (!instruments || !Array.isArray(instruments)) {
      throw new Error("❌ Invalid response - not an array");
    }
    console.log("✔️ SUCCESS: Valid response received");

    // Test 2: Symbol count check (~500 expected)
    const symbolCount = instruments.length;
    console.log(`📊 Symbol count: ${symbolCount}`);

    if (symbolCount < 400) {
      console.warn("⚠️ WARNING: Fewer symbols than expected (< 400)");
    } else if (symbolCount > 600) {
      console.warn("⚠️ WARNING: More symbols than expected (> 600)");
    } else {
      console.log("✔️ SUCCESS: Symbol count within expected range (400-600)");
    }

    // Test 3: Valid fields check
    const sampleSymbol = instruments[0];
    const requiredFields = ['symbol', 'status', 'baseCoin', 'quoteCoin', 'launchTime'];
    const optionalFields = ['tickSize', 'lotSize', 'maxLeverage'];

    console.log("🔍 Sample symbol:", sampleSymbol.symbol);

    for (const field of requiredFields) {
      if (!sampleSymbol.hasOwnProperty(field)) {
        throw new Error(`❌ Missing required field: ${field}`);
      }
    }
    console.log("✔️ SUCCESS: All required fields present");

    // Check optional fields
    const presentOptional = optionalFields.filter(field => sampleSymbol.hasOwnProperty(field));
    console.log(`📋 Optional fields present: ${presentOptional.join(', ')}`);

    if (presentOptional.length === 0) {
      console.warn("⚠️ WARNING: No optional fields present");
    } else {
      console.log("✔️ SUCCESS: Some optional fields present");
    }

    // Sample data
    console.log("📄 Sample data:");
    console.log(`   Symbol: ${sampleSymbol.symbol}`);
    console.log(`   Status: ${sampleSymbol.status}`);
    console.log(`   Base: ${sampleSymbol.baseCoin}`);
    console.log(`   Quote: ${sampleSymbol.quoteCoin}`);

    console.log("\n🎉 TEST 1 PASSED: Bybit REST API working correctly");
    return true;

  } catch (error) {
    console.error("❌ TEST 1 FAILED:", error.message);
    console.error("Stack:", error.stack);
    return false;
  }
}

// Run test
testBybitRest()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("💥 Test execution failed:", error);
    process.exit(1);
  });
