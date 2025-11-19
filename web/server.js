import express from "express";
import session from "express-session";
import path, { join } from "path";
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
app.set("views", "./web/views");

// Layout system
app.use(expressLayouts);
app.set("layout", "layout");

// Static & forms
app.use(express.static("./web/public"));
app.use(express.urlencoded({ extended: true }));

// ❗ VRLO VAŽNO — NEMAMO NGINX PROXY
app.set("trust proxy", false);


// =======================================
// 💾 SESSION STORAGE – SQLite (apsolutni path FIX)
// =======================================
const SQLiteStore = SQLiteStoreFactory(session);

const SESSION_SECRET = "a909d8a1c1db4af6b0e3b4c8bbd9a514-super-strong-secret";

app.use(
  session({
    store: new SQLiteStore({
  db: "sessions.db",
  dir: "./web/auth"
}),
    secret: SESSION_SECRET,
    name: "sid",
    resave: false,
    saveUninitialized: false,
    rolling: true, // produžava sesiju na svaki request
    cookie: {
      httpOnly: true,
      secure: false,   // IP + HTTP → mora biti false
      sameSite: "lax",
      maxAge: 30 * 60 * 1000 // 30 min
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
// SERVER START
// =======================================
app.listen(8080, () => {
  console.log("Dashboard running at http://0.0.0.0:8080");
});
