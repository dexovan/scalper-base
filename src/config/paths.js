// src/config/paths.js
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// -------------------------------------------------------
// ABSOLUTE PROJECT ROOT
// -------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// /home/aiuser/scalper-base
const PROJECT_ROOT = path.resolve(__dirname, "../../");

// -------------------------------------------------------
// DIRECTORIES
// -------------------------------------------------------
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const SYSTEM_DIR = path.join(DATA_DIR, "system");
const LOG_DIR = path.join(SYSTEM_DIR, "logs");
const PROFILES_DIR = path.join(DATA_DIR, "profiles");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const CONFIG_DIR = path.join(PROJECT_ROOT, "config");

const ORDERBOOK_DIR = path.join(DATA_DIR, "orderbook");
const TRADES_DIR = path.join(DATA_DIR, "trades");
const METRICS_DIR = path.join(DATA_DIR, "metrics");

const CONFIG_FILE = path.join(CONFIG_DIR, "default.json");

// -------------------------------------------------------
// UNIVERSE FILE (CRUCIAL!)
// -------------------------------------------------------
const UNIVERSE_FILE = path.join(SYSTEM_DIR, "universe.json");

// -------------------------------------------------------
// CREATE DIRECTORIES IF MISSING
// -------------------------------------------------------
[
  DATA_DIR,
  SYSTEM_DIR,
  LOG_DIR,
  PROFILES_DIR,
  TMP_DIR,
  CONFIG_DIR,
  ORDERBOOK_DIR,
  TRADES_DIR,
  METRICS_DIR
].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// -------------------------------------------------------
// EXPORT
// -------------------------------------------------------
export default {
  PROJECT_ROOT,
  DATA_DIR,
  SYSTEM_DIR,
  LOG_DIR,
  PROFILES_DIR,
  TMP_DIR,
  CONFIG_DIR,
  ORDERBOOK_DIR,
  TRADES_DIR,
  METRICS_DIR,
  CONFIG_FILE,
  UNIVERSE_FILE
};
