// =======================================================
// src/ws/tickerHub.js
// =======================================================

const LAST_TICK = {};

export function handleTickerEvent(symbol, msg) {
  const d = msg.data;
  if (!d) return;

  LAST_TICK[symbol] = {
    symbol,
    price: Number(d.lastPrice),
    bid: Number(d.bid1Price),
    ask: Number(d.ask1Price),
    ts: Date.now()
  };
}

export function getLastTick(symbol) {
  return LAST_TICK[symbol] || null;
}
