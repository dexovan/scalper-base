// =======================================================
// src/ws/tradeFlow.js
// =======================================================

const TRADE_FLOW = {};

export function handleTradeEvent(symbol, msg) {
  const trades = msg.data;
  if (!trades || !Array.isArray(trades)) return;

  let buy = 0;
  let sell = 0;

  for (const t of trades) {
    if (t.side === "Buy") buy += Number(t.qty);
    else sell += Number(t.qty);
  }

  TRADE_FLOW[symbol] = {
    symbol,
    buy,
    sell,
    ratio: buy + sell > 0 ? buy / (buy + sell) : 0,
    ts: Date.now()
  };
}

export function getTradeFlow(symbol) {
  return TRADE_FLOW[symbol] || null;
}
