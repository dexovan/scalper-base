// web/routes/api-universe.js
import express from "express";
import { readUniverseFromDisk } from "../../src/market/universeFile.js";

const router = express.Router();

// /api/universe
router.get("/", (req, res) => {
  const uni = readUniverseFromDisk();

  return res.json({
    fetchedAt: uni.fetchedAt || null,
    totalSymbols: Array.isArray(uni.symbols) ? uni.symbols.length : 0,
    symbols: uni.symbols || []
  });
});

// /api/universe/categories  (temporary, until categories exist)
router.get("/categories", (req, res) => {
  const uni = readUniverseFromDisk();

  const symbols = Array.isArray(uni.symbols) ? uni.symbols : [];

  return res.json({
    totalSymbols: symbols.length,
    prime: [],
    normal: [],
    wild: [],
    note: "Categories not implemented yet — symbols are simple strings."
  });
});

export default router;
