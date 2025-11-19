// src/market/symbolClassifier.js

// === PRIME LIST (najlikvidniji, sigurni, stabilni) ===
const PRIME_SET = new Set([
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "TONUSDT",
  "DOTUSDT", "TRXUSDT", "LTCUSDT", "ATOMUSDT", "ETCUSDT",
  "NEARUSDT", "APTUSDT", "SUIUSDT", "BCHUSDT"
]);

// === WILD detection heuristika ===
function isWild(symbol) {
  const s = symbol.toUpperCase();

  if (
    s.includes("1000") ||
    s.includes("10000") ||
    s.includes("BABYDOGE") ||
    s.includes("CHEEMS") ||
    s.includes("MOG") ||
    s.includes("PEPE") ||
    s.includes("RATS") ||
    s.includes("FLOKI") ||
    s.includes("ELON")
  ) {
    return true;
  }

  // wild futures tickers
  if (s.endsWith("PERP") && s.length > 10) return true;

  return false;
}

// === KLASIFIKACIJA ===
export function classifySymbols(symbolList) {
  const results = [];

  for (const symbol of symbolList) {
    let category = "normal";

    if (PRIME_SET.has(symbol)) {
      category = "prime";
    } else if (isWild(symbol)) {
      category = "wild";
    }

    results.push({ symbol, category });
  }

  return {
    totalSymbols: results.length,
    primeCount: results.filter(x => x.category === "prime").length,
    normalCount: results.filter(x => x.category === "normal").length,
    wildCount: results.filter(x => x.category === "wild").length,
    symbols: results
  };
}
