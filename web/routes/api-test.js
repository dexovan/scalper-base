// web/routes/api-test.js
import express from "express";
import fs from "fs";
import path from "path";

import paths from "../../src/config/paths.js";
import { getWsStatus } from "../../src/connectors/bybitPublic.js";

const router = express.Router();

/* ---------------------------------------------------------
   Safe JSON loader
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
   TICKER
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
   TRADEFLOW
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
   ORDERBOOK
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
   WS status
--------------------------------------------------------- */
router.get("/ws", (req, res) => {
  const st = getWsStatus();
  res.json(st);
});

export default router;
