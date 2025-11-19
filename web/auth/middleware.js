// ========================================================
// web/auth/middleware.js
// AUTH MIDDLEWARE – hardened version
// ========================================================

export function requireAuth(req, res, next) {
  try {
    // Ako nema sesije - odmah redirect
    if (!req.session || !req.session.user) {
      return res.redirect("/login");
    }

    // Ako se sesija oštetila / nevalidna
    if (typeof req.session.user.username !== "string") {
      req.session.destroy(() => {});
      return res.redirect("/login");
    }

    // Produžavanje sesije na aktivnost (rolling session)
    req.session.touch?.();

    return next();

  } catch (err) {
    console.error("❌ requireAuth error:", err);

    // Ako se nešto jako loše desi → hard reset session
    try {
      req.session.destroy(() => {});
    } catch {}

    return res.redirect("/login");
  }
}
