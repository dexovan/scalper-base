// web/routes/api-universe.js
import express from "express";
import { getUniverseSnapshot, getSymbolMeta } from "../../src/market/universe.js";
import { loadProfile } from "../../src/market/symbolProfile.js";

const router = express.Router();

// ============================
// GET /api/universe
// ============================
router.get("/universe", (req, res) => {
  const uni = getUniverseSnapshot();

  if (!uni) {
    return res.status(500).json({ error: "Universe not initialized" });
  }

  const result = {
    fetchedAt: uni.fetchedAt,
    totalSymbols: uni.stats.totalSymbols,
    primeCount: uni.stats.primeCount,
    normalCount: uni.stats.normalCount,
    wildCount: uni.stats.wildCount,
    symbols: Object.values(uni.symbols).map(s => ({
      symbol: s.symbol,
      category: s.category,
      status: s.status,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      isNewListing: s.isNewListing,
      maxLeverage: s.maxLeverage
    }))
  };

  res.json(result);
});

// ============================
// GET /api/universe/categories
// ============================
router.get("/universe/categories", (req, res) => {
  const uni = getUniverseSnapshot();

  if (!uni) {
    return res.status(500).json({ error: "Universe not initialized" });
  }

  const result = {
    totalSymbols: uni.stats.totalSymbols,
    prime: Object.values(uni.symbols).filter(s => s.category === "Prime").map(s => s.symbol),
    normal: Object.values(uni.symbols).filter(s => s.category === "Normal").map(s => s.symbol),
    wild: Object.values(uni.symbols).filter(s => s.category === "Wild").map(s => s.symbol),
  };

  res.json(result);
});

// ============================
// GET /api/symbol/:symbol/basic
// ============================
router.get("/symbol/:symbol/basic", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  const meta = getSymbolMeta(symbol);
  if (!meta) {
    return res.status(404).json({ error: "Symbol not found" });
  }

  const profile = await loadProfile(symbol);

  res.json({
    symbol,
    meta,
    profile
  });
});

export default router;
