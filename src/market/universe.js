import { initUniverse, refreshUniversePeriodically, getUniverseSnapshot } from "../src/market/universe.js";

console.log("Starting Universe test with periodic refresh...");

await initUniverse();
refreshUniversePeriodically();

setInterval(() => {
  const uni = getUniverseSnapshot();
  console.log("Updated at:", uni.stats.lastUniverseUpdateAt);
  console.log("Total:", uni.stats.totalSymbols, "Wild:", uni.stats.wildCount);
}, 5000);
