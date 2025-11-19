// web/routes/api-test.js
import express from "express";
import {
  getTicker,
  getTrade,
  getOrderbook
} from "../../src/ws/storage.js";

import { getWsStatus } from "../../src/connectors/bybitPublic.js";

const router = express.Router();

// --------------------------------------------------
// 1) Ticker
// --------------------------------------------------
router.get("/ticker/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const data = getTicker(symbol);

  res.json({
    symbol,
    ok: !!data,
    data: data || "No ticker data yet"
  });
});

// --------------------------------------------------
// 2) Trade (latest trade event)
// --------------------------------------------------
router.get("/tradeflow/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const data = getTrade(symbol);

  res.json({
    symbol,
    ok: !!data,
    data: data || "No tradeflow data yet"
  });
});

// --------------------------------------------------
// 3) Orderbook 50 levels
// --------------------------------------------------
router.get("/orderbook/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const ob = getOrderbook(symbol);

  res.json({
    symbol,
    ok: ob && ob.ts !== null,
    bids: ob?.bids?.slice(0, 5) || [],
    asks: ob?.asks?.slice(0, 5) || [],
    ts: ob?.ts || null
  });
});

// --------------------------------------------------
// 4) WS status
// --------------------------------------------------
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
