// ===============================================
// TEST: Bybit Public REST + WS Connector (Phase 2)
// ===============================================

import { fetchInstrumentsUSDTPerp, initPublicConnection, onPublicEvent, getWsStatus }
  from "../src/connectors/bybitPublic.js";

console.log("\n═══════════════════════════════════════════════");
console.log("▶ TEST: BYBIT PUBLIC CONNECTOR");
console.log("═══════════════════════════════════════════════\n");

let messageCount = 0;

// 1️⃣ TEST REST FETCH
console.log("🔍 TEST 1: REST fetchInstrumentsUSDTPerp() ...");

try {
    const res = await fetchInstrumentsUSDTPerp();
    console.log("✔ REST SUCCESS:");
    console.log(`  → Symbols: ${res.symbols.length}`);
    console.log(`  → Fetched at: ${res.fetchedAt}`);
} catch (err) {
    console.error("❌ REST FAILED:", err.message);
    process.exit(1);
}

// 2️⃣ TEST WEBSOCKET
console.log("\n🔍 TEST 2: Public WS Connection ...");

await initPublicConnection();

console.log("⏳ Čekam 2–3 sekunde da WS primi prve poruke...");
await new Promise(r => setTimeout(r, 3000));

const wsStatus = getWsStatus();
console.log("✔ WS STATUS:", wsStatus);

// 3️⃣ EVENT TEST
console.log("\n🔍 TEST 3: WS events (ticker/trade) ...");

onPublicEvent(evt => {
    messageCount++;
    console.log(`📡 EVENT ${messageCount}:`, {
        type: evt.type,
        symbol: evt.symbol,
        t: evt.timestamp
    });

    if (messageCount >= 10) {
        console.log("\n═══════════════════════════════════════════════");
        console.log("✔ TEST COMPLETED — PRIMLJENO 10 DOGAĐAJA");
        console.log("═══════════════════════════════════════════════\n");
        process.exit(0);
    }
});

// ostavi skriptu aktivnom 10 sekundi
setTimeout(() => {
    console.log("\n⚠ Vreme isteklo, nedovoljno poruka");
    console.log("WS STATUS:", getWsStatus());
    process.exit(1);
}, 10000);
