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

// Kreiraj sessions direktorijum
const sessionsDir = path.join(paths.DATA_DIR, "sessions");
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  console.log("✅ Created sessions directory:", sessionsDir);
}

app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.db",
      dir: sessionsDir,
      table: "sessions",
      concurrentDB: true
    }),
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
  })
);


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
