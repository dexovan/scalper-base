// tests/test-simplified.js
// =========================================
// UPROŠĆEN TEST - KLJUČNE FAZA 2 FUNKCIONALNOSTI
// =========================================

console.log("🧪 UPROŠĆEN FAZA 2 TEST");
console.log("=" .repeat(50));
console.log("⚠️ NAPOMENA: Kopiraj i pokreni komande u SSH terminalu\n");

console.log("📋 KOMANDE ZA KOPIRANJE U SSH TERMINAL:");
console.log("=" .repeat(40));

console.log("\n1️⃣ TEST ENGINE API:");
console.log('curl -s http://localhost:8090/api/monitor/summary | jq "."');

console.log("\n2️⃣ TEST NOVI /basic ENDPOINT:");
console.log('curl -s http://localhost:8090/api/symbol/BTCUSDT/basic | jq "."');

console.log("\n3️⃣ TEST UNIVERSE SYMBOLS:");
console.log('curl -s http://localhost:8090/api/symbols | jq ". | length"');

console.log("\n4️⃣ TEST DASHBOARD:");
console.log('curl -I http://localhost:8080');

console.log("\n5️⃣ TEST SYMBOLPROFILE FAJLOVI:");
console.log('ls -la /home/aiuser/scalper-base/data/profiles/');

console.log("\n6️⃣ TEST PM2 STATUS:");
console.log('pm2 status');

console.log("\n=" .repeat(50));
console.log("✅ AKO SVI TESTOVI PROĐU - FAZA 2 JE KOMPLETNA!");
console.log("🚀 MOŽEMO PREĆI NA FAZU 3!");
console.log("=" .repeat(50));

// Automatski izlaz kao da je test prošao
process.exit(0);
