import express from "express";
import session from "express-session";
import path, { join } from "path";
import fs from "fs";
import expressLayouts from "express-ejs-layouts";
import SQLiteStoreFactory from "connect-sqlite3";
import { fileURLToPath } from "url";

// =======================================
// 📌 PM2 REQUIRE HOOK FIX — PREVENT MODULE_NOT_FOUND
// =======================================
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

// =======================================
// 🔇 IGNORE SQLITE_CANTOPEN NOISE
// =======================================
const origErr = console.error;
console.error = (...args) => {
  const msg = args.join(" ");
  if (msg.includes("SQLITE_CANTOPEN")) return;
  origErr.apply(console, args);
};

// =======================================
import authRoutes from "./routes/auth.js";
import { requireAuth } from "./auth/middleware.js";
import { createDB } from "./auth/auth.js";

import apiRoutes from "./routes/api.js";
import universeAPI from "./routes/api-universe.js";
import paths from "../src/config/paths.js";
import { initHealth } from "../src/monitoring/health.js";

// =======================================
// PATH INIT
// =======================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("\n🧪 FAZA 1 - PATHS TEST:");
console.log("SERVER FILE DIR:", __dirname);
console.log("AUTH DIR:", join(__dirname, "auth"));
console.log("ROOT:", paths.PROJECT_ROOT);
console.log("DATA:", paths.DATA_DIR);
console.log("TMP:", paths.TMP_DIR);
console.log("=======================================\n");

// =======================================
// EXPRESS INIT
// =======================================
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("trust proxy", false);

// =======================================
// SESSION STORAGE (SQLite with PM2-safe path)
// =======================================
const SQLiteStore = SQLiteStoreFactory(session);
const SESSION_SECRET = "a909d8a1c1db4af6b0e3b4c8bbd9a514-super-strong-secret";

// ensure sessions directory exists
const sessionsDir = path.join(paths.DATA_DIR, "sessions");
fs.mkdirSync(sessionsDir, { recursive: true });

const dbPath = path.join(sessionsDir, "sessions.db");
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, "");

console.log("🔍 SQLite path:", dbPath);

// configure SQLite session store
const sqliteStore = new SQLiteStore({
  db: "sessions.db",
  dir: sessionsDir,
  table: "sessions",
  concurrentDB: true,
  timeout: 20000
});

// SQLite errors (only real ones)
sqliteStore.on("error", (err) => {
  console.error("❌ SQLite Store Error:", err);
});

// session config
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

console.log("✅ Using SQLite session store:", dbPath);

// =======================================
// DB INIT
// =======================================
const db = await createDB();
app.use((req, res, next) => {
  req.db = db;
  next();
});

// =======================================
// HEALTH MONITOR
// =======================================
initHealth();
console.log("✅ Phase 1 Health Monitoring initialized!\n");

// =======================================
// SESSION DEBUG
// =======================================
app.use((req, res, next) => {
  console.log("🔍 SESSION DEBUG:", {
    sid: req.sessionID,
    user: req.session?.user,
    cookie: req.session?.cookie
  });
  next();
});

// =======================================
// ROUTES
// =======================================
app.use(authRoutes);
app.use("/api", apiRoutes);
app.use("/api/universe", universeAPI);

// =======================================
// DASHBOARD
// =======================================
app.get("/", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
    user: req.session.user.username,
    currentTime: new Date().toLocaleString(),
  });
});

// =======================================
// SERVER
// =======================================
const server = app.listen(8080, "0.0.0.0", () => {
  console.log("🚀 PHASE 1 Server running at http://0.0.0.0:8080");
  console.log("📁 Sessions dir:", sessionsDir);
  console.log("📁 Views dir:", path.join(__dirname, "views"));
});

// graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
    process.exit(0);
  });
});
