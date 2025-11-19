// src/market/universeFile.js
import fs from "fs";
import paths from "../config/paths.js";

const FILE = paths.UNIVERSE_FILE;

export function readUniverseFromDisk() {
  try {
    if (!fs.existsSync(FILE)) {
      return {
        fetchedAt: null,
        totalSymbols: 0,
        primeCount: 0,
        normalCount: 0,
        wildCount: 0,
        symbols: []
      };
    }

    const raw = fs.readFileSync(FILE, "utf8");
    return JSON.parse(raw);

  } catch (err) {
    console.error("❌ ERROR reading universe file:", err);
    return {
      fetchedAt: null,
      totalSymbols: 0,
      primeCount: 0,
      normalCount: 0,
      wildCount: 0,
      symbols: []
    };
  }
}
