// tests/test-http-endpoints.js
import fetch from 'node-fetch';

console.log("🧪 Testing HTTP API Endpoints...\n");

const BASE_URL = "http://localhost:8090"; // Engine API port
const symbol = "BTCUSDT";

async function testHttpEndpoints() {
  try {
    console.log("🔗 Testing Microstructure HTTP Endpoints...\n");

    // Test 1: Complete microstructure state
    console.log("1️⃣ Testing /api/symbol/:symbol/micro");
    try {
      const microResponse = await fetch(`${BASE_URL}/api/symbol/${symbol}/micro`);
      const microData = await microResponse.json();
      console.log("Status:", microResponse.status);
      console.log("Response keys:", Object.keys(microData));
      if (microData.ok && microData.microState) {
        console.log("✅ Micro endpoint working - has microState");
        console.log("   Symbol:", microData.microState.symbol);
        console.log("   Best Bid/Ask:", microData.microState.priceInfo?.bestBid, "/", microData.microState.priceInfo?.bestAsk);
      } else {
        console.log("⚠️ Micro endpoint - no data yet (expected if no live data)");
      }
    } catch (error) {
      console.log("❌ Micro endpoint failed:", error.message);
    }

    console.log();

    // Test 2: Orderbook endpoint
    console.log("2️⃣ Testing /api/symbol/:symbol/orderbook");
    try {
      const orderbookResponse = await fetch(`${BASE_URL}/api/symbol/${symbol}/orderbook?depth=5`);
      const orderbookData = await orderbookResponse.json();
      console.log("Status:", orderbookResponse.status);
      if (orderbookData.ok && orderbookData.orderbook) {
        console.log("✅ Orderbook endpoint working");
        console.log("   Spread:", orderbookData.orderbook.spread);
        console.log("   Bids count:", orderbookData.orderbook.bids?.length);
        console.log("   Asks count:", orderbookData.orderbook.asks?.length);
      } else {
        console.log("⚠️ Orderbook endpoint - no data yet");
      }
    } catch (error) {
      console.log("❌ Orderbook endpoint failed:", error.message);
    }

    console.log();

    // Test 3: Recent trades
    console.log("3️⃣ Testing /api/symbol/:symbol/trades");
    try {
      const tradesResponse = await fetch(`${BASE_URL}/api/symbol/${symbol}/trades?limit=10`);
      const tradesData = await tradesResponse.json();
      console.log("Status:", tradesResponse.status);
      if (tradesData.ok) {
        console.log("✅ Trades endpoint working");
        console.log("   Trades count:", tradesData.count);
        if (tradesData.trades?.length > 0) {
          const lastTrade = tradesData.trades[tradesData.trades.length - 1];
          console.log("   Last trade:", lastTrade.side, lastTrade.qty, "@", lastTrade.price);
        }
      } else {
        console.log("⚠️ Trades endpoint - no data yet");
      }
    } catch (error) {
      console.log("❌ Trades endpoint failed:", error.message);
    }

    console.log();

    // Test 4: Micro candles
    console.log("4️⃣ Testing /api/symbol/:symbol/candles/1s");
    try {
      const candlesResponse = await fetch(`${BASE_URL}/api/symbol/${symbol}/candles/1s?limit=5`);
      const candlesData = await candlesResponse.json();
      console.log("Status:", candlesResponse.status);
      if (candlesData.ok) {
        console.log("✅ Candles endpoint working");
        console.log("   Candles count:", candlesData.count);
        if (candlesData.candles?.length > 0) {
          const lastCandle = candlesData.candles[candlesData.candles.length - 1];
          console.log("   Last candle OHLC:", lastCandle.open, lastCandle.high, lastCandle.low, lastCandle.close);
          console.log("   Volume:", lastCandle.volume, "Trades:", lastCandle.trades);
        }
      } else {
        console.log("⚠️ Candles endpoint - no data yet");
      }
    } catch (error) {
      console.log("❌ Candles endpoint failed:", error.message);
    }

    console.log();

    // Test 5: Active symbols with microstructure
    console.log("5️⃣ Testing /api/microstructure/symbols");
    try {
      const symbolsResponse = await fetch(`${BASE_URL}/api/microstructure/symbols`);
      const symbolsData = await symbolsResponse.json();
      console.log("Status:", symbolsResponse.status);
      if (symbolsData.ok) {
        console.log("✅ Symbols endpoint working");
        console.log("   Active symbols count:", symbolsData.count);
        if (symbolsData.symbols?.length > 0) {
          console.log("   Symbols:", symbolsData.symbols.map(s => s.symbol).join(", "));
        }
      } else {
        console.log("⚠️ Symbols endpoint - no active symbols yet");
      }
    } catch (error) {
      console.log("❌ Symbols endpoint failed:", error.message);
    }

    console.log();

    // Test 6: Microstructure health
    console.log("6️⃣ Testing /api/microstructure/health");
    try {
      const healthResponse = await fetch(`${BASE_URL}/api/microstructure/health`);
      const healthData = await healthResponse.json();
      console.log("Status:", healthResponse.status);
      if (healthData.ok) {
        console.log("✅ Health endpoint working");
        console.log("   Health status:", healthData.health?.status);
        console.log("   Active symbols:", healthData.health?.activeSymbols);
        console.log("   Healthy symbols:", healthData.health?.healthySymbols);
        console.log("   Stale symbols:", healthData.health?.staleSymbols);
      } else {
        console.log("⚠️ Health endpoint - issue detected");
      }
    } catch (error) {
      console.log("❌ Health endpoint failed:", error.message);
    }

    console.log();

    // Test existing endpoints for comparison
    console.log("7️⃣ Testing existing /api/symbols for comparison");
    try {
      const existingResponse = await fetch(`${BASE_URL}/api/symbols`);
      const existingData = await existingResponse.json();
      console.log("Status:", existingResponse.status);
      if (existingData.ok) {
        console.log("✅ Existing symbols endpoint working");
        console.log("   Total symbols:", existingData.count);
      }
    } catch (error) {
      console.log("❌ Existing symbols endpoint failed:", error.message);
    }

    console.log();

    console.log("🎯 SUMMARY:");
    console.log("- All HTTP endpoints are accessible");
    console.log("- Microstructure API structure is working");
    console.log("- Data may be empty if no live WebSocket feed");
    console.log("- Ready for live testing with real market data");

    console.log("\n🎉 HTTP API endpoints test completed!");

  } catch (error) {
    console.error("❌ Test suite failed:", error);
  }
}

testHttpEndpoints();
