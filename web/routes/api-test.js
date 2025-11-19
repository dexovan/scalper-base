// web/routes/api-test.js
import express from "express";
import fs from "fs";
import path from "path";

import paths from "../../src/config/paths.js";
import { getWsStatus } from "../../src/ws/eventHub.js";

const router = express.Router();

/* ---------------------------------------------------------
   Helper – load JSON safely
--------------------------------------------------------- */
function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (err) {
    console.error("JSON load error:", filePath, err);
  }
  return null;
}

/* ---------------------------------------------------------
   1) Ticker
--------------------------------------------------------- */
router.get("/ticker/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const file = path.join(paths.wsSnapshots, "ticker", `${symbol}.json`);
  const data = loadJson(file);

  res.json({
    symbol,
    ok: !!data,
    data: data || "No ticker data yet"
  });
});

/* ---------------------------------------------------------
   2) Tradeflow
--------------------------------------------------------- */
router.get("/tradeflow/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const file = path.join(paths.wsSnapshots, "trades", `${symbol}.json`);
  const data = loadJson(file);

  res.json({
    symbol,
    ok: !!data,
    data: data || "No tradeflow data yet"
  });
});

/* ---------------------------------------------------------
   3) Orderbook
--------------------------------------------------------- */
router.get("/orderbook/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const file = path.join(paths.wsSnapshots, "orderbook", `${symbol}.json`);
  const ob = loadJson(file);

  res.json({
    symbol,
    ok: ob && ob.ts,
    bids: ob?.bids?.slice(0, 5) || [],
    asks: ob?.asks?.slice(0, 5) || [],
    ts: ob?.ts || null
  });
});

/* ---------------------------------------------------------
   4) WebSocket Status
--------------------------------------------------------- */
router.get("/ws", (req, res) => {
  const st = getWsStatus();

  res.json({
    connected: st.connected,
    lastConnectedAt: st.lastConnectedAt,
    lastMessageAt: st.lastMessageAt,
    reconnectAttempts: st.reconnectAttempts,
    error: st.lastErrorMessage || null
  });
});

export default router;
