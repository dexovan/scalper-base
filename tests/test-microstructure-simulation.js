// tests/test-microstructure-simulation.js
import * as OrderbookManager from "../src/microstructure/OrderbookManager.js";

console.log("🧪 Testing Microstructure (without WebSocket)...\n");

async function testMicrostructure() {
  try {
    console.log("📋 Initializing OrderbookManager...");
    OrderbookManager.initMicrostructure();

    // Simulacija orderbook eventi
    console.log("\n1️⃣ Testing Orderbook Events...");
    const orderbookEvent = {
      bids: [
        { price: 90000, qty: 1.5 },
        { price: 89900, qty: 2.0 },
        { price: 89800, qty: 1.2 }
      ],
      asks: [
        { price: 90100, qty: 1.8 },
        { price: 90200, qty: 2.5 },
        { price: 90300, qty: 1.0 }
      ],
      lastUpdateId: 123456,
      ts: Date.now()
    };

    OrderbookManager.onOrderbookEvent("BTCUSDT", orderbookEvent);
    console.log("✅ Orderbook event processed");

    // Simulacija trade eventi
    console.log("\n2️⃣ Testing Trade Events...");
    const tradeEvents = [
      { price: 90050, qty: 0.1, side: "BUY", tradeId: "t1", ts: Date.now() },
      { price: 90075, qty: 0.2, side: "BUY", tradeId: "t2", ts: Date.now() + 1000 },
      { price: 90025, qty: 0.15, side: "SELL", tradeId: "t3", ts: Date.now() + 2000 },
      { price: 90100, qty: 0.3, side: "BUY", tradeId: "t4", ts: Date.now() + 3000 }
    ];

    for (const trade of tradeEvents) {
      OrderbookManager.onTradeEvent("BTCUSDT", trade);
      console.log(`✅ Trade processed: ${trade.side} ${trade.qty} @ $${trade.price}`);
    }

    // Test getters
    console.log("\n3️⃣ Testing Getters...");

    const microState = OrderbookManager.getSymbolMicroState("BTCUSDT");
    console.log("📊 MicroState:", {
      symbol: microState?.symbol,
      bestBid: microState?.priceInfo?.bestBid,
      bestAsk: microState?.priceInfo?.bestAsk,
      spread: microState?.priceInfo?.spread,
      lastPrice: microState?.priceInfo?.lastPrice,
      tradesCount: microState?.trades?.length
    });

    const orderbookSummary = OrderbookManager.getOrderbookSummary("BTCUSDT", 3);
    console.log("📈 Orderbook Summary:", {
      bestBid: orderbookSummary?.bestBid,
      bestAsk: orderbookSummary?.bestAsk,
      spread: orderbookSummary?.spread,
      bidsCount: orderbookSummary?.bids?.length,
      asksCount: orderbookSummary?.asks?.length
    });

    const recentTrades = OrderbookManager.getRecentTrades("BTCUSDT", 5);
    console.log("💰 Recent Trades:", {
      count: recentTrades?.length,
      lastPrice: recentTrades?.[recentTrades.length - 1]?.price,
      priceRange: recentTrades?.length > 0 ? {
        min: Math.min(...recentTrades.map(t => t.price)),
        max: Math.max(...recentTrades.map(t => t.price))
      } : null
    });

    const candles1s = OrderbookManager.getCandles("BTCUSDT", "1s", 5);
    console.log("🕯️ 1s Candles:", {
      count: candles1s?.length,
      latestCandle: candles1s?.[candles1s.length - 1] ? {
        open: candles1s[candles1s.length - 1].open,
        close: candles1s[candles1s.length - 1].close,
        volume: candles1s[candles1s.length - 1].volume,
        trades: candles1s[candles1s.length - 1].trades
      } : null
    });

    // Test validacije
    console.log("\n4️⃣ Testing Validations...");
    console.log("✅ bestBid < bestAsk:", microState?.priceInfo?.bestBid < microState?.priceInfo?.bestAsk);
    console.log("✅ Trades not empty:", recentTrades?.length > 0);
    console.log("✅ Candles created:", candles1s?.length > 0);
    console.log("✅ Spread positive:", (microState?.priceInfo?.spread || 0) > 0);

    // Test multiple symbols
    console.log("\n5️⃣ Testing Multiple Symbols...");
    OrderbookManager.onOrderbookEvent("ETHUSDT", {
      bids: [{ price: 3500, qty: 2.0 }],
      asks: [{ price: 3510, qty: 1.5 }],
      lastUpdateId: 789,
      ts: Date.now()
    });

    OrderbookManager.onTradeEvent("ETHUSDT", {
      price: 3505, qty: 0.5, side: "BUY", tradeId: "eth1", ts: Date.now()
    });

    const activeSymbols = OrderbookManager.getActiveSymbols();
    console.log("📋 Active Symbols:", activeSymbols);
    console.log("✅ Multiple symbols:", activeSymbols.length >= 2);

    console.log("\n🎉 All microstructure tests completed successfully!");

  } catch (error) {
    console.error("❌ Test failed:", error);
    console.error("Stack:", error.stack);
  }
}

testMicrostructure();
