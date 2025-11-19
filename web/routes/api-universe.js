// web/routes/api-universe.js
import express from "express";
import { readUniverseFromDisk } from "../../src/market/universeFile.js";

const router = express.Router();

// /api/universe
router.get("/", (req, res) => {
  const uni = readUniverseFromDisk();

  return res.json({
    fetchedAt: uni.fetchedAt,
    totalSymbols: uni.totalSymbols || 0,
    primeCount: uni.primeCount || 0,
    normalCount: uni.normalCount || 0,
    wildCount: uni.wildCount || 0,
    symbols: uni.symbols || []
  });
});

// /api/universe/categories
router.get("/categories", (req, res) => {
  const uni = readUniverseFromDisk();

  return res.json({
    totalSymbols: uni.totalSymbols || 0,
    prime: uni.symbols.filter(s => s.category === "prime"),
    normal: uni.symbols.filter(s => s.category === "normal"),
    wild: uni.symbols.filter(s => s.category === "wild"),
  });
});

export default router;
