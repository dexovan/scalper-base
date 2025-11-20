// tests/test-bybit-ws.js
// =========================================
// TEST 2 - Bybit WebSocket Test
// Validates: ✔ connected, receives 10+ events, correct parsing
// =========================================

import WebSocket from "ws";

console.log("🧪 TEST 2: Bybit WebSocket");
console.log("=" .repeat(50));

async function testBybitWebSocket() {
  return new Promise((resolve) => {
    let connected = false;
    let messageCount = 0;
    let tickerEvents = 0;
    let tradeEvents = 0;
    let validParsing = true;
    const errors = [];

    const timeout = 30000; // 30 seconds
    const requiredEvents = 10;

    console.log("🔌 Connecting to Bybit WebSocket...");

    const ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");

    // Set timeout
    const timer = setTimeout(() => {
      console.log("⏰ Test timeout reached");
      ws.close();

      if (messageCount >= requiredEvents && connected) {
        console.log("✔️ SUCCESS: Received sufficient messages before timeout");
        resolve(true);
      } else {
        console.log(`❌ FAILED: Only received ${messageCount}/${requiredEvents} messages`);
        resolve(false);
      }
    }, Math.min(timeout, 8000)); // Cap timeout at 8 seconds for faster testing

    ws.on("open", () => {
      console.log("✔️ WebSocket connected");
      connected = true;

      // Subscribe to a few symbols for testing
      const subscription = {
        op: "subscribe",
        args: [
          "tickers.BTCUSDT",
          "publicTrade.BTCUSDT",
          "tickers.ETHUSDT",
          "publicTrade.ETHUSDT"
        ]
      };

      console.log("📡 Subscribing to test symbols...");
      ws.send(JSON.stringify(subscription));
    });

    ws.on("message", (data) => {
      try {
        messageCount++;
        const message = JSON.parse(data.toString());

        // Log first few messages for debugging
        if (messageCount <= 3) {
          console.log(`📨 Message ${messageCount}:`, JSON.stringify(message, null, 2));
        }

        // Check for subscription confirmation
        if (message.success && message.op === "subscribe") {
          console.log("✔️ Subscription confirmed");
          return;
        }

        // Check for ticker data
        if (message.topic && message.topic.startsWith("tickers.")) {
          tickerEvents++;

          // Validate ticker structure
          if (message.data && message.data.symbol && message.data.lastPrice !== undefined) {
            console.log(`📊 Ticker: ${message.data.symbol} = ${message.data.lastPrice}`);
          } else {
            errors.push("Invalid ticker structure");
            validParsing = false;
          }
        }

        // Check for trade data
        if (message.topic && message.topic.startsWith("publicTrade.")) {
          tradeEvents++;

          // Validate trade structure
          if (message.data && Array.isArray(message.data) && message.data[0]) {
            const trade = message.data[0];
            if (trade.symbol && trade.price && trade.side) {
              console.log(`💰 Trade: ${trade.symbol} ${trade.side} @ ${trade.price}`);
            } else {
              errors.push("Invalid trade structure");
              validParsing = false;
            }
          }
        }

        // Check if we have enough events
        if (messageCount >= requiredEvents) {
          clearTimeout(timer);
          ws.close();

          console.log("\n📊 TEST RESULTS:");
          console.log(`   Messages received: ${messageCount}`);
          console.log(`   Ticker events: ${tickerEvents}`);
          console.log(`   Trade events: ${tradeEvents}`);
          console.log(`   Valid parsing: ${validParsing}`);

          if (errors.length > 0) {
            console.log("⚠️ Parsing errors:", errors);
          }

          const success = connected && messageCount >= requiredEvents && validParsing && errors.length === 0;

          if (success) {
            console.log("🎉 TEST 2 PASSED: WebSocket working correctly");
          } else {
            console.log("❌ TEST 2 FAILED: Issues detected");
          }

          resolve(success);
        }

      } catch (error) {
        errors.push(`JSON parse error: ${error.message}`);
        validParsing = false;
      }
    });

    ws.on("error", (error) => {
      console.error("❌ WebSocket error:", error.message);
      clearTimeout(timer);
      resolve(false);
    });

    ws.on("close", () => {
      console.log("🔌 WebSocket disconnected");
      clearTimeout(timer);
    });
  });
}

// Run test
testBybitWebSocket()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("💥 Test execution failed:", error);
    process.exit(1);
  });
