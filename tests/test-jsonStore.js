// tests/test-jsonStore.js
import * as jsonStore from "../src/storage/jsonStore.js";

console.log("🧪 Testing jsonStore functionality...\n");

async function testJsonStore() {
  try {
    // Test 1: writeSnapshot
    console.log("1️⃣ Testing writeSnapshot...");
    const snapshotResult = await jsonStore.writeSnapshot("orderbook", "TESTUSDT", { 
      testData: "snapshot", 
      timestamp: Date.now(),
      bids: [{ price: 90000, qty: 1.5 }],
      asks: [{ price: 90100, qty: 2.0 }]
    });
    console.log("✅ Snapshot result:", snapshotResult);

    // Test 2: appendJsonLine
    console.log("\n2️⃣ Testing appendJsonLine...");
    const appendResult = await jsonStore.appendJsonLine("trades_stream", "TESTUSDT", {
      tradeId: 1,
      price: 90050,
      qty: 0.1,
      side: "BUY"
    });
    console.log("✅ Append result:", appendResult);

    // Test 3: readSnapshot
    console.log("\n3️⃣ Testing readSnapshot...");
    const readResult = await jsonStore.readSnapshot("orderbook", "TESTUSDT");
    console.log("✅ Read snapshot:", readResult);

    // Test 4: readJsonLines
    console.log("\n4️⃣ Testing readJsonLines...");
    const linesResult = await jsonStore.readJsonLines("trades_stream", "TESTUSDT", null, 5);
    console.log("✅ Read lines:", linesResult);

    // Test 5: listSymbols
    console.log("\n5️⃣ Testing listSymbols...");
    const symbolsResult = await jsonStore.listSymbols("orderbook");
    console.log("✅ List symbols:", symbolsResult);

    console.log("\n🎉 All jsonStore tests completed!");

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testJsonStore();