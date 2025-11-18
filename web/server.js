import express from "express";
import session from "express-session";
import authRoutes from "./routes/auth.js";
import { requireAuth } from "./auth/middleware.js";
import { createDB } from "./auth/auth.js";

const app = express();

// Initialize DB
const db = await createDB();

// Inject DB into all route handlers
app.use((req, res, next) => {
  req.db = db;
  next();
});

app.set("view engine", "ejs");
app.set("views", "./web/views");

app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

// Public auth routes
app.use(authRoutes);

// Protected dashboard route
app.get("/", requireAuth, (req, res) => {
  res.render("dashboard", {
    user: req.session.user.username,
    currentTime: new Date().toLocaleString(),
  });
});

// Run server
app.listen(8080, () => {
  console.log("🚀 Dashboard running at http://0.0.0.0:8080");
});
