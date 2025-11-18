import express from "express";
import session from "express-session";
import path from "path";

import authRoutes from "./routes/auth.js";
import { requireAuth } from "../src/auth/middleware.js";
import { createDB } from "../src/auth/auth.js";

import apiRoutes from "./routes/api.js";
import paths from "../src/config/paths.js";
import { initHealth } from "../src/monitoring/health.js";

// =======================================
// 🔍 FAZA 1 – PATHS TEST
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
app.use(express.static("./web/public"));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "your-secret",
    resave: false,
    saveUninitialized: false,
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
// 🔐 ROUTES
// =======================================

app.use(authRoutes);

app.use("/api", apiRoutes);

app.get("/", requireAuth, (req, res) => {
  res.send("Dashboard logged in as " + req.session.user.username);
});

// =======================================
// SERVER START
// =======================================
app.listen(8080, () => {
  console.log("Dashboard running at http://0.0.0.0:8080");
});
