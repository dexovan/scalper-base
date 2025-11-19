// tests/test-universe-refresh-interval.js

import {
  initUniverse,
  refreshUniversePeriodically,
  getUniverse
} from "../src/market/universe.js";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  console.log("🔍 TEST: Universe periodic refresh (interval = 15s)");

  console.log("➡️ 1) Initializing universe...");
  await initUniverse();

  let first = getUniverse().fetchedAt;
  console.log("⏳ Initial fetchedAt:", first);

  console.log("➡️ 2) Starting periodic refresh...");
  refreshUniversePeriodically();

  console.log("➡️ Waiting 20 seconds...");
  await sleep(20000);

  let second = getUniverse().fetchedAt;
  console.log("⏳ After 20 seconds:", second);

  if (first !== second) {
    console.log("✅ PASS: Universe refresh is working!");
  } else {
    console.log("❌ FAIL: Refresh did NOT update fetchedAt");
  }

  process.exit(0);
})();
