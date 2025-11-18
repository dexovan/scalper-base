import express from "express";
import session from "express-session";
import path from "path";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import { requireAuth } from "./auth/middleware.js";
import { createDB } from "./auth/auth.js";
import paths from "../src/config/paths.js";
import { initHealth } from "../src/monitoring/health.js";

const app = express();

// ✅ TEST 1 - Paths Test (FAZA 1)
console.log("\n🧪 FAZA 1 - PATHS TEST:");
console.log("ROOT:", paths.PROJECT_ROOT);
console.log("DATA:", paths.DATA_DIR);
console.log("SYSTEM:", paths.SYSTEM_DIR);
console.log("LOGS:", paths.LOG_DIR);
console.log("PROFILES:", paths.PROFILES_DIR);
console.log("TMP:", paths.TMP_DIR);

// Validation checks
const isAbsolutePath = (p) => path.isAbsolute(p);
const hasFileProtocol = (p) => p.includes("file://");
const isRelativePath = (p) => p.startsWith("./") || p.startsWith("../");

console.log("\n✅ VALIDATION:");
console.log("✔ Absolute paths:", isAbsolutePath(paths.PROJECT_ROOT) && isAbsolutePath(paths.DATA_DIR));
console.log("✔ No file protocol:", !hasFileProtocol(paths.PROJECT_ROOT) && !hasFileProtocol(paths.DATA_DIR));
console.log("✔ No relative paths:", !isRelativePath(paths.PROJECT_ROOT) && !isRelativePath(paths.DATA_DIR));
console.log("✅ Paths test complete!\n");

// Express setup
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

// Initialize DB
const db = await createDB();

// Initialize Health Monitoring (FAZA 1)
initHealth();

// Routes
app.use(authRoutes);
app.use("/api", apiRoutes);

// Protected dashboard
app.get("/", requireAuth, (req, res) => {
  res.send("✅ PHASE 1 Dashboard - logged in as " + req.session.user.username);
});

app.listen(8080, () => {
  console.log("🚀 PHASE 1 Server running at http://0.0.0.0:8080");
  console.log("🏥 Health API: http://0.0.0.0:8080/api/health");
});
