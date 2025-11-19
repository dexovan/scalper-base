// ================================================
// src/ws/orderbookWatcher.js
// ================================================

const ORDERBOOK = {};

export function handleOrderbookEvent(symbol, msg) {
  const data = msg.data;
  if (!data || !data.b || !data.a) return;

  ORDERBOOK[symbol] = {
    bids: data.b.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
    asks: data.a.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
    ts: Date.now()
  };
}

export function getOrderbook(symbol) {
  return ORDERBOOK[symbol] || {
    bids: [],
    asks: [],
    ts: null
  };
}
