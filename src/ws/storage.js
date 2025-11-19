// ================================================
// src/ws/storage.js
// Centralized WS Storage
// ================================================

export const STORAGE = {
  tickers: {},
  trades: {},
  orderbooks: {}
};

// ---------- STORE TICKER ----------
export function storeTicker(symbol, data) {
  STORAGE.tickers[symbol] = {
    symbol,
    lastPrice: Number(data.lp),
    high24h: Number(data.h),
    low24h: Number(data.l),
    vol24h: Number(data.v),
    ts: Date.now()
  };
}

// ---------- STORE TRADE ----------
export function storeTrade(symbol, data) {
  STORAGE.trades[symbol] = {
    symbol,
    price: Number(data.p),
    size: Number(data.v),
    side: data.S,
    ts: Date.now()
  };
}

// ---------- STORE ORDERBOOK ----------
export function storeOrderbook(symbol, ob) {
  STORAGE.orderbooks[symbol] = {
    symbol,
    bids: ob.b,
    asks: ob.a,
    ts: Date.now()
  };
}

// ---------- GETTERS ----------
export function getTicker(symbol) {
  return STORAGE.tickers[symbol] || null;
}

export function getTrade(symbol) {
  return STORAGE.trades[symbol] || null;
}

export function getOrderbook(symbol) {
  return STORAGE.orderbooks[symbol] || {
    bids: [],
    asks: [],
    ts: null
  };
}
