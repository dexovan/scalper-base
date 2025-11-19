// src/ws/orderbookWatcher.js
const ORDERBOOK = {};

export function handleOrderbookEvent(symbol, msg) {
  const data = msg.data;
  if (!data || !data.b || !data.a) return;

  ORDERBOOK[symbol] = {
    bids: data.b.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
    asks: data.a.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
    ts: Date.now()
  };

  // console.log("OB", symbol, ORDERBOOK[symbol]);
}

export function getOrderbook(symbol) {
  return {
    symbol,
    bids: [],
    asks: [],
    ts: Date.now()
  };
}
