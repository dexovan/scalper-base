import express from "express";
import session from "express-session";
import path, { join } from "path";
import fs from "fs";
import expressLayouts from "express-ejs-layouts";
import SQLiteStoreFactory from "connect-sqlite3";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import { requireAuth } from "./auth/middleware.js";
import { createDB } from "./auth/auth.js";

import apiRoutes from "./routes/api.js";
import paths from "../src/config/paths.js";
import { initHealth } from "../src/monitoring/health.js";


// =======================================
// 🔍 FIX: apsolutni path (kritično za PM2!)
// =======================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// =======================================
// 🔍 PATH TEST
// =======================================
console.log("\n🧪 FAZA 1 - PATHS TEST:");
console.log("SERVER FILE DIR:", __dirname);
console.log("AUTH DIR:", join(__dirname, "auth"));
console.log("ROOT:", paths.PROJECT_ROOT);
console.log("DATA:", paths.DATA_DIR);
console.log("TMP:", paths.TMP_DIR);

console.log("=======================================\n");


// =======================================
// 🚀 EXPRESS INIT
// =======================================
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Layout system
app.use(expressLayouts);
app.set("layout", "layout");

// Static & forms
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ❗ VRLO VAŽNO — NEMAMO NGINX PROXY
app.set("trust proxy", false);


// =======================================
// 💾 SESSION STORAGE – SQLite (apsolutni path FIX)
// =======================================
const SQLiteStore = SQLiteStoreFactory(session);
const SESSION_SECRET = "a909d8a1c1db4af6b0e3b4c8bbd9a514-super-strong-secret";

// Kreiraj sessions direktorijum sa fallback
let sessionsDir;
try {
  // Prvi pokušaj: data/sessions
  sessionsDir = path.join(paths.DATA_DIR, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o755 });
  }
  // Test write permissions
  const testFile = path.join(sessionsDir, 'test.tmp');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log("✅ Sessions directory OK:", sessionsDir);
} catch (error) {
  // Fallback: web/auth directory
  console.warn("⚠️ Cannot use data/sessions, fallback to web/auth:", error.message);
  sessionsDir = path.join(__dirname, "auth");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o755 });
  }
  console.log("✅ Fallback sessions directory:", sessionsDir);
}

// Cleanup stare session fajlove if they exist
try {
  const oldSessionFiles = [
    path.join(paths.PROJECT_ROOT, "sessions.db"),
    path.join(__dirname, "sessions.db"),
    path.join(__dirname, "auth", "sessions.db")
  ];

  oldSessionFiles.forEach(file => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log("🧹 Cleaned old session file:", file);
    }
  });
} catch (error) {
  console.warn("⚠️ Could not clean old sessions:", error.message);
}

// Session configuration with SQLite store + fallback
let sessionConfig = {
  secret: SESSION_SECRET,
  name: "connect.sid",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 30 * 60 * 1000,
  },
};

// Explicit SQLite database initialization
const dbPath = path.join(sessionsDir, "sessions.db");
console.log("🔍 SQLite path:", dbPath);

// Ensure database file can be created
try {
  // Create empty database if it doesn't exist
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, "");
    console.log("📝 Created SQLite database file");
  }

  // Test write permissions
  fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
  console.log("✅ SQLite file permissions OK");

} catch (error) {
  console.error("❌ SQLite file access failed:", error.message);
  throw new Error(`Cannot access SQLite database: ${error.message}`);
}

// Initialize SQLite store
const sqliteStore = new SQLiteStore({
  db: "sessions.db",
  dir: sessionsDir,
  table: "sessions",
  concurrentDB: true,
  timeout: 20000
});

// Handle SQLite store events
sqliteStore.on('error', (err) => {
  console.error('❌ SQLite Store Error:', err);
});

sqliteStore.on('connect', () => {
  console.log('✅ SQLite Store Connected');
});

sessionConfig.store = sqliteStore;
console.log("✅ Using SQLite session store at:", dbPath);

app.use(session(sessionConfig));


// =======================================
// 🗄️ DB INIT + INJECTION
// =======================================
const db = await createDB();

app.use((req, res, next) => {
  req.db = db;
  next();
});


// =======================================
// ❤️ HEALTH SYSTEM
// =======================================
initHealth();
console.log("✅ Phase 1 Health Monitoring initialized!\n");


// =======================================
// 🔍 SESSION DEBUG MIDDLEWARE
// =======================================
app.use((req, res, next) => {
  console.log("🔍 SESSION DEBUG:", {
    sid: req.sessionID,
    hasSession: !!req.session,
    user: req.session?.user,
    cookie: req.session?.cookie
  });
  next();
});


// =======================================
// 🔐 ROUTES
// =======================================
app.use(authRoutes);
app.use("/api", apiRoutes);


// =======================================
// 📊 DASHBOARD
// =======================================
app.get("/", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
    user: req.session.user.username,
    currentTime: new Date().toLocaleString(),
  });
});


// =======================================
// ERROR HANDLING
// =======================================
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// =======================================
// SERVER START
// =======================================
const server = app.listen(8080, '0.0.0.0', () => {
  console.log("🚀 PHASE 1 Server running at http://0.0.0.0:8080");
  console.log("🏥 Health API: http://0.0.0.0:8080/api/health");
  console.log("📁 Sessions dir:", sessionsDir);
  console.log("📁 Views dir:", path.join(__dirname, "views"));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});
