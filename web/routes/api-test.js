// web/routes/api-test.js
import express from "express";
import { getLastTick } from "../../src/ws/tickerHub.js";
import { getTradeFlow } from "../../src/ws/tradeFlow.js";
import { getOrderbook } from "../../src/ws/orderbookWatcher.js";
import { getWsStatus } from "../../src/connectors/bybitPublic.js";

const router = express.Router();

// ----------------------------------------------
// 1) Test ticker
// ----------------------------------------------
router.get("/ticker/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const data = getLastTick(symbol);

  res.json({
    symbol,
    ok: !!data,
    data: data || "No ticker data yet",
  });
});

// ----------------------------------------------
// 2) Test trade flow
// ----------------------------------------------
router.get("/tradeflow/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const data = getTradeFlow(symbol);

  res.json({
    symbol,
    ok: !!data,
    data: data || "No tradeflow data yet",
  });
});

// ----------------------------------------------
// 3) Test orderbook 50 levels
// ----------------------------------------------
router.get("/orderbook/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const data = getOrderbook(symbol);

  res.json({
    symbol,
    ok: !!data,
    bids: data?.bids?.slice(0, 5) || [],
    asks: data?.asks?.slice(0, 5) || [],
    ts: data?.ts || null
  });
});

// ----------------------------------------------
// 4) Test WS global status
// ----------------------------------------------
router.get("/ws", (req, res) => {
  const status = getWsStatus();

  res.json({
    connected: status.connected,
    lastConnectedAt: status.lastConnectedAt,
    lastMessageAt: status.lastMessageAt,
    reconnectAttempts: status.reconnectAttempts,
    error: status.lastErrorMessage || null,
  });
});

export default router;
