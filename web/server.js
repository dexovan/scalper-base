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
      "^/monitor/api": ""
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
// PROXY → REGIME ENGINE API (port 8090)
// ORDER MATTERS: Specific routes BEFORE parameterized routes!
// ===========================================

// Generic regime endpoints (e.g., /api/regime/overview, /api/regime/global)
app.use(
  "/api/regime",
  createProxyMiddleware({
    target: "http://localhost:8090",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    onProxyReq: (proxyReq, req, res) => {
      console.log(`[PROXY] ${req.method} ${req.path} → http://localhost:8090${req.path}`);
    }
  })
);

// Symbol-specific regime endpoint (e.g., /api/regime/BTCUSDT)
// This must come AFTER /api/regime to avoid catching /overview etc.
app.use(
  "/api/regime/:symbol",
  createProxyMiddleware({
    target: "http://localhost:8090",
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    pathRewrite: (path, req) => {
      // /api/regime/BTCUSDT -> /api/symbol/BTCUSDT/regime
      const symbol = req.params.symbol;
      return `/api/symbol/${symbol}/regime`;
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
app.use("/api", apiRoutes);
app.use("/api/test", apiTest);

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

// 7️⃣ FEATURE ENGINE PAGE (FAZA 4)
app.get("/features", requireAuth, (req, res) => {
  res.render("features", {
    title: "Feature Engine",
    user: req.user?.username || "trader",
    currentTime: new Date().toLocaleString(),
  });
});

// 8️⃣ DIAGNOSTICS PAGE (SYSTEM HEALTH)
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
});

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
