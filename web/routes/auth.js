import express from "express";
import { findUser } from "../auth/auth.js";
import bcrypt from "bcrypt";

const router = express.Router();

// GET /login
router.get("/login", (req, res) => {
  res.render("login", {
    error: null,
    title: "Login",
    user: null
  });
});

// POST /login
router.post("/login", async (req, res) => {
  const db = req.db;
  const { username, password } = req.body;

  const user = await findUser(db, username);
  if (!user) {
    return res.render("login", {
      error: "User not found",
      title: "Login",
      user: null
    });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.render("login", {
      error: "Invalid password",
      title: "Login",
      user: null
    });
  }

  req.session.user = {
    id: user.id,
    username: user.username
  };

  res.redirect("/");
});

// GET /logout
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

export default router;
