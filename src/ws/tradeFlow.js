// src/ws/tradeFlow.js
const TRADE_FLOW = {};

export function handleTradeEvent(symbol, msg) {
  if (!msg.data || !Array.isArray(msg.data)) return;

  const trades = msg.data;

  let buy = 0;
  let sell = 0;

  for (const t of trades) {
    if (t.side === "Buy") buy += Number(t.qty);
    else sell += Number(t.qty);
  }

  TRADE_FLOW[symbol] = {
    buy,
    sell,
    ts: Date.now(),
    ratio: buy + sell > 0 ? buy / (buy + sell) : 0
  };

  // console.log("TRADE", symbol, TRADE_FLOW[symbol]);
}

export function getTradeFlow(symbol) {
  return TRADE_FLOW[symbol] || null;
}
