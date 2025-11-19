// src/ws/tickerHub.js
const LAST_TICK = {};

export function handleTickerEvent(symbol, msg) {
  if (!msg.data) return;

  LAST_TICK[symbol] = {
    price: Number(msg.data.lastPrice),
    bid: Number(msg.data.bid1Price),
    ask: Number(msg.data.ask1Price),
    ts: Date.now()
  };

  // Debug only
  // console.log("TICK", symbol, LAST_TICK[symbol]);
}

export function getLastTick(symbol) {
  return LAST_TICK[symbol] || null;
}
