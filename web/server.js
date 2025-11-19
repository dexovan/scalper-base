import express from "express";
import session from "express-session";
import path from "path";
import expressLayouts from "express-ejs-layouts";
import SQLiteStoreFactory from "connect-sqlite3";

import authRoutes from "./routes/auth.js";
import { requireAuth } from "./auth/middleware.js";
import { createDB } from "./auth/auth.js";

import apiRoutes from "./routes/api.js";
import paths from "../src/config/paths.js";
import { initHealth } from "../src/monitoring/health.js";


// =======================================
// 🔍 PATH TEST
// =======================================
console.log("\n🧪 FAZA 1 - PATHS TEST:");
console.log("ROOT:", paths.PROJECT_ROOT);
console.log("DATA:", paths.DATA_DIR);
console.log("SYSTEM:", paths.SYSTEM_DIR);
console.log("LOGS:", paths.LOG_DIR);
console.log("PROFILES:", paths.PROFILES_DIR);
console.log("TMP:", paths.TMP_DIR);

const isAbsolutePath = (p) => path.isAbsolute(p);
const hasFileProtocol = (p) => p.includes("file://");
const isRelativePath = (p) => p.startsWith("./") || p.startsWith("../");

console.log("\n✅ VALIDATION:");
console.log("✔ Absolute paths:", isAbsolutePath(paths.PROJECT_ROOT) && isAbsolutePath(paths.DATA_DIR));
console.log("✔ No file protocol:", !hasFileProtocol(paths.PROJECT_ROOT) && !hasFileProtocol(paths.DATA_DIR));
console.log("✔ No relative paths:", !isRelativePath(paths.PROJECT_ROOT) && !isRelativePath(paths.DATA_DIR));
console.log("✅ Paths test complete!\n");


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

// ❗ VRLO VAŽNO — NEMA NGINX PROXY → PROXY MORA BITI ISKLJUČEN!
app.set("trust proxy", false);


// =======================================
// 💾 SESSION STORAGE – SQLite
// =======================================
const SQLiteStore = SQLiteStoreFactory(session);

const SESSION_SECRET = "a909d8a1c1db4af6b0e3b4c8bbd9a514-super-strong-secret";

app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.db",
      dir: "./web/auth",
      table: "sessions",         // eksplicitno ime tabele
      concurrentDB: true         // bolje performanse
    }),
    secret: SESSION_SECRET,
    name: "connect.sid",          // standardno Express ime
    resave: false,
    saveUninitialized: false,
    rolling: true,               // obnovi cookie na svaki request
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 30 * 60 * 1000,    // 30 minuta umesto 7 dana za test
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
    sessionID: req.sessionID,
    hasSession: !!req.session,
    hasUser: !!req.session?.user,
    username: req.session?.user?.username,
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
