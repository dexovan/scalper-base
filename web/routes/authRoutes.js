import express from "express";
import { authenticate } from "../auth/auth.js";

export function authRoutes(db) {
    const router = express.Router();

    router.get("/login", (req, res) => {
        res.render("login", { error: null });
    });

    router.post("/login", async (req, res) => {
        const { username, password } = req.body;

        const ok = await authenticate(db, username, password);
        if (!ok) {
            return res.render("login", { error: "Pogrešan username ili password." });
        }

        req.session.user = username;
        res.redirect("/dashboard");
    });

    router.get("/logout", (req, res) => {
        req.session.destroy(() => {
            res.redirect("/login");
        });
    });

    return router;
}
