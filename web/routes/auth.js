// =======================================================
// web/routes/auth.js (REFORMAT + HARDENED VERSION)
// =======================================================

import express from "express";
import bcrypt from "bcrypt";
import { findUser } from "../auth/auth.js";

const router = express.Router();

/* -------------------------------------------------------
   GET /login  → prikazuje login formu
------------------------------------------------------- */
router.get("/login", (req, res) => {
  // Ako je već ulogovan → šaljemo ga na dashboard
  if (req.session?.user) {
    return res.redirect("/");
  }

  res.render("login", {
    title: "Login",
    error: null
  });
});

/* -------------------------------------------------------
   POST /login  → obrada logovanja
------------------------------------------------------- */
router.post("/login", async (req, res) => {
  try {
    const db = req.db;
    const { username, password } = req.body;

    // 1) Validacija inputa
    if (!username || !password) {
      return res.render("login", {
        title: "Login",
        error: "Username i password su obavezni."
      });
    }

    // 2) Provera da li korisnik postoji
    const user = await findUser(db, username);
    if (!user) {
      return res.render("login", {
        title: "Login",
        error: "Pogrešan username ili password."
      });
    }

    // 3) Provera passworda
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.render("login", {
        title: "Login",
        error: "Pogrešan username ili password."
      });
    }

    // 4) Upis u session
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role || "user",
      loginAt: Date.now()
    };

    // 5) Redirect na dashboard
    return res.redirect("/");

  } catch (err) {
    console.error("❌ LOGIN ERROR:", err);

    return res.render("login", {
      title: "Login",
      error: "Neočekivana greška na serveru."
    });
  }
});

/* -------------------------------------------------------
   GET /logout → briše sesiju
------------------------------------------------------- */
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

export default router;
