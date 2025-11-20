// src/storage/jsonStore.js
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { DATA_DIR } from "../config/paths.js";

// ================================================================
// TYPE → PODFOLDER MAPPING
// ================================================================
const TYPE_DIR_MAP = {
  orderbook: "orderbook",
  trades_stream: "trades_stream",
  microcandles: "microcandles",
  snapshots: "snapshots",
  metrics: "metrics",
};

// ================================================================
// HELPER FUNCTIONS
// ================================================================

/**
 * Kreira folder ako ne postoji
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Generiše putanju za dati tip, symbol i timeframe
 */
function getPathFor(type, symbol = null, timeframe = null) {
  const typeDir = TYPE_DIR_MAP[type];
  if (!typeDir) {
    throw new Error(`Unknown storage type: ${type}`);
  }

  let fullPath = path.join(DATA_DIR, typeDir);

  if (symbol) {
    fullPath = path.join(fullPath, symbol);
  }

  if (timeframe) {
    fullPath = path.join(fullPath, timeframe);
  }

  ensureDir(fullPath);
  return fullPath;
}

/**
 * Generiše naziv fajla sa timestamp-om
 */
function generateFilename(prefix = "data", extension = "json") {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `${prefix}_${timestamp}.${extension}`;
}

// ================================================================
// CORE API FUNCTIONS
// ================================================================

/**
 * Piše snapshot podatke u JSON fajl
 */
async function writeSnapshot(type, symbol, payload, timeframe = null) {
  try {
    const dirPath = getPathFor(type, symbol, timeframe);
    const filename = generateFilename("snapshot");
    const filePath = path.join(dirPath, filename);

    const data = {
      timestamp: new Date().toISOString(),
      symbol,
      type,
      timeframe,
      data: payload
    };

    await fsp.writeFile(filePath, JSON.stringify(data, null, 2));
    return { success: true, path: filePath };
  } catch (error) {
    console.error(`Error writing snapshot for ${symbol}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Dodaje JSON liniju u append-only fajl
 */
async function appendJsonLine(type, symbol, payload, timeframe = null) {
  try {
    const dirPath = getPathFor(type, symbol, timeframe);
    const filename = `${symbol}_${type}${timeframe ? `_${timeframe}` : ""}.jsonl`;
    const filePath = path.join(dirPath, filename);

    const line = {
      timestamp: new Date().toISOString(),
      symbol,
      type,
      timeframe,
      data: payload
    };

    const jsonLine = JSON.stringify(line) + '\n';
    await fsp.appendFile(filePath, jsonLine);
    return { success: true, path: filePath };
  } catch (error) {
    console.error(`Error appending line for ${symbol}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Čita poslednji snapshot fajl
 */
async function readSnapshot(type, symbol, timeframe = null) {
  try {
    const dirPath = getPathFor(type, symbol, timeframe);

    if (!fs.existsSync(dirPath)) {
      return { success: false, error: "Directory does not exist" };
    }

    const files = await fsp.readdir(dirPath);
    const snapshotFiles = files
      .filter(f => f.startsWith("snapshot_") && f.endsWith(".json"))
      .sort()
      .reverse(); // najnoviji prvi

    if (snapshotFiles.length === 0) {
      return { success: false, error: "No snapshots found" };
    }

    const filePath = path.join(dirPath, snapshotFiles[0]);
    const content = await fsp.readFile(filePath, 'utf8');
    const data = JSON.parse(content);

    return { success: true, data, path: filePath };
  } catch (error) {
    console.error(`Error reading snapshot for ${symbol}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Čita JSON linije iz append-only fajla
 */
async function readJsonLines(type, symbol, timeframe = null, limit = null) {
  try {
    const dirPath = getPathFor(type, symbol, timeframe);
    const filename = `${symbol}_${type}${timeframe ? `_${timeframe}` : ""}.jsonl`;
    const filePath = path.join(dirPath, filename);

    if (!fs.existsSync(filePath)) {
      return { success: true, data: [], path: filePath };
    }

    const content = await fsp.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    let parsedLines = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        console.warn(`Invalid JSON line in ${filePath}:`, line);
        return null;
      }
    }).filter(line => line !== null);

    // Ograniči broj linija ako je limit specificiran
    if (limit && limit > 0) {
      parsedLines = parsedLines.slice(-limit); // poslednje N linija
    }

    return { success: true, data: parsedLines, path: filePath };
  } catch (error) {
    console.error(`Error reading JSON lines for ${symbol}:`, error);
    return { success: false, error: error.message };
  }
}

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

/**
 * Lista svih simbola za dati tip
 */
async function listSymbols(type) {
  try {
    const typeDir = TYPE_DIR_MAP[type];
    if (!typeDir) {
      throw new Error(`Unknown storage type: ${type}`);
    }

    const basePath = path.join(DATA_DIR, typeDir);
    if (!fs.existsSync(basePath)) {
      return { success: true, symbols: [] };
    }

    const entries = await fsp.readdir(basePath, { withFileTypes: true });
    const symbols = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    return { success: true, symbols };
  } catch (error) {
    console.error(`Error listing symbols for type ${type}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Briše stare fajlove (cleanup)
 */
async function cleanupOldFiles(type, symbol, olderThanHours = 24) {
  try {
    const dirPath = getPathFor(type, symbol);
    if (!fs.existsSync(dirPath)) {
      return { success: true, deletedCount: 0 };
    }

    const files = await fsp.readdir(dirPath);
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await fsp.stat(filePath);

      if (stats.mtime.getTime() < cutoffTime) {
        await fsp.unlink(filePath);
        deletedCount++;
      }
    }

    return { success: true, deletedCount };
  } catch (error) {
    console.error(`Error cleaning up files for ${symbol}:`, error);
    return { success: false, error: error.message };
  }
}

// ================================================================
// EXPORTS
// ================================================================
export {
  getPathFor,
  writeSnapshot,
  appendJsonLine,
  readSnapshot,
  readJsonLines,
  listSymbols,
  cleanupOldFiles,
  TYPE_DIR_MAP
};

export default {
  getPathFor,
  writeSnapshot,
  appendJsonLine,
  readSnapshot,
  readJsonLines,
  listSymbols,
  cleanupOldFiles,
  TYPE_DIR_MAP
};
