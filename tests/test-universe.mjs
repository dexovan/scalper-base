// tests/test-universe.mjs
// ===========================================
// TEST: Universe v2 modul (Faza 2)
// Ne dira engine, ne dira monitoring
// ===========================================

import {
  initUniverse,
  getUniverseSnapshot,
  getUniverseStats,
  getUniverseFilePath,
} from "../src/market/universe_v2.js";

console.log("═══════════════════════════════════════════════");
console.log("▶ TEST: UNIVERSE MODULE (PHASE 2)");
console.log("═══════════════════════════════════════════════");
console.log("");

try {
  console.log("🔍 initUniverse() ...");
  const snap = await initUniverse();
  const stats = getUniverseStats();

  console.log("✔ UNIVERSE LOADED:");
  console.log(`  → fetchedAt:     ${snap.fetchedAt}`);
  console.log(`  → totalSymbols:  ${stats.totalSymbols}`);
  console.log(`  → Prime:         ${stats.primeCount}`);
  console.log(`  → Normal:        ${stats.normalCount}`);
  console.log(`  → Wild:          ${stats.wildCount}`);
  console.log("");

  const primeSample = Object.values(snap.symbols || {})
    .filter((s) => s.category === "Prime")
    .slice(0, 10)
    .map((s) => s.symbol);

  console.log("📊 Primer Prime simbola:", primeSample);
  console.log("");
  console.log("📝 Snapshot fajl:", getUniverseFilePath());
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("✔ TEST COMPLETE – UNIVERSE MODULE RADI");
  console.log("═══════════════════════════════════════════════");
} catch (err) {
  console.error("");
  console.error("❌ TEST FAILED:", err);
  console.error("");
  process.exit(1);
}
