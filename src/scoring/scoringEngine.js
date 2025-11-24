/**
 * SCORING ENGINE - Orchestrator
 *
 * Manages the entire scoring pipeline:
 * - Periodic score updates for all symbols
 * - State management (in-memory + disk)
 * - Hotlist generation (scanner pre-filter)
 * - API data access
 * - Integration with FeatureEngine and RegimeEngine
 *
 * Architecture:
 * - Tier-based update intervals (Prime 1s, Normal 2s, Wild 3-5s)
 * - In-memory ScoreState per symbol
 * - JSON snapshot persistence
 * - Hotlist caching with TTL
 */

import { promises as fs } from 'fs';
import path from 'path';
import CONFIG from '../config/index.js';
import logger from '../utils/logger.js';
import { getUniverseSymbols, getSymbolMeta } from '../market/universe_v2.js';
import { computeBaseScores, applyRegimeAndRiskFilters, computeSignalState } from './scoringModel.js';

// ================================================================
// STATE STRUCTURE
// ================================================================

/**
 * ScoreState (per symbol):
 * {
 *   symbol: "BTCUSDT",
 *   baseLong: 75.3,
 *   baseShort: 42.1,
 *   finalLong: 68.2,
 *   finalShort: 0,
 *   allowedLong: true,
 *   allowedShort: false,
 *   signalLong: "WATCH",
 *   signalShort: "NONE",
 *   blockedReasons: ["SYMBOL_PUMP"],
 *   components: { ... }, // Score breakdown
 *   updatedAt: ISO timestamp,
 *   tier: "PRIME"
 * }
 */

class ScoringEngine {
  constructor() {
    this.logger = logger.child({ component: 'ScoringEngine' });

    // Configuration
    this.config = CONFIG.scoring || {
      updateIntervalMs: 1000,
      weights: {},
      thresholds: {},
      hotlist: {}
    };

    // State storage
    this.scoreStates = new Map(); // symbol -> ScoreState
    this.lastUpdateAt = null;

    // Update intervals (per-symbol)
    this.updateIntervals = new Map(); // symbol -> intervalId

    // Hotlist cache
    this.hotlistCache = {
      data: [],
      cachedAt: null,
      ttl: 2000 // 2 second cache
    };

    // Performance metrics
    this.metrics = {
      symbolsUpdated: 0,
      updateCounter: 0,
      errorsCount: 0,
      averageUpdateTimeMs: 0
    };

    // Running flag
    this.isRunning = false;
  }

  // ================================================================
  // LIFECYCLE
  // ================================================================

  /**
   * Initialize and start scoring engine
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Scoring engine already running');
      return;
    }

    this.logger.info('🎯 Starting Scoring Engine...');

    try {
      // Update health status
      const { setServiceStatus } = await import('../monitoring/health.js');
      setServiceStatus('scoringEngine', 'INIT', 'Starting...');

      // Get universe symbols
      const symbols = getUniverseSymbols(true); // Active symbols only
      this.logger.info(`Loaded ${symbols.length} symbols from universe`);

      // Initialize state for all symbols
      for (const symbol of symbols) {
        this.scoreStates.set(symbol, {
          symbol,
          baseLong: 0,
          baseShort: 0,
          finalLong: 0,
          finalShort: 0,
          allowedLong: false,
          allowedShort: false,
          signalLong: 'NONE',
          signalShort: 'NONE',
          blockedReasons: [],
          components: {},
          updatedAt: new Date().toISOString(),
          tier: getSymbolMeta(symbol)?.tier || 'NORMAL'
        });
      }

      // Start periodic updates
      this.startPeriodicUpdates();

      this.isRunning = true;
      setServiceStatus('scoringEngine', 'OK', `Processing ${symbols.length} symbols`);
      this.logger.info('✅ Scoring Engine started successfully');
    } catch (error) {
      const { setServiceStatus } = await import('../monitoring/health.js');
      setServiceStatus('scoringEngine', 'ERROR', error.message);
      this.logger.error('Failed to start Scoring Engine:', error);
      throw error;
    }
  }

  /**
   * Stop scoring engine
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Scoring Engine...');

    // Clear all intervals
    for (const intervalId of this.updateIntervals.values()) {
      clearInterval(intervalId);
    }
    this.updateIntervals.clear();

    this.isRunning = false;
    this.logger.info('✅ Scoring Engine stopped');
  }

  // ================================================================
  // PERIODIC UPDATES
  // ================================================================

  /**
   * Start periodic score updates
   */
  startPeriodicUpdates() {
    // Single unified interval for simplicity (1 second)
    // TODO: Optimize with tier-based intervals in future
    const intervalId = setInterval(() => {
      this.updateAllScores();
    }, this.config.updateIntervalMs);

    this.updateIntervals.set('main', intervalId);
    this.logger.info(`Periodic updates started (interval: ${this.config.updateIntervalMs}ms)`);
  }

  /**
   * Update all symbol scores
   */
  async updateAllScores() {
    const startTime = Date.now();

    try {
      const symbols = Array.from(this.scoreStates.keys());

      for (const symbol of symbols) {
        try {
          await this.updateScoreForSymbol(symbol);
        } catch (error) {
          this.logger.error(`Error updating score for ${symbol}:`, error.message);
          this.metrics.errorsCount++;
        }
      }

      this.metrics.symbolsUpdated = symbols.length;
      this.metrics.updateCounter++;
      this.lastUpdateAt = new Date().toISOString();

      const elapsedMs = Date.now() - startTime;
      this.metrics.averageUpdateTimeMs = elapsedMs;

    } catch (error) {
      this.logger.error('Error in updateAllScores:', error);
    }
  }

  /**
   * Update score for single symbol
   */
  async updateScoreForSymbol(symbol) {
    try {
      // Get FeatureEngine instance (exported from monitorApi.js)
      const { featureEngine } = await import('../http/monitorApi.js');
      if (!featureEngine) {
        throw new Error('FeatureEngine not available');
      }

      // Get RegimeEngine instance (from global - set in index.js)
      const regimeEngine = global.regimeEngine;
      if (!regimeEngine) {
        throw new Error('RegimeEngine not available');
      }

      // Get feature state
      const featureState = featureEngine.getFeatureState(symbol);
      if (!featureState) {
        // Symbol has no feature data yet - skip
        return;
      }

      // Get regime states
      const symbolRegime = regimeEngine.getSymbolRegime(symbol);
      const globalRegime = regimeEngine.getGlobalRegime();

      if (!symbolRegime || !globalRegime) {
        // Regime data not ready - skip
        return;
      }

      // Risk state stub (for Phase 6)
      const riskState = {
        allowNewPositions: true,
        allowNewLong: true,
        allowNewShort: true
      };

      // Compute base scores
      const baseScores = computeBaseScores(
        symbol,
        featureState,
        this.config.weights
      );

      // Apply regime & risk filters
      const filtered = applyRegimeAndRiskFilters(
        baseScores,
        symbolRegime,
        globalRegime,
        riskState,
        this.config
      );

      // Compute signal states
      const signalLong = computeSignalState(
        filtered.finalLong,
        filtered.allowedLong,
        this.config.thresholds
      );

      const signalShort = computeSignalState(
        filtered.finalShort,
        filtered.allowedShort,
        this.config.thresholds
      );

      // Update state
      const scoreState = {
        symbol,
        baseLong: parseFloat(baseScores.baseLong.toFixed(2)),
        baseShort: parseFloat(baseScores.baseShort.toFixed(2)),
        finalLong: parseFloat(filtered.finalLong.toFixed(2)),
        finalShort: parseFloat(filtered.finalShort.toFixed(2)),
        allowedLong: filtered.allowedLong,
        allowedShort: filtered.allowedShort,
        signalLong,
        signalShort,
        blockedReasons: filtered.blockedReasons,
        components: baseScores.components,
        updatedAt: new Date().toISOString(),
        tier: getSymbolMeta(symbol)?.tier || 'NORMAL',
        regime: symbolRegime.current,
        globalRegime: globalRegime.regime
      };

      this.scoreStates.set(symbol, scoreState);

      // Invalidate hotlist cache when score changes significantly
      const oldState = this.scoreStates.get(symbol);
      if (oldState && Math.abs(oldState.finalLong - scoreState.finalLong) > 10) {
        this.hotlistCache.cachedAt = null; // Invalidate cache
      }

    } catch (error) {
      this.logger.error(`Failed to update score for ${symbol}:`, error.message);
      throw error;
    }
  }

  // ================================================================
  // HOTLIST GENERATOR (Scanner Pre-Filter)
  // ================================================================

  /**
   * Get scanner hotlist - top scoring symbols
   *
   * @param {object} options - { side: "BOTH"|"LONG"|"SHORT", minScore, limit }
   * @returns {Array} Hotlist array sorted by finalScore DESC
   */
  getScannerHotlist(options = {}) {
    const {
      side = 'BOTH',
      minScore = this.config.hotlist?.minScoreForHotlist || 40,
      limit = this.config.hotlist?.maxWatchCandidates || 20
    } = options;

    // Check cache
    const now = Date.now();
    if (
      this.hotlistCache.cachedAt &&
      now - this.hotlistCache.cachedAt < this.hotlistCache.ttl
    ) {
      // Return cached data
      return this.filterHotlist(this.hotlistCache.data, side, minScore, limit);
    }

    // Generate new hotlist
    const candidates = [];

    for (const [symbol, state] of this.scoreStates.entries()) {
      // Skip if regime not NORMAL
      if (state.regime !== 'NORMAL') continue;

      // Skip if global regime not NORMAL
      if (state.globalRegime !== 'NORMAL') continue;

      // Add LONG candidate
      if (state.allowedLong && state.finalLong >= minScore) {
        candidates.push({
          symbol,
          side: 'LONG',
          finalScore: state.finalLong,
          baseScore: state.baseLong,
          signal: state.signalLong,
          tier: state.tier,
          pumpRisk: parseFloat(state.components?.pumpPenalty?.long || 0),
          spoofingLevel: parseFloat(state.components?.spoofPenalty || 0),
          volatility: parseFloat(state.components?.volatility || 0),
          feeEdge: parseFloat(state.components?.feeEdge || 0),
          updatedAt: state.updatedAt
        });
      }

      // Add SHORT candidate
      if (state.allowedShort && state.finalShort >= minScore) {
        candidates.push({
          symbol,
          side: 'SHORT',
          finalScore: state.finalShort,
          baseScore: state.baseShort,
          signal: state.signalShort,
          tier: state.tier,
          pumpRisk: parseFloat(state.components?.pumpPenalty?.short || 0),
          spoofingLevel: parseFloat(state.components?.spoofPenalty || 0),
          volatility: parseFloat(state.components?.volatility || 0),
          feeEdge: parseFloat(state.components?.feeEdge || 0),
          updatedAt: state.updatedAt
        });
      }
    }

    // Sort by finalScore DESC
    candidates.sort((a, b) => b.finalScore - a.finalScore);

    // Cache result
    this.hotlistCache.data = candidates;
    this.hotlistCache.cachedAt = now;

    return this.filterHotlist(candidates, side, minScore, limit);
  }

  /**
   * Filter and limit hotlist based on criteria
   */
  filterHotlist(candidates, side, minScore, limit) {
    let filtered = candidates;

    // Filter by side
    if (side === 'LONG') {
      filtered = filtered.filter(c => c.side === 'LONG');
    } else if (side === 'SHORT') {
      filtered = filtered.filter(c => c.side === 'SHORT');
    }

    // Filter by minScore
    filtered = filtered.filter(c => c.finalScore >= minScore);

    // Limit results
    filtered = filtered.slice(0, limit);

    return filtered;
  }

  // ================================================================
  // DATA ACCESS
  // ================================================================

  /**
   * Get score state for symbol
   */
  getScoreState(symbol) {
    return this.scoreStates.get(symbol) || null;
  }

  /**
   * Get all score states
   */
  getAllScoreStates() {
    return Array.from(this.scoreStates.values());
  }

  /**
   * Get scoring statistics
   */
  getStats() {
    const states = Array.from(this.scoreStates.values());

    const signalCounts = {
      ARM_LONG: 0,
      ARM_SHORT: 0,
      WATCH_LONG: 0,
      WATCH_SHORT: 0,
      NONE: 0
    };

    for (const state of states) {
      if (state.signalLong === 'ARM') signalCounts.ARM_LONG++;
      if (state.signalShort === 'ARM') signalCounts.ARM_SHORT++;
      if (state.signalLong === 'WATCH') signalCounts.WATCH_LONG++;
      if (state.signalShort === 'WATCH') signalCounts.WATCH_SHORT++;
      if (state.signalLong === 'NONE' && state.signalShort === 'NONE') signalCounts.NONE++;
    }

    return {
      totalSymbols: this.scoreStates.size,
      symbolsUpdated: this.metrics.symbolsUpdated,
      updateCounter: this.metrics.updateCounter,
      errorsCount: this.metrics.errorsCount,
      averageUpdateTimeMs: this.metrics.averageUpdateTimeMs,
      lastUpdateAt: this.lastUpdateAt,
      signalCounts,
      isRunning: this.isRunning
    };
  }

  /**
   * Get health status
   */
  getHealth() {
    return {
      status: this.isRunning ? 'OK' : 'STOPPED',
      lastUpdateAt: this.lastUpdateAt,
      symbolsUpdated: this.metrics.symbolsUpdated,
      updateIntervalMs: this.config.updateIntervalMs,
      errorsCount: this.metrics.errorsCount
    };
  }
}

// ================================================================
// SINGLETON EXPORT
// ================================================================

export const scoringEngine = new ScoringEngine();

export default {
  scoringEngine,
  start: () => scoringEngine.start(),
  stop: () => scoringEngine.stop(),
  getScoreState: (symbol) => scoringEngine.getScoreState(symbol),
  getAllScoreStates: () => scoringEngine.getAllScoreStates(),
  getScannerHotlist: (options) => scoringEngine.getScannerHotlist(options),
  getStats: () => scoringEngine.getStats(),
  getHealth: () => scoringEngine.getHealth()
};
