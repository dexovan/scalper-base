// =======================================
// server.js — PHASE 1 (refactored & stable)
// =======================================

import express from "express";
import session from "express-session";
import path, { join } from "path";
import fs from "fs";
import expressLayouts from "express-ejs-layouts";
import SQLiteStoreFactory from "connect-sqlite3";
import { fileURLToPath } from "url";

// ---------------------------------------
// PM2 HOOK FIX (ALWAYS KEEP AT TOP)
// ---------------------------------------
import Module from "module";
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (
    request.includes("express-session/session/store") ||
    request.includes("express-session/session/memory")
  ) {
    return originalLoad.apply(
      this,
      [
        "/home/aiuser/scalper-base/node_modules/express-session/session/store.js",
        parent,
        isMain
      ]
    );
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
  timeout: 20000
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
      maxAge: 30 * 60 * 1000
    }
  })
);

console.log("✅ SQLite session store active");

// ---------------------------------------
// DB INIT
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
    user: req.session?.user
  });
  next();
});

// =======================================
// ROUTES — CORRECT ORDER
// =======================================

// 1️⃣ API FIRST (NE SME DA BUDE IZNAD AUTH!!!)
app.use("/api/universe", universeAPI);
app.use("/api", apiRoutes);
app.use("/api/test", apiTest);

// 2️⃣ AUTH ROUTES
app.use(authRoutes);

// 3️⃣ DASHBOARD (PROTECTED)
app.get("/", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
    user: req.session.user.username,
    currentTime: new Date().toLocaleString(),
  });
});

// =======================================
// SERVER START
// =======================================
const server = app.listen(8080, "0.0.0.0", () => {
  console.log("🚀 Server running at http://0.0.0.0:8080");
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
