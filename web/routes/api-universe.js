// web/routes/api-universe.js
import express from "express";
import {
  getUniverseSnapshot,
  getSymbolsByCategory
} from "../../src/market/universe_v2.js";

const router = express.Router();

/* ---------------------------------------------------------
   /api/universe – Full snapshot
--------------------------------------------------------- */
router.get("/", (req, res) => {
  const uni = getUniverseSnapshot();

  res.json({
    fetchedAt: uni.fetchedAt,
    totalSymbols: uni.stats.totalSymbols,
    stats: uni.stats,
    symbols: uni.symbols
  });
});

/* ---------------------------------------------------------
   /api/universe/categories – lists by category
--------------------------------------------------------- */
router.get("/categories", (req, res) => {
  res.json({
    prime: getSymbolsByCategory("Prime"),
    normal: getSymbolsByCategory("Normal"),
    wild: getSymbolsByCategory("Wild")
  });
});

export default router;
