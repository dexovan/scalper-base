// src/market/universeFile.js
import fs from "fs";
import paths from "../config/paths.js";

const FILE = paths.UNIVERSE_FILE;

export function readUniverseFromDisk() {
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

  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}
