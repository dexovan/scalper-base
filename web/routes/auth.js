import express from "express";
import { createDB, findUser } from "../auth/auth.js";
import bcrypt from "bcrypt";

const router = express.Router();
const db = await createDB();

// GET /login
router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

// POST /login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await findUser(db, username);
  if (!user) {
    return res.render("login", { error: "User not found" });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.render("login", { error: "Invalid password" });
  }

  // session login
  req.session.user = { id: user.id, username: user.username };
  res.redirect("/");
});

// GET /logout
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

export default router;
