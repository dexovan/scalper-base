// ============================================================
// TRADE FLOW AGGREGATOR v1.0
// Real-time buy/sell volume tracking with 60s rolling window
// ============================================================

/**
 * TradeFlowAggregator
 *
 * Tracks buy vs sell volume in real-time across all symbols.
 * Uses efficient ring buffer approach for 60s rolling window.
 *
 * Features:
 * - O(1) trade insertion
 * - Automatic cleanup of old trades
 * - Memory efficient (no unbounded arrays)
 * - Per-symbol isolation
 */
class TradeFlowAggregator {
  constructor({ windowMs = 60_000 } = {}) {
    this.windowMs = windowMs;         // 60s rolling window
    this.state = new Map();           // symbol -> { trades: [], buyVol, sellVol, lastUpdate }
  }

  /**
   * Process incoming trade
   *
   * @param {Object} trade - Trade data
   * @param {string} trade.symbol - Symbol (e.g., "BTCUSDT")
   * @param {string} trade.side - "Buy" or "Sell"
   * @param {number} trade.qty - Trade quantity (volume in USD or base asset)
   * @param {number} trade.ts - Timestamp in milliseconds
   */
  onTrade(trade) {
    const { symbol, side, qty, ts } = trade;
    if (!symbol || !side || !qty || !ts) return;

    const now = ts;
    let bucket = this.state.get(symbol);
    if (!bucket) {
      bucket = {
        trades: [],       // { ts, buyVol, sellVol }
        buyVol: 0,
        sellVol: 0,
        lastUpdate: null,
      };
      this.state.set(symbol, bucket);
    }

    // 1) PRUNE old trades (outside 60s window)
    this._prune(symbol, now);

    // 2) Add new trade
    const buyVol = side === 'Buy' ? qty : 0;
    const sellVol = side === 'Sell' ? qty : 0;

    bucket.trades.push({ ts: now, buyVol, sellVol });
    bucket.buyVol += buyVol;
    bucket.sellVol += sellVol;
    bucket.lastUpdate = now;
  }

  /**
   * Get flow data for last 60s
   *
   * @param {string} symbol - Symbol to query
   * @param {number} now - Current timestamp (defaults to Date.now())
   * @returns {Object} { buyVol60s, sellVol60s, net, lastUpdate }
   */
  getFlow(symbol, now = Date.now()) {
    const bucket = this.state.get(symbol);
    if (!bucket) {
      return {
        buyVol60s: 0,
        sellVol60s: 0,
        net: 0,
        lastUpdate: null,
      };
    }

    // Clean up old trades
    this._prune(symbol, now);

    return {
      buyVol60s: bucket.buyVol,
      sellVol60s: bucket.sellVol,
      net: bucket.buyVol - bucket.sellVol,
      lastUpdate: bucket.lastUpdate,
    };
  }

  /**
   * Internal: Remove trades older than windowMs
   *
   * @param {string} symbol - Symbol to clean
   * @param {number} now - Current timestamp
   */
  _prune(symbol, now) {
    const bucket = this.state.get(symbol);
    if (!bucket) return;

    const cutoff = now - this.windowMs;
    const trades = bucket.trades;

    let idx = 0;
    let buyToRemove = 0;
    let sellToRemove = 0;

    // Trades are chronologically ordered -> we can "chew" from the beginning
    while (idx < trades.length && trades[idx].ts < cutoff) {
      buyToRemove += trades[idx].buyVol;
      sellToRemove += trades[idx].sellVol;
      idx++;
    }

    if (idx > 0) {
      // Reduce aggregates
      bucket.buyVol -= buyToRemove;
      bucket.sellVol -= sellToRemove;
      // Remove old trades in one operation
      bucket.trades.splice(0, idx);
    }
  }

  /**
   * Get statistics for all symbols
   * @returns {Object} { totalSymbols, totalTrades, avgTradesPerSymbol }
   */
  getStats() {
    let totalTrades = 0;
    for (const bucket of this.state.values()) {
      totalTrades += bucket.trades.length;
    }

    return {
      totalSymbols: this.state.size,
      totalTrades,
      avgTradesPerSymbol: this.state.size > 0 ? (totalTrades / this.state.size).toFixed(1) : 0,
    };
  }
}

export { TradeFlowAggregator };
