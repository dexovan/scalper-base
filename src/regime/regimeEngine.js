/**
 * REGIME ENGINE ORCHESTRATOR
 *
 * Coordinates per-symbol and global regime analysis.
 * Provides unified regime state interface for the trading system.
 *
 * Architecture:
 * - Per-symbol: PUMP, MANIPULATED, NEWS_DRIVEN, COOLDOWN, STALE, NORMAL
 * - Global: PANIC, RISK_OFF, NORMAL
 *
 * Scheduling:
 * - Prime tier (BTC, ETH, SOL, etc): 1 second updates
 * - Normal tier: 2 second updates
 * - Wild tier: 3-5 second updates (randomized to spread load)
 */

import path from 'path';
import fs from 'fs/promises';
import logger from '../utils/logger.js';
import { determineSymbolRegime, isAllowedToTrade } from './symbolRegime.js';
import { determineGlobalRegime, createGlobalRegimeState } from './globalRegime.js';

// ================================================================
// CONFIGURATION
// ================================================================

const CONFIG = {
  // Update intervals (ms)
  PRIME_TIER_INTERVAL: 1000,
  NORMAL_TIER_INTERVAL: 2000,
  WILD_TIER_MIN_INTERVAL: 3000,
  WILD_TIER_MAX_INTERVAL: 5000,

  // Global regime update interval
  GLOBAL_REGIME_INTERVAL: 1000,

  // Persistence
  PERSIST_ENABLED: true,
  PERSIST_INTERVAL: 10000, // Save state every 10s
  PERSIST_DIR: 'data/metrics'
};

// Prime tier symbols (most liquid)
const PRIME_TIER_SYMBOLS = new Set([
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'MATICUSDT', 'DOTUSDT'
]);

// ================================================================
// REGIME ENGINE CLASS
// ================================================================

class RegimeEngine {
  constructor(featureEngine, orderbookManager) {
    this.featureEngine = featureEngine;
    this.orderbookManager = orderbookManager;

    // State storage
    this.symbolRegimes = new Map(); // symbol -> regime state
    this.globalRegime = createGlobalRegimeState();

    // Scheduling
    this.primeScheduler = null;
    this.normalScheduler = null;
    this.wildSchedulers = new Map(); // symbol -> timer
    this.globalScheduler = null;
    this.persistScheduler = null;

    // Tiers
    this.primeTier = new Set();
    this.normalTier = new Set();
    this.wildTier = new Set();

    // Metrics
    this.updateCount = 0;
    this.transitionCount = 0;
    this.lastUpdateAt = null;

    // Persistence
    this.persistDir = path.join(process.cwd(), CONFIG.PERSIST_DIR);
    this.pendingPersist = false;

    logger.info('[REGIME ENGINE] Initialized');
  }

  // ================================================================
  // LIFECYCLE MANAGEMENT
  // ================================================================

  /**
   * Start regime monitoring
   */
  async start() {
    logger.info('[REGIME ENGINE] Starting...');

    // Ensure persist directory exists
    if (CONFIG.PERSIST_ENABLED) {
      await this._ensurePersistDir();
    }

    // Classify symbols into tiers
    this._classifySymbols();

    // Start schedulers
    this._startPrimeTierScheduler();
    this._startNormalTierScheduler();
    this._startWildTierScheduler();
    this._startGlobalScheduler();

    if (CONFIG.PERSIST_ENABLED) {
      this._startPersistScheduler();
    }

    logger.info(`[REGIME ENGINE] Started (Prime: ${this.primeTier.size}, Normal: ${this.normalTier.size}, Wild: ${this.wildTier.size})`);
  }

  /**
   * Stop regime monitoring
   */
  stop() {
    logger.info('[REGIME ENGINE] Stopping...');

    // Clear all schedulers
    if (this.primeScheduler) clearInterval(this.primeScheduler);
    if (this.normalScheduler) clearInterval(this.normalScheduler);
    if (this.globalScheduler) clearInterval(this.globalScheduler);
    if (this.persistScheduler) clearInterval(this.persistScheduler);

    for (const [symbol, timer] of this.wildSchedulers) {
      clearTimeout(timer);
    }
    this.wildSchedulers.clear();

    logger.info('[REGIME ENGINE] Stopped');
  }

  // ================================================================
  // SYMBOL TIER CLASSIFICATION
  // ================================================================

  _classifySymbols() {
    const allSymbols = this.featureEngine.getAllSymbols();

    this.primeTier.clear();
    this.normalTier.clear();
    this.wildTier.clear();

    for (const symbol of allSymbols) {
      if (PRIME_TIER_SYMBOLS.has(symbol)) {
        this.primeTier.add(symbol);
      } else {
        const features = this.featureEngine.getFeatures(symbol);
        const vol = features?.volatility?.volatilityScore || 0;

        if (vol >= 0.75) {
          // High volatility -> wild tier
          this.wildTier.add(symbol);
        } else {
          // Normal tier
          this.normalTier.add(symbol);
        }
      }
    }
  }

  // ================================================================
  // SCHEDULER MANAGEMENT
  // ================================================================

  _startPrimeTierScheduler() {
    this.primeScheduler = setInterval(() => {
      for (const symbol of this.primeTier) {
        this._updateSymbolRegime(symbol);
      }
    }, CONFIG.PRIME_TIER_INTERVAL);
  }

  _startNormalTierScheduler() {
    this.normalScheduler = setInterval(() => {
      for (const symbol of this.normalTier) {
        this._updateSymbolRegime(symbol);
      }
    }, CONFIG.NORMAL_TIER_INTERVAL);
  }

  _startWildTierScheduler() {
    // Each wild symbol gets its own randomized timer
    for (const symbol of this.wildTier) {
      this._scheduleWildSymbol(symbol);
    }
  }

  _scheduleWildSymbol(symbol) {
    const interval = CONFIG.WILD_TIER_MIN_INTERVAL +
                     Math.random() * (CONFIG.WILD_TIER_MAX_INTERVAL - CONFIG.WILD_TIER_MIN_INTERVAL);

    const timer = setTimeout(() => {
      this._updateSymbolRegime(symbol);
      this._scheduleWildSymbol(symbol); // Re-schedule
    }, interval);

    this.wildSchedulers.set(symbol, timer);
  }

  _startGlobalScheduler() {
    this.globalScheduler = setInterval(() => {
      this._updateGlobalRegime();
    }, CONFIG.GLOBAL_REGIME_INTERVAL);
  }

  _startPersistScheduler() {
    this.persistScheduler = setInterval(() => {
      if (this.pendingPersist) {
        this._persistState().catch(err => {
          logger.error(`[REGIME ENGINE] Persist error: ${err.message}`);
        });
      }
    }, CONFIG.PERSIST_INTERVAL);
  }

  // ================================================================
  // REGIME UPDATE LOGIC
  // ================================================================

  _updateSymbolRegime(symbol) {
    try {
      // Get required data
      const features = this.featureEngine.getFeatures(symbol);
      const symbolHealth = this.orderbookManager.getSymbolHealth?.(symbol);

      if (!features) {
        // logger.debug(`[REGIME ENGINE] No features for ${symbol}, skipping`);
        return;
      }

      const previousRegime = this.symbolRegimes.get(symbol);

      // Determine new regime
      const newRegime = determineSymbolRegime(symbol, features, symbolHealth, previousRegime);

      // Check for transition
      if (!previousRegime || previousRegime.current !== newRegime.current) {
        this.transitionCount++;
        logger.info(`[REGIME ENGINE] ${symbol}: ${previousRegime?.current || 'INIT'} → ${newRegime.current}`);
      }

      // Store new state
      this.symbolRegimes.set(symbol, newRegime);
      this.updateCount++;
      this.lastUpdateAt = new Date();
      this.pendingPersist = true;

    } catch (err) {
      logger.error(`[REGIME ENGINE] Error updating ${symbol}: ${err.message}`);
    }
  }

  _updateGlobalRegime() {
    try {
      // Get BTC and ETH features
      const btcFeatures = this.featureEngine.getFeatures('BTCUSDT');
      const ethFeatures = this.featureEngine.getFeatures('ETHUSDT');

      if (!btcFeatures || !ethFeatures) {
        logger.debug('[REGIME ENGINE] Missing BTC/ETH features, skipping global update');
        return;
      }

      // Determine new global regime
      const newGlobal = determineGlobalRegime(
        btcFeatures,
        ethFeatures,
        this.symbolRegimes,
        this.globalRegime
      );

      // Check for transition
      if (this.globalRegime.current !== newGlobal.current) {
        this.transitionCount++;
        logger.warn(`[REGIME ENGINE] GLOBAL: ${this.globalRegime.current} → ${newGlobal.current}`);
      }

      this.globalRegime = newGlobal;
      this.updateCount++;
      this.lastUpdateAt = new Date();
      this.pendingPersist = true;

    } catch (err) {
      logger.error(`[REGIME ENGINE] Error updating global regime: ${err.message}`);
    }
  }

  // ================================================================
  // STATE PERSISTENCE
  // ================================================================

  async _ensurePersistDir() {
    try {
      await fs.mkdir(this.persistDir, { recursive: true });
    } catch (err) {
      logger.error(`[REGIME ENGINE] Failed to create persist dir: ${err.message}`);
    }
  }

  async _persistState() {
    try {
      const globalPath = path.join(this.persistDir, 'global-regime.json');
      await fs.writeFile(globalPath, JSON.stringify(this.globalRegime, null, 2));

      // Persist top 50 symbols only (to avoid huge file I/O)
      const topSymbols = Array.from(this.symbolRegimes.entries())
        .filter(([sym]) => this.primeTier.has(sym) || this.normalTier.has(sym))
        .slice(0, 50);

      for (const [symbol, regime] of topSymbols) {
        const symbolPath = path.join(this.persistDir, `${symbol}.json`);
        await fs.writeFile(symbolPath, JSON.stringify(regime, null, 2));
      }

      this.pendingPersist = false;

    } catch (err) {
      logger.error(`[REGIME ENGINE] Persist failed: ${err.message}`);
    }
  }

  // ================================================================
  // PUBLIC API
  // ================================================================

  /**
   * Get symbol regime state
   */
  getSymbolRegime(symbol) {
    return this.symbolRegimes.get(symbol) || null;
  }

  /**
   * Get global regime state
   */
  getGlobalRegime() {
    return this.globalRegime;
  }

  /**
   * Get all symbol regimes
   */
  getAllSymbolRegimes() {
    return new Map(this.symbolRegimes);
  }

  /**
   * Get regime overview (for dashboard)
   */
  getRegimeOverview() {
    const stats = {
      global: {
        regime: this.globalRegime.current,
        riskLevel: this.globalRegime.overallRiskLevel,
        allowNewPositions: this.globalRegime.allowNewPositions,
        forceClosePositions: this.globalRegime.forceClosePositions,
        btcVolatility: this.globalRegime.btcVolatility,
        ethVolatility: this.globalRegime.ethVolatility,
        updatedAt: this.globalRegime.updatedAt
      },
      symbols: {
        total: this.symbolRegimes.size,
        byRegime: {
          NORMAL: 0,
          PUMP: 0,
          MANIPULATED: 0,
          NEWS_DRIVEN: 0,
          COOLDOWN: 0,
          STALE: 0
        },
        blocked: 0,
        tradeable: 0
      },
      tiers: {
        prime: this.primeTier.size,
        normal: this.normalTier.size,
        wild: this.wildTier.size
      },
      metrics: {
        updateCount: this.updateCount,
        transitionCount: this.transitionCount,
        lastUpdateAt: this.lastUpdateAt
      }
    };

    for (const [symbol, regime] of this.symbolRegimes) {
      const reg = regime.current;
      stats.symbols.byRegime[reg] = (stats.symbols.byRegime[reg] || 0) + 1;

      if (regime.allowLong || regime.allowShort) {
        stats.symbols.tradeable++;
      } else {
        stats.symbols.blocked++;
      }
    }

    return stats;
  }

  /**
   * Check if trading is allowed
   *
   * @param {string} symbol
   * @param {string} side - 'LONG' or 'SHORT'
   * @returns {Object} { allowed, reason }
   */
  isTradeAllowed(symbol, side) {
    // Check global regime first
    if (this.globalRegime.forceClosePositions) {
      return {
        allowed: false,
        reason: 'GLOBAL_PANIC',
        globalRegime: this.globalRegime.current
      };
    }

    if (!this.globalRegime.allowNewPositions) {
      return {
        allowed: false,
        reason: 'GLOBAL_RISK_OFF',
        globalRegime: this.globalRegime.current
      };
    }

    // Check symbol regime
    const symbolRegime = this.symbolRegimes.get(symbol);
    if (!symbolRegime) {
      return {
        allowed: false,
        reason: 'NO_REGIME_DATA',
        symbolRegime: null
      };
    }

    const symbolAllowed = isAllowedToTrade(symbolRegime, side);

    if (!symbolAllowed) {
      return {
        allowed: false,
        reason: 'SYMBOL_REGIME_BLOCKED',
        symbolRegime: symbolRegime.current
      };
    }

    // All checks passed
    return {
      allowed: true,
      reason: null,
      globalRegime: this.globalRegime.current,
      symbolRegime: symbolRegime.current
    };
  }

  /**
   * Force manual regime update for a symbol
   */
  forceSymbolUpdate(symbol) {
    this._updateSymbolRegime(symbol);
  }

  /**
   * Force manual global regime update
   */
  forceGlobalUpdate() {
    this._updateGlobalRegime();
  }
}

// ================================================================
// EXPORTS
// ================================================================

export default RegimeEngine;
export { RegimeEngine };
