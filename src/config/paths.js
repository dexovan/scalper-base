// src/config/paths.js
import path from "path";
import fs from "fs";

const PROJECT_ROOT = path.resolve(process.cwd());
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const SYSTEM_DIR = path.join(DATA_DIR, "system");
const LOG_DIR = path.join(SYSTEM_DIR, "logs");
const PROFILES_DIR = path.join(DATA_DIR, "profiles");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const CONFIG_DIR = path.join(PROJECT_ROOT, "config");

// Additional directories for Phase 1 compliance
const ORDERBOOK_DIR = path.join(DATA_DIR, "orderbook");
const TRADES_DIR = path.join(DATA_DIR, "trades");
const METRICS_DIR = path.join(DATA_DIR, "metrics");
const CONFIG_FILE = path.join(CONFIG_DIR, "default.json");

// Helper to ensure directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Create required directories automatically
[DATA_DIR, SYSTEM_DIR, LOG_DIR, PROFILES_DIR, TMP_DIR, CONFIG_DIR, ORDERBOOK_DIR, TRADES_DIR, METRICS_DIR].forEach(ensureDir);

// Phase 1 compliant PATHS structure
export const PATHS = {
  data: {
    system: SYSTEM_DIR,
    orderbook: ORDERBOOK_DIR,
    trades: TRADES_DIR,
    metrics: METRICS_DIR,
    profiles: PROFILES_DIR
  },
  logs: LOG_DIR,
  config: CONFIG_FILE,
  tmp: TMP_DIR
};

// Individual exports for convenience
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
  PATHS
};
