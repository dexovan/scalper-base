// =======================================
// PM2 HOOK OVERRIDE (GLOBAL FIX)
// =======================================
import Module from "module";

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (
    request.includes("express-session/session/store") ||
    request.includes("express-session/session/memory") ||
    request.includes("./session")
  ) {
    return originalLoad.apply(
      this,
      [
        "/home/aiuser/scalper-base/node_modules/express-session/session/store.js",
        parent,
        isMain
      ]
    );
  }
  return originalLoad.apply(this, arguments);
};

// sada učitavamo pravi server
import "./server.js";
