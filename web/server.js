// =======================================
// server.js — PHASE 1 (refactored & stable)
// =======================================

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import session from "express-session";
import path from "path";
import fs from "fs";
import expressLayouts from "express-ejs-layouts";
import SQLiteStoreFactory from "connect-sqlite3";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";

import Module from "module"; // PM2 fix

// ---------------------------------------
// PM2 HOOK FIX (ALWAYS KEEP AT TOP)
// ---------------------------------------
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (
    request.includes("express-session/session/store") ||
    request.includes("express-session/session/memory")
  ) {
    return originalLoad.apply(this, [
      "/home/aiuser/scalper-base/node_modules/express-session/session/store.js",
      parent,
      isMain,
    ]);
  }
  return originalLoad.apply(this, arguments);
};

// ---------------------------------------
// IGNORE SQLITE_CANTOPEN SPAM
// ---------------------------------------
const origErr = console.error;
console.error = (...args) => {
  const msg = args.join(" ");
  if (msg.includes("SQLITE_CANTOPEN")) return;
  origErr.apply(console, args);
};

// ---------------------------------------
// IMPORTS (LOCAL MODULES)
// ---------------------------------------
import authRoutes from "./routes/auth.js";
import { requireAuth } from "./auth/middleware.js";
import { createDB } from "./auth/auth.js";

import apiRoutes from "./routes/api.js";
import universeAPI from "./routes/api-universe.js";
import apiTest from "./routes/api-test.js";
import apiFeaturesRoutes from "./routes/api-features.js";

import paths from "../src/config/paths.js";
import { initHealth } from "../src/monitoring/health.js";

// ---------------------------------------
// PATHS INIT
// ---------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("\n🧪 PATH DEBUG");
console.log("SERVER FILE DIR:", __dirname);
console.log("ROOT:", paths.PROJECT_ROOT);
console.log("DATA:", paths.DATA_DIR);
console.log("TMP:", paths.TMP_DIR);
console.log("=======================================\n");

// ---------------------------------------
// EXPRESS INIT
// ---------------------------------------
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(expressLayouts);
app.set("layout", "layout");

// Ignore favicon requests to prevent 404 errors in console
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Prevent browser caching Dashboard API data
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});

app.set("trust proxy", false);

// ---------------------------------------
// SESSION STORAGE (SQLite)
// ---------------------------------------
const SQLiteStore = SQLiteStoreFactory(session);
const SESSION_SECRET = "a909d8a1c1db4af6b0e3b4c8bbd9a514-secret";

const sessionsDir = path.join(paths.DATA_DIR, "sessions");
fs.mkdirSync(sessionsDir, { recursive: true });

const dbPath = path.join(sessionsDir, "sessions.db");
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, "");

console.log("🔍 SQLite path:", dbPath);

const sqliteStore = new SQLiteStore({
  db: "sessions.db",
  dir: sessionsDir,
  table: "sessions",
  concurrentDB: true,
  timeout: 20000,
});

sqliteStore.on("error", (err) => {
  console.error("❌ SQLite Store Error:", err);
});

app.use(
  session({
    secret: SESSION_SECRET,
    name: "connect.sid",
    saveUninitialized: false,
    resave: false,
    rolling: true,
    store: sqliteStore,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 30 * 60 * 1000,
    },
  })
);

console.log("✅ SQLite session store active");

// ---------------------------------------
// GLOBAL VIEW VARIABLES (IMPORTANT)
// ---------------------------------------
app.use((req, res, next) => {
  res.locals.user = req.session?.user?.username || null;
  next();
});

// ---------------------------------------
// REQUEST LOGGING (DEBUG)
// ---------------------------------------
app.use((req, res, next) => {
  if (req.path.startsWith('/api/regime')) {
    console.log(`🔍 [REQUEST] ${req.method} ${req.originalUrl} (matched /api/regime)`);
  }
  next();
});

// ===========================================
// PROXY → REGIME ENGINE API (port 8090)
// CRITICAL: Must be FIRST, before ANY other /api routes!
// ===========================================

const regimeProxy = createProxyMiddleware({
  target: "http://localhost:8090",
  changeOrigin: true,
  timeout: 30000,
  proxyTimeout: 30000,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[PROXY-REGIME] ${req.method} ${req.originalUrl} → http://localhost:8090${req.path}`);

    // Fix POST body forwarding
    if (req.body && req.method === 'POST') {
      const bodyData = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
      console.log('[PROXY-REGIME] Forwarding body:', bodyData);
      proxyReq.write(bodyData);
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[PROXY-REGIME] Response: ${proxyRes.statusCode}`);
  },
  onError: (err, req, res) => {
    console.error('[PROXY-REGIME] Error:', err.message);
    res.status(503).json({ ok: false, error: 'Regime Engine unavailable' });
  }
});

// Manual forwarding for POST /api/regime/check-trade (proxy doesn't handle POST body well)
app.post("/api/regime/check-trade", async (req, res) => {
  try {
    console.log(`[REGIME-FORWARD] POST /api/regime/check-trade`, req.body);

    const response = await fetch("http://localhost:8090/api/regime/check-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    console.log(`[REGIME-FORWARD] Response:`, response.status, data);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[REGIME-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'Regime Engine unavailable' });
  }
});

app.get("/api/regime/overview", regimeProxy);
app.get("/api/regime/global", regimeProxy);
app.get("/api/regime/:symbol", regimeProxy);

// ===========================================
// MANUAL FORWARDING → SCORING ENGINE API (port 8090)
// Using fetch() for reliable query parameter forwarding
// ===========================================

app.get("/api/scanner/hotlist", async (req, res) => {
  try {
    const queryString = new URLSearchParams(req.query).toString();
    const url = `http://localhost:8090/api/scanner/hotlist${queryString ? '?' + queryString : ''}`;
    console.log(`[SCORING-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[SCORING-FORWARD] Response: ${response.status}, count: ${data.count || 0}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[SCORING-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'Scoring Engine unavailable' });
  }
});

app.get("/api/scoring/stats", async (req, res) => {
  try {
    const url = `http://localhost:8090/api/scoring/stats`;
    console.log(`[SCORING-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[SCORING-FORWARD] Response: ${response.status}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[SCORING-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'Scoring Engine unavailable' });
  }
});

// ===========================================
// STATE MACHINE API FORWARDING (port 8090) - PHASE 7
// ===========================================

app.get("/api/engine/states/overview", async (req, res) => {
  try {
    const url = `http://localhost:8090/api/states/overview`;
    console.log(`[STATE-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[STATE-FORWARD] Response: ${response.status}, symbols: ${data.summary?.totalSymbols || 0}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[STATE-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'State Machine unavailable' });
  }
});

app.get("/api/engine/symbol/:symbol/state", async (req, res) => {
  try {
    const { symbol } = req.params;
    const url = `http://localhost:8090/api/symbol/${symbol}/state`;
    console.log(`[STATE-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[STATE-FORWARD] Response: ${response.status}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[STATE-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'State Machine unavailable' });
  }
});

app.get("/api/engine/symbol/:symbol/events", async (req, res) => {
  try {
    const { symbol } = req.params;
    const queryString = new URLSearchParams(req.query).toString();
    const url = `http://localhost:8090/api/symbol/${symbol}/events${queryString ? '?' + queryString : ''}`;
    console.log(`[STATE-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[STATE-FORWARD] Response: ${response.status}, events: ${data.count || 0}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[STATE-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'State Machine unavailable' });
  }
});

// ===========================================
// RISK ENGINE API FORWARDING (port 8090) - PHASE 8
// ===========================================

app.get("/api/engine/risk/overview", async (req, res) => {
  try {
    const url = `http://localhost:8090/api/risk/overview`;
    console.log(`[RISK-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[RISK-FORWARD] Response: ${response.status}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[RISK-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'Risk Engine unavailable' });
  }
});

app.get("/api/engine/risk/limits", async (req, res) => {
  try {
    const url = `http://localhost:8090/api/risk/limits`;
    console.log(`[RISK-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[RISK-FORWARD] Response: ${response.status}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[RISK-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'Risk Engine unavailable' });
  }
});

app.get("/api/engine/positions", async (req, res) => {
  try {
    const url = `http://localhost:8090/api/positions`;
    console.log(`[RISK-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[RISK-FORWARD] Response: ${response.status}, positions: ${data.count || 0}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[RISK-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'Risk Engine unavailable' });
  }
});

app.get("/api/engine/positions/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const url = `http://localhost:8090/api/positions/${symbol}`;
    console.log(`[RISK-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[RISK-FORWARD] Response: ${response.status}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[RISK-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'Risk Engine unavailable' });
  }
});

// ===========================================
// TP/SL ENGINE API FORWARDING (port 8090) - PHASE 9
// ===========================================

app.get("/api/engine/tpsl/overview", async (req, res) => {
  try {
    const url = `http://localhost:8090/api/tpsl/overview`;
    console.log(`[TPSL-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[TPSL-FORWARD] Response: ${response.status}, count: ${data.count || 0}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[TPSL-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'TP/SL Engine unavailable' });
  }
});

app.get("/api/engine/tpsl/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const queryString = new URLSearchParams(req.query).toString();
    const url = `http://localhost:8090/api/tpsl/${symbol}${queryString ? '?' + queryString : ''}`;
    console.log(`[TPSL-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[TPSL-FORWARD] Response: ${response.status}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[TPSL-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'TP/SL Engine unavailable' });
  }
});

app.get("/api/engine/positions/enhanced", async (req, res) => {
  try {
    const url = `http://localhost:8090/api/positions/enhanced`;
    console.log(`[TPSL-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[TPSL-FORWARD] Response: ${response.status}, positions: ${data.count || 0}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[TPSL-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'TP/SL Engine unavailable' });
  }
});

app.get("/api/symbol/:symbol/score", async (req, res) => {
  try {
    const { symbol } = req.params;
    const url = `http://localhost:8090/api/symbol/${symbol}/score`;
    console.log(`[SCORING-FORWARD] GET ${req.originalUrl} → ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();
    console.log(`[SCORING-FORWARD] Response: ${response.status}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[SCORING-FORWARD] Error:', error.message);
    res.status(503).json({ ok: false, error: 'Scoring Engine unavailable' });
  }
});

// ---------------------------------------
// DB INIT (ATTACH DB TO REQ)
// ---------------------------------------
const db = await createDB();
app.use((req, res, next) => {
  req.db = db;
  next();
});

// ---------------------------------------
// HEALTH MONITOR
// ---------------------------------------
initHealth();
console.log("✅ Health Monitoring initialized");

// ---------------------------------------
// SESSION DEBUG (OPTIONAL)
// ---------------------------------------
app.use((req, res, next) => {
  console.log("🔍 SESSION:", {
    sid: req.sessionID,
    user: req.session?.user,
  });
  next();
});

// =======================================
// ROUTES — CORRECT ORDER
// =======================================

// ===========================================
// PROXY → MONITOR API (port 8090)
// ===========================================
app.use(
  "/monitor/api",
  createProxyMiddleware({
    target: "http://localhost:8090/api/monitor",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    pathRewrite: {
      "^/monitor/api": "/api/monitor"
    }
  })
);

// ===========================================
// PROXY → MICROSTRUCTURE API (port 8090)
// ===========================================
app.use(
  "/api/microstructure",
  createProxyMiddleware({
    target: "http://localhost:8090/api/microstructure",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    pathRewrite: {
      "^/api/microstructure": ""
    }
  })
);

app.use(
  "/api/symbol",
  (req, res, next) => {
    console.log(`🔀 [PROXY] Incoming request: ${req.method} ${req.url}`);
    next();
  },
  createProxyMiddleware({
    target: "http://localhost:8090",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    pathRewrite: {
      "^/": "/api/symbol/" // Add back the /api/symbol prefix that Express stripped
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`🔀 [PROXY] Forwarding to Engine: ${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`🔀 [PROXY] Engine responded: ${proxyRes.statusCode}`);
    },
    onError: (err, req, res) => {
      console.error(`🔀 [PROXY] Error:`, err.message);
    }
  })
);

app.use(
  "/api/health",
  createProxyMiddleware({
    target: "http://localhost:8090/api/microstructure/health",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    pathRewrite: {
      "^/api/health": ""
    }
  })
);

// ===========================================
// PROXY → FEATURE ENGINE API (port 8090)
// ===========================================
app.use(
  "/api/features",
  createProxyMiddleware({
    target: "http://localhost:8090/api/features",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    pathRewrite: {
      "^/api/features": ""
    }
  })
);

// ===========================================
// PROXY → DIAGNOSTICS API (port 8090)
// ===========================================
app.use(
  "/api/diagnostics",
  createProxyMiddleware({
    target: "http://localhost:8090/api/diagnostics",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    pathRewrite: {
      "^/api/diagnostics": ""
    }
  })
);

// ===========================================
// PROXY → EXECUTION ENGINE API (port 8090) - FAZA 10
// ===========================================
app.use(
  "/api/engine/execution",
  createProxyMiddleware({
    target: "http://localhost:8090/api/execution",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    pathRewrite: {
      "^/api/engine/execution": ""
    }
  })
);

// 1️⃣ LOGIN PAGE — must be BEFORE authRoutes
app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { title: "Login", error: null, hideChrome: true });
});

// 2️⃣ API ROUTES (public)
app.use("/api/universe", universeAPI);
app.use("/api/features", apiFeaturesRoutes);
app.use("/api/test", apiTest);

// ===========================================
// PROXY → MANUAL TRADE API (port 8090)
// MUST BE BEFORE app.use("/api", apiRoutes) to take precedence!
// ===========================================
// Add explicit middleware to log manual-trade requests
app.post("/api/manual-trade", (req, res, next) => {
  console.log("\n\n🔴🔴🔴 [MANUAL-TRADE] POST request received! 🔴🔴🔴");
  console.log("   Content-Type:", req.get("content-type"));
  console.log("   Body:", JSON.stringify(req.body));
  console.log("   Passing to next middleware...");
  next();
});

app.use(
  "/api/manual-trade",
  (req, res, next) => {
    console.log("\n🟢 [MANUAL-TRADE] Before proxy middleware");
    console.log("   URL:", req.url);
    console.log("   Method:", req.method);
    next();
  },
  createProxyMiddleware({
    target: "http://localhost:8090",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    logLevel: "debug",
    onError: (err, req, res) => {
      console.error("\n❌ [PROXY ERROR] /api/manual-trade:", err.message);
      console.error("   Code:", err.code);
      console.error("   Stack:", err.stack);
      res.status(502).json({
        ok: false,
        error: "Proxy error: " + err.message,
        code: err.code,
        timestamp: new Date().toISOString()
      });
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`\n✅ [PROXY] /api/manual-trade response received: ${proxyRes.statusCode}`);
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`\n🟡 [PROXY] Forwarding to backend at http://localhost:8090${req.url}`);
      console.log("   Method:", req.method);
      console.log("   Body length:", req.body ? JSON.stringify(req.body).length : 0);
      // Ensure content-type is preserved
      proxyReq.setHeader("Content-Type", "application/json");
    }
  })
);

// Generic API routes (catches /api/* after specific routes)
app.use("/api", apiRoutes);

// 3️⃣ AUTH ROUTES (login, logout, register)
app.use(authRoutes);

// 4️⃣ DASHBOARD (PROTECTED)
app.get("/", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
    currentTime: new Date().toLocaleString(),
  });
});

// Dashboard alias for tests and direct access
app.get("/dashboard", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
    currentTime: new Date().toLocaleString(),
  });
});

// Markets overview page
app.get("/markets", requireAuth, (req, res) => {
  res.render("markets", {
    title: "Markets",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// 5️⃣ SYSTEM MONITOR PAGE (PROTECTED)
app.get("/monitor", requireAuth, (req, res) => {
  res.render("monitor", {
    title: "Monitor",
  });
});

// 6️⃣ MICROSTRUCTURE MONITOR PAGE (FAZA 3)
app.get("/monitor-micro", requireAuth, (req, res) => {
  res.render("monitor-micro", {
    title: "Microstructure Monitor",
    currentTime: new Date().toLocaleString(),
  });
});

// 7️⃣ REGIME MONITOR PAGE (FAZA 5)
app.get("/regime-monitor", requireAuth, (req, res) => {
  res.render("regime-monitor", {
    title: "Regime Monitor",
    currentTime: new Date().toLocaleString(),
  });
});

// 8️⃣ SCANNER PAGE (FAZA 6)
app.get("/scanner", requireAuth, (req, res) => {
  res.render("scanner", {
    title: "Signal Scanner",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// 8️⃣a SCALP SCANNER PAGE (NEW)
app.get("/scalp-scanner", requireAuth, (req, res) => {
  res.render("scalp-scanner", {
    title: "Scalp Scanner",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// 9️⃣ STATE MACHINE MONITOR PAGE (FAZA 7)
app.get("/states", requireAuth, (req, res) => {
  res.render("states", {
    title: "State Machine Monitor",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// 🔟 RISK MONITOR PAGE (FAZA 8)
app.get("/risk", requireAuth, (req, res) => {
  res.render("risk", {
    title: "Risk Monitor",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// 1️⃣1️⃣ POSITIONS PAGE (FAZA 9) - TP/SL Visualization
app.get("/positions", requireAuth, (req, res) => {
  res.render("positions", {
    title: "Positions & TP/SL",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// 1️⃣2️⃣ EXECUTION PAGE (FAZA 10) - Order Management & Panic Controls
app.get("/execution", (req, res) => {
  res.render("execution", {
    title: "Execution Engine",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// 1️⃣3️⃣ FEATURE ENGINE PAGE (FAZA 4)
app.get("/features", requireAuth, (req, res) => {
  res.render("features", {
    title: "Feature Engine",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// 🔟 DIAGNOSTICS PAGE (SYSTEM HEALTH)
app.get("/diagnostics", requireAuth, (req, res) => {
  res.render("diagnostics", {
    title: "System Diagnostics",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// =======================================
// SERVER START
// =======================================
const PORT = 8080;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
  console.log("📁 Sessions dir:", sessionsDir);
  console.log("📁 Views dir:", path.join(__dirname, "views"));

  // DEBUG: Log registered routes/proxies
  console.log("\n🔗 REGISTERED API PROXIES:");
  console.log("  ✅ /api/manual-trade → http://localhost:8090/api/manual-trade");
  console.log("  ✅ /api/features → http://localhost:8090/api/features");
  console.log("  ✅ /api/diagnostics → http://localhost:8090/api/diagnostics");
  console.log("  ✅ /api/engine/execution → http://localhost:8090/api/execution");
  console.log("  ✅ /api/microstructure → http://localhost:8090/api/microstructure");
  console.log("  ✅ /api/symbol → http://localhost:8090");
  console.log("");
});

// ===========================================================
// WEBSOCKET SERVER – sends live engine logs to dashboard
// ===========================================================
const io = new SocketIOServer(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("🔌 Dashboard connected (WS)");

  // Engine status broadcasts (these come from monitor API)
  socket.emit("engine-status", "up");
});

// This is called by monitor backend via file watcher or API
export function pushEngineLog(line) {
  io.emit("engine-log", line);
}

export function pushEngineStatus(status) {
  io.emit("engine-status", status);
}

// ---------------------------------------
// GRACEFUL SHUTDOWN
// ---------------------------------------
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
    process.exit(0);
  });
});
