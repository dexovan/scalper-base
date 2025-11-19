// tests/test-universe-refresh-interval.js
import { initUniverse, refreshUniversePeriodically, UniverseState } from "../src/market/universe.js";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  console.log("🔍 TEST: Universe periodic refresh (interval = 15s)");

  console.log("➡️ 1) Initializing universe...");
  await initUniverse();

  console.log("➡️ 2) Starting periodic refresh...");
  refreshUniversePeriodically();

  await sleep(2000);

  const firstTimestamp = UniverseState.lastRefresh;
  console.log("⏳ Initial refresh timestamp:", firstTimestamp);

  console.log("➡️ Waiting 20 seconds for next refresh...");
  await sleep(20000);

  const secondTimestamp = UniverseState.lastRefresh;
  console.log("⏳ After 20 seconds:", secondTimestamp);

  if (secondTimestamp !== firstTimestamp) {
    console.log("✅ PASS: Universe refresh interval is working correctly!");
  } else {
    console.log("❌ FAIL: Universe did NOT refresh in 15 seconds.");
  }

  process.exit(0);
})();
