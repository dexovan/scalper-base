// web/routes/api-universe.js
import express from "express";
import { readUniverseFromDisk } from "../../src/market/universeFile.js";

const router = express.Router();

// /api/universe
router.get("/", (req, res) => {
  const uni = readUniverseFromDisk();

  return res.json({
    fetchedAt: uni.fetchedAt || null,
    totalSymbols: uni.totalSymbols || (Array.isArray(uni.symbols) ? uni.symbols.length : 0),

    symbols: uni.symbols || [],

    // NEW: kategoriše prema universe.json
    prime: uni.prime || [],
    normal: uni.normal || [],
    wild: uni.wild || []
  });
});

// /api/universe/categories
router.get("/categories", (req, res) => {
  const uni = readUniverseFromDisk();

  return res.json({
    totalSymbols: uni.totalSymbols || (Array.isArray(uni.symbols) ? uni.symbols.length : 0),

    prime: uni.prime || [],
    normal: uni.normal || [],
    wild: uni.wild || []
  });
});

export default router;
