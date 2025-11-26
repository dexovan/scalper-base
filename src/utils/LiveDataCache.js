// ============================================================
// LIVE DATA CACHE
// Prevents Engine API overload by caching live market data
// ============================================================

/**
 * Simple in-memory cache with TTL expiration
 * Perfect for high-frequency live data that changes every 100-300ms
 */
class LiveDataCache {
  constructor(ttl = 300) {
    this.ttl = ttl; // Time-to-live in milliseconds (default 300ms)
    this.cache = new Map(); // symbol -> { data, timestamp }
  }

  /**
   * Get cached data if still fresh
   * @param {string} symbol
   * @returns {object|null} Cached data or null if expired/missing
   */
  get(symbol) {
    const entry = this.cache.get(symbol);

    if (!entry) {
      return null; // Not in cache
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > this.ttl) {
      // Expired - remove from cache
      this.cache.delete(symbol);
      return null;
    }

    return entry.data; // Still fresh
  }

  /**
   * Store data in cache
   * @param {string} symbol
   * @param {object} data
   */
  set(symbol, data) {
    this.cache.set(symbol, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Check if symbol has fresh cached data
   * @param {string} symbol
   * @returns {boolean}
   */
  has(symbol) {
    return this.get(symbol) !== null;
  }

  /**
   * Clear all cached data
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {object}
   */
  getStats() {
    const now = Date.now();
    let fresh = 0;
    let stale = 0;

    for (const [symbol, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age <= this.ttl) {
        fresh++;
      } else {
        stale++;
      }
    }

    return {
      total: this.cache.size,
      fresh,
      stale,
      ttl: this.ttl
    };
  }

  /**
   * Clean up stale entries (run periodically)
   */
  cleanup() {
    const now = Date.now();
    for (const [symbol, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > this.ttl) {
        this.cache.delete(symbol);
      }
    }
  }
}

export default LiveDataCache;
