import { initUniverse, getUniverseSnapshot } from "../src/market/universe.js";

await initUniverse();

const uni = getUniverseSnapshot();

console.log("TOTAL:", uni.stats.totalSymbols);
console.log("Prime:", uni.stats.primeCount);
console.log("Wild:", uni.stats.wildCount);
console.log("Normal:", uni.stats.normalCount);

console.log("Example:", Object.keys(uni.symbols).slice(0, 5));
