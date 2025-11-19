// src/config/paths.js
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Absolute root of project (REAL PATH, NOT CWD)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// go two levels up: /scalper-base
const PROJECT_ROOT = path.resolve(__dirname, "../../");

// DIRECTORIES
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

// Ensure directories exist
[
  DATA_DIR, SYSTEM_DIR, LOG_DIR,
  PROFILES_DIR, TMP_DIR, CONFIG_DIR,
  ORDERBOOK_DIR, TRADES_DIR, METRICS_DIR
].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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
  CONFIG_FILE
};
