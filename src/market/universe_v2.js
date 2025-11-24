// src/market/universe.js
// ===========================================
// Universe v2 – Bybit USDT perp lista + meta
// BEZ diranja engine-a i monitora (sigurna varijanta)
// Snapshot se čuva u data/system/universe.v2.json
// ===========================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchInstrumentsUSDTPerp } from "../connectors/bybitPublic.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data/system");
// ⚠️ v2 snapshot, da ne diramo postojeći universe.json dok ne proverimo format
const UNIVERSE_FILE = path.join(DATA_DIR, "universe.v2.json");

// Prime simboli koji stvarno postoje na Bybit-u (verifikovano)
const DEFAULT_PRIME_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "ADAUSDT", "DOTUSDT", "AVAXUSDT"];

const UniverseState = {
  fetchedAt: null,
  symbols: {}, // symbol -> SymbolMeta
  stats: {
    totalSymbols: 0,
    primeCount: 0,
    normalCount: 0,
    wildCount: 0,
    lastUniverseUpdateAt: null,
  },
};

let refreshTimer = null;

function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function loadExistingUniverse() {
  try {
    if (!fs.existsSync(UNIVERSE_FILE)) return;
    const raw = await fs.promises.readFile(UNIVERSE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.symbols) {
      UniverseState.fetchedAt = parsed.fetchedAt || null;
      UniverseState.symbols = parsed.symbols || {};
      UniverseState.stats = parsed.stats || UniverseState.stats;
      console.log(
        `🌍 [UNIVERSE] Loaded existing snapshot → symbols=${Object.keys(
          UniverseState.symbols
        ).length}`
      );
    }
  } catch (err) {
    console.error("❌ [UNIVERSE] Failed to load existing snapshot:", err.message);
  }
}

async function saveUniverseSnapshot() {
  // DISABLED: Prevent disk fill - universe kept in memory only
  console.log("⚠️ [UNIVERSE] saveUniverseSnapshot() DISABLED - universe kept in RAM only");
  return;

  /* ORIGINAL CODE - DISABLED TO PREVENT DISK FILL:
  try {
    ensureDirExists(DATA_DIR);
    const snapshot = JSON.stringify(UniverseState, null, 2);
    await fs.promises.writeFile(UNIVERSE_FILE, snapshot, "utf8");
  } catch (err) {
    console.error("❌ [UNIVERSE] Failed to write snapshot:", err.message);
  }
  */
}

function computeStats() {
  const symbols = Object.values(UniverseState.symbols || {});
  const stats = {
    totalSymbols: symbols.length,
    primeCount: 0,
    normalCount: 0,
    wildCount: 0,
    lastUniverseUpdateAt: new Date().toISOString(),
  };

  for (const meta of symbols) {
    if (meta.category === "Prime") stats.primeCount++;
    else if (meta.category === "Wild") stats.wildCount++;
    else stats.normalCount++;
  }

  UniverseState.stats = stats;
}

function pickCategory(symbol, isNewListing, primeSymbols, hasExistingSnapshot = false) {
  if (primeSymbols.includes(symbol)) return "Prime";

  // Wild samo ako je stvarno novi listing (i imamo postojeći snapshot za poređenje)
  if (isNewListing && hasExistingSnapshot) return "Wild";

  return "Normal";
}

// -------------------------------------------
// initUniverse – puni UniverseState iz Bybit REST-a
// -------------------------------------------
export async function initUniverse(options = {}) {
  const primeSymbols = options.primeSymbols || DEFAULT_PRIME_SYMBOLS;

  // Ako prvi put radimo, pokušaj da učitaš postojeći snapshot v2 (ako postoji)
  if (!UniverseState.fetchedAt) {
    await loadExistingUniverse();
  }

  console.log("🌍 [UNIVERSE] Fetching instruments from Bybit...");
  const result = await fetchInstrumentsUSDTPerp();

  if (!result || !result.success) {
    throw new Error("Universe init failed: fetchInstrumentsUSDTPerp() not successful");
  }

  const nowIso = new Date().toISOString();
  UniverseState.fetchedAt = result.fetchedAt || nowIso;

  const existingSymbols = UniverseState.symbols || {};
  const hasExistingSnapshot = Object.keys(existingSymbols).length > 0;
  const nextSymbols = { ...existingSymbols };

  for (const inst of result.symbols) {
    const symbol = inst.symbol;
    const prevMeta = existingSymbols[symbol];

    const firstSeenAt = prevMeta?.firstSeenAt || nowIso;
    const isNewListing = !prevMeta;

    nextSymbols[symbol] = {
      symbol,
      baseAsset: inst.baseAsset,
      quoteAsset: inst.quoteAsset,
      contractType: inst.contractType,
      status: inst.status,
      tickSize: inst.tickSize,
      minOrderQty: inst.minOrderQty,
      lotSize: inst.lotSize,
      maxLeverage: inst.maxLeverage,
      category: pickCategory(symbol, isNewListing, primeSymbols, hasExistingSnapshot),
      isNewListing,
      firstSeenAt,
      lastUpdatedAt: nowIso,
    };
  }

  UniverseState.symbols = nextSymbols;
  computeStats();
  await saveUniverseSnapshot();

  console.log(
    `🌍 [UNIVERSE] Snapshot updated → total=${UniverseState.stats.totalSymbols}, ` +
      `prime=${UniverseState.stats.primeCount}, normal=${UniverseState.stats.normalCount}, wild=${UniverseState.stats.wildCount}`
  );

  return getUniverseSnapshot();
}

// -------------------------------------------
// Getteri
// -------------------------------------------
export async function getUniverseSnapshot() {
  // Auto-load from disk if state is empty (for dashboard process)
  if (!UniverseState.fetchedAt || Object.keys(UniverseState.symbols || {}).length === 0) {
    await loadExistingUniverse();
  }

  // duboka kopija da niko spolja ne menja stanje
  return JSON.parse(JSON.stringify(UniverseState));
}

export function getSymbolMeta(symbol) {
  return UniverseState.symbols?.[symbol] || null;
}

export function getUniverseSymbols(filterActive = false) {
  const allSymbols = Object.keys(UniverseState.symbols || {});

  if (!filterActive) {
    return allSymbols;
  }

  // Filter out expired futures and low-activity symbols
  return allSymbols.filter(symbol => {
    // Skip expired/weekly futures contracts (e.g., BTCUSDT-28NOV25, DOGEUSDT-05DEC25)
    if (/-\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}$/.test(symbol)) {
      return false;
    }

    // Keep all perpetual and spot symbols
    return true;
  });
}

export async function getSymbolsByCategory(category) {
  // Ako je state prazan, pokušaj da učitaš postojeći snapshot
  if (!UniverseState.fetchedAt || Object.keys(UniverseState.symbols || {}).length === 0) {
    console.log("🌍 [UNIVERSE] State prazan, učitavam postojeći snapshot...");
    await loadExistingUniverse();
    console.log("🌍 [UNIVERSE] Nakon učitavanja - symbols:", Object.keys(UniverseState.symbols || {}).length);
  }

  const target = String(category || "").toLowerCase();

  // Special case for "All" - return all symbol metadata
  if (target === "all") {
    return Object.values(UniverseState.symbols || {});
  }

  const filtered = Object.values(UniverseState.symbols || {})
    .filter((meta) => meta.category && meta.category.toLowerCase() === target);

  console.log(`🌍 [UNIVERSE] Category '${category}' → found ${filtered.length} symbols`);
  return filtered;
}export function getUniverseStats() {
  return { ...UniverseState.stats };
}

export function getUniverseFilePath() {
  return UNIVERSE_FILE;
}

// -------------------------------------------
// Periodični refresh (za kasniju integraciju u engine)
// -------------------------------------------
export function refreshUniversePeriodically(options = {}) {
  const intervalMs = options.intervalMs || 15000;
  if (refreshTimer) clearInterval(refreshTimer);

  refreshTimer = setInterval(() => {
    initUniverse(options).catch((err) => {
      console.error("❌ [UNIVERSE] Periodic refresh failed:", err.message);
    });
  }, intervalMs);

  console.log(
    `⏱️ [UNIVERSE] Periodic refresh enabled (every ${intervalMs} ms, snapshot: ${UNIVERSE_FILE})`
  );
}
