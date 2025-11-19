// ================================================
// src/ws/orderbookWatcher.js
// Just delegates to STORAGE
// ================================================

import { getOrderbook as storageGetOrderbook } from "./storage.js";

export function getOrderbook(symbol) {
  return storageGetOrderbook(symbol);
}
