/**
 * CENTRAL FEATURE ENGINE
 *
 * Orchestrates all feature analysis modules:
 * - Orderbook Imbalance Analysis
 * - Walls & Spoofing Detection
 * - Flow/Delta Analysis
 * - Volatility Analysis
 * - Fee/Leverage Calculations
 * - Pump Pre-Signals Detection
 *
 * Provides unified FeatureState for each symbol with:
 * - Memory storage
 * - JSON persistence
 * - API access
 * - Throttling and performance optimization
 */

import { promises as fs } from 'fs';
import path from 'path';

import OrderbookImbalanceEngine from './orderbookImbalance.js';
import WallsSpoofingEngine from './wallsSpoofing.js';
import FlowDeltaEngine from './flowDelta.js';
import VolatilityEngine from './volatilityEngine.js';
import FeeLeverageEngine from './feeLeverageEngine.js';
import PumpPreSignalsEngine from './pumpPreSignals.js';

import logger from '../utils/logger.js';
import { getUniverseSymbols, getSymbolMeta } from '../market/universe_v2.js';
import { getOrderbookSummary, getRecentTrades, getCandles, touchSymbolActivity } from '../microstructure/OrderbookManager.js';

class FeatureEngine {
    constructor(config = {}) {
        this.config = {
            // Update intervals per symbol tier (milliseconds)
            updateIntervals: {
                prime: 1000,    // 1 second for prime symbols
                normal: 2000,   // 2 seconds for normal symbols
                wild: 5000      // 5 seconds for wild symbols
            },

            // Data persistence
            dataPath: path.join(process.cwd(), 'data', 'metrics'),
            saveInterval: 10000, // Save to disk every 10 seconds

            // Performance limits
            maxConcurrentUpdates: 10,
            cpuThrottleThreshold: 0.7, // 70% CPU usage

            // Feature engine configurations
            engines: {
                imbalance: {},
                walls: {},
                flow: {},
                volatility: {},
                feeLeverage: {},
                pumpSignals: {}
            },

            ...config
        };

        this.logger = logger.child({ component: 'FeatureEngine' });

        // Initialize feature engines
        this.engines = {
            imbalance: new OrderbookImbalanceEngine(this.config.engines.imbalance),
            walls: new WallsSpoofingEngine(this.config.engines.walls),
            flow: new FlowDeltaEngine(this.config.engines.flow),
            volatility: new VolatilityEngine(this.config.engines.volatility),
            feeLeverage: new FeeLeverageEngine(this.config.engines.feeLeverage),
            pumpSignals: new PumpPreSignalsEngine(this.config.engines.pumpSignals)
        };

        // Feature state storage
        this.featureStates = new Map(); // symbol -> FeatureState
        this.updateIntervals = new Map(); // symbol -> intervalId
        this.lastUpdateTimes = new Map(); // symbol -> timestamp

        // Performance monitoring
        this.performanceMetrics = {
            updatesPerSecond: 0,
            averageUpdateTime: 0,
            symbolsProcessed: 0,
            errorsCount: 0
        };

        // Adaptive interval tracking (for dynamic feature update rates)
        this.eventRateTracking = {
            lastEventCount: 0,
            currentEventCount: 0,
            eventsPerSecond: 0,
            lastCalculationAt: Date.now()
        };

        // Debug counters
        this._nullDataCount = 0;
        this._successDataCount = 0;
        this._firstDataLogged = false;
        this._firstUpdateLogged = false;
        this._analysisLogged = false;

        // System state
        this.isInitialized = false;
        this.isRunning = false;
        this.saveIntervalId = null;
    }

    /**
     * Initialize the Feature Engine
     */
    async init() {
        try {
            this.logger.info('Initializing Feature Engine...');

            // Ensure data directory exists
            await this.ensureDataDirectory();

            // Load universe symbols
            const symbols = await getUniverseSymbols(true); // Filter active only
            this.logger.info(`Loaded ${symbols.length} active symbols from universe (filtered)`);

            // Initialize feature states for all symbols
            for (const symbol of symbols) {
                this.featureStates.set(symbol, this.createEmptyFeatureState(symbol));
            }

            // Start periodic save
            // DISABLED: Disk persistence fills disk too fast (500+ symbols × 10KB each = 5MB every 10s = 1.8GB/hour!)
            // this.startPeriodicSave();

            this.isInitialized = true;
            this.logger.info('Feature Engine initialized successfully');

        } catch (error) {
            this.logger.error('Failed to initialize Feature Engine:', error);
            throw error;
        }
    }

    /**
     * Start the feature engine (begin processing)
     */
    async start() {
        if (!this.isInitialized) {
            throw new Error('Feature Engine must be initialized before starting');
        }

        if (this.isRunning) {
            this.logger.warn('Feature Engine is already running');
            return;
        }

        this.logger.info('Starting Feature Engine processing...');
        this.isRunning = true;

        // Start update loops ONLY for symbols with OrderbookManager data
        const allSymbols = Array.from(this.featureStates.keys());

        // Wait briefly for OrderbookManager to accumulate initial data
        await new Promise(resolve => setTimeout(resolve, 3000));

        const { getActiveSymbols } = await import('../microstructure/OrderbookManager.js');
        const activeSymbols = getActiveSymbols();

        this.logger.info(`[DIAGNOSTIC] Symbols in universe: ${allSymbols.length}, Symbols with orderbook data: ${activeSymbols.length}`);

        if (activeSymbols.length === 0) {
            this.logger.warn('No symbols with orderbook data yet - will retry in 5 seconds');
            setTimeout(() => this.startActiveSymbolUpdates(), 5000);
        } else {
            this.logger.info(`[DIAGNOSTIC] Starting updates for symbols: ${activeSymbols.slice(0, 10).join(', ')}...`);

            for (const symbol of activeSymbols) {
                // Only start updates for symbols that are in our universe
                if (this.featureStates.has(symbol)) {
                    this.startSymbolUpdates(symbol);
                }
            }

            this.logger.info(`Feature Engine started - processing ${activeSymbols.length} active symbols (out of ${allSymbols.length} in universe)`);
        }

        // Start performance monitoring
        this.startPerformanceMonitoring();
    }

    /**
     * Helper: Start updates for active symbols (used for retry logic)
     */
    async startActiveSymbolUpdates() {
        if (!this.isRunning) return;

        const { getActiveSymbols } = await import('../microstructure/OrderbookManager.js');
        const activeSymbols = getActiveSymbols();

        if (activeSymbols.length === 0) {
            this.logger.warn('Still no symbols with orderbook data - will retry in 10 seconds');
            setTimeout(() => this.startActiveSymbolUpdates(), 10000);
            return;
        }

        this.logger.info(`Starting updates for ${activeSymbols.length} symbols with orderbook data`);

        for (const symbol of activeSymbols) {
            if (this.featureStates.has(symbol) && !this.updateIntervals.has(symbol)) {
                this.startSymbolUpdates(symbol);
            }
        }
    }

    /**
     * Stop the feature engine
     */
    async stop() {
        if (!this.isRunning) return;

        this.logger.info('Stopping Feature Engine...');
        this.isRunning = false;

        // Clear all update intervals
        for (const intervalId of this.updateIntervals.values()) {
            clearInterval(intervalId);
        }
        this.updateIntervals.clear();

        // Clear save interval
        if (this.saveIntervalId) {
            clearInterval(this.saveIntervalId);
            this.saveIntervalId = null;
        }

        // Final save of all states
        await this.saveAllStates();

        this.logger.info('Feature Engine stopped');
    }

    /**
     * Update features for a specific symbol
     */
    async updateFeaturesForSymbol(symbol) {
        const startTime = Date.now();

        // FULLY DISABLED: Console spam (every feature update = 10,000+ logs/s!)
        // if (!this._updateCallCount) this._updateCallCount = 0;
        // this._updateCallCount++;
        // if (this._updateCallCount % 10 === 1) {
        //     const msg = `🔍 [FEATURE ENGINE DEBUG] updateFeaturesForSymbol called (count: ${this._updateCallCount}, symbol: ${symbol})\n`;
        //     process.stdout.write(msg);
        // }

        try {
            // Get required data from microstructure
            const microstructureData = await this.getMicrostructureData(symbol);
            if (!microstructureData) {
                // DEBUG: Count and log failures
                if (!this._updateFailCount) this._updateFailCount = 0;
                this._updateFailCount++;
                if (this._updateFailCount <= 5) {
                    console.log(`[DEBUG] updateFeaturesForSymbol(${symbol}): getMicrostructureData returned null`);
                }
                return false;
            }

            // Mark symbol as active (even if no WebSocket stream)
            touchSymbolActivity(symbol);

            // DEBUG: Log success
            if (!this._updateSuccessCount) this._updateSuccessCount = 0;
            this._updateSuccessCount++;
            if (this._updateSuccessCount <= 5) {
                console.log(`[DEBUG] updateFeaturesForSymbol(${symbol}): SUCCESS - got data, will set lastUpdateTimes`);
            }

            const {
                orderbook,
                trades,
                candles,
                currentPrice,
                symbolMeta
            } = microstructureData;

            // Create price history from trades/candles
            const priceHistory = this.createPriceHistory(trades, candles);

            // Run all feature analyses
            const analyses = await Promise.allSettled([
                // Orderbook imbalance analysis
                this.engines.imbalance.analyzeImbalance(orderbook),

                // Walls & spoofing analysis
                this.engines.walls.analyzeWallsAndSpoofing(orderbook, trades, currentPrice),

                // Flow/delta analysis
                this.engines.flow.analyzeFlow(trades),

                // Volatility analysis
                this.engines.volatility.analyzeVolatility(candles),

                // Fee/leverage analysis
                this.engines.feeLeverage.analyzeFeeAndLeverage({
                    symbol,
                    symbolMeta,
                    volatilityData: {}, // Will be filled after volatility analysis
                    currentPrice
                }),

                // Pump pre-signals analysis
                this.engines.pumpSignals.analyzePumpSignals({
                    currentPrice,
                    priceHistory,
                    recentTrades: trades,
                    orderbookData: orderbook,
                    candleData: candles
                })
            ]);

            // DEBUG: Log analysis completion
            const rejectedCount = analyses.filter(a => a.status === 'rejected').length;
            if (rejectedCount > 0 || !this._analysisLogged) {
                this._analysisLogged = true;
                const statuses = analyses.map(a => a.status === 'fulfilled' ? '✓' : '✗').join('');
                this.logger.info(`[DEBUG] Analysis for ${symbol}: [${statuses}] - ${rejectedCount} rejected`);
            }

            // Extract results (handle any failures gracefully)
            const [
                imbalanceResult,
                wallsResult,
                flowResult,
                volatilityResult,
                feeLeverageResult,
                pumpResult
            ] = analyses.map((result, idx) => {
                if (result.status === 'rejected') {
                    const engineNames = ['imbalance', 'walls', 'flow', 'volatility', 'feeLeverage', 'pumpSignals'];
                    this.logger.error(`[${symbol}] Engine ${engineNames[idx]} failed:`, result.reason);
                    return this.getEmptyAnalysisForType(result.reason);
                }
                return result.value;
            });

            // Update fee/leverage with volatility data
            if (volatilityResult && feeLeverageResult) {
                try {
                    const updatedFeeAnalysis = await this.engines.feeLeverage.analyzeFeeAndLeverage({
                        symbol,
                        symbolMeta,
                        volatilityData: volatilityResult,
                        currentPrice
                    });
                    Object.assign(feeLeverageResult, updatedFeeAnalysis);
                } catch (error) {
                    this.logger.error(`[${symbol}] Fee/leverage update failed:`, error.message);
                    // Keep original feeLeverageResult
                }
            }

            // Compose final feature state
            const featureState = {
                symbol,
                lastUpdateAt: new Date().toISOString(),
                updateDuration: Date.now() - startTime,

                imbalance: imbalanceResult,
                walls: wallsResult,
                flow: flowResult,
                volatility: volatilityResult,
                feeLeverage: feeLeverageResult,
                pumpSignals: pumpResult,

                // Derived metrics
                overallRiskScore: this.calculateOverallRiskScore({
                    volatility: volatilityResult,
                    walls: wallsResult,
                    pump: pumpResult
                }),

                marketCondition: this.assessMarketCondition({
                    imbalance: imbalanceResult,
                    flow: flowResult,
                    volatility: volatilityResult
                }),

                metadata: {
                    dataQuality: this.assessDataQuality(microstructureData),
                    analysisVersion: '1.0.0',
                    processingTime: Date.now() - startTime
                }
            };

            // Store in memory
            this.featureStates.set(symbol, featureState);
            this.lastUpdateTimes.set(symbol, Date.now());

            // DEBUG: Log first successful update
            if (!this._firstUpdateLogged) {
                this._firstUpdateLogged = true;
                this.logger.info(`[DEBUG] First successful feature update for ${symbol} - lastUpdateTimes size: ${this.lastUpdateTimes.size}`);
            }

            // Update performance metrics
            this.updatePerformanceMetrics(Date.now() - startTime);

            return true;

        } catch (error) {
            this.logger.error(`Error updating features for ${symbol}:`, error);
            this.performanceMetrics.errorsCount++;
            return false;
        }
    }

    /**
     * Get feature state for a symbol
     */
    getFeatureState(symbol) {
        return this.featureStates.get(symbol) || null;
    }

    /**
     * Get all symbols being tracked by FeatureEngine
     */
    getAllSymbols() {
        return Array.from(this.featureStates.keys());
    }

    /**
     * Get feature overview for all symbols
     */
    getFeaturesOverview() {
        const overview = [];

        // DEBUG: Log first state to see structure
        if (!this._overviewDebugLogged && this.featureStates.size > 0) {
            this._overviewDebugLogged = true;
            const firstState = Array.from(this.featureStates.values())[0];
            this.logger.info('[DEBUG] First state structure:', {
                hasImbalance: !!firstState.imbalance,
                imbalanceKeys: firstState.imbalance ? Object.keys(firstState.imbalance) : [],
                hasWalls: !!firstState.walls,
                wallsKeys: firstState.walls ? Object.keys(firstState.walls) : [],
                hasVolatility: !!firstState.volatility,
                volatilityKeys: firstState.volatility ? Object.keys(firstState.volatility) : [],
                tobImbalance: firstState.imbalance?.tobImbalance,
                spoofingScore: firstState.walls?.spoofingScore,
                volatilityScore: firstState.volatility?.volatilityScore
            });
        }

        for (const [symbol, state] of this.featureStates.entries()) {
            // Calculate orderbook freshness
            const orderbookFreshness = state.lastUpdateAt
                ? Date.now() - new Date(state.lastUpdateAt).getTime()
                : null;

            overview.push({
                symbol,
                lastUpdateAt: state.lastUpdateAt,
                orderbookFreshness, // ms since last orderbook update
                tobImbalance: state.imbalance?.tobImbalance || 0,
                spoofingScore: state.walls?.spoofingScore || 0,
                volatilityScore: state.volatility?.volatilityScore || 0,
                riskLevel: state.volatility?.riskLevel || null,
                explosionFlag: state.volatility?.explosionFlag || false,
                pumpLikelihoodScore: state.pumpSignals?.pumpLikelihoodScore || 0,
                defaultLeverage: state.feeLeverage?.defaultLeverage || 0,
                maxLeverage: state.feeLeverage?.metadata?.leverageConstraints?.maxAvailable || 0,
                overallRiskScore: state.overallRiskScore || 0,
                marketCondition: state.marketCondition || 'UNKNOWN'
            });
        }

        return overview.sort((a, b) => b.overallRiskScore - a.overallRiskScore);
    }

    /**
     * Get performance and health metrics
     */
    getHealthMetrics() {
        const totalSymbols = this.featureStates.size;
        const now = Date.now();

        // Changed from 30s to 60s window to accommodate symbols with 15s intervals
        // With staggered updates across 300 symbols, 30s was too restrictive
        const recentlyUpdated = Array.from(this.lastUpdateTimes.values())
            .filter(time => now - time < 60000).length; // Updated in last 60s

        // DEBUG: Log health calculation periodically
        if (!this._lastHealthLog || now - this._lastHealthLog > 10000) {
            this._lastHealthLog = now;
            this.logger.info(`[DEBUG] Health check: lastUpdateTimes.size=${this.lastUpdateTimes.size}, recentlyUpdated=${recentlyUpdated}, totalSymbols=${totalSymbols}`);
            if (this.lastUpdateTimes.size > 0) {
                const ages = Array.from(this.lastUpdateTimes.values()).map(t => Math.floor((now - t) / 1000));
                this.logger.info(`[DEBUG] Sample update ages (seconds): ${ages.slice(0, 10).join(', ')}`);
            }
        }

        return {
            status: this.isRunning ? 'RUNNING' : 'STOPPED',
            isInitialized: this.isInitialized,
            totalSymbols,
            activeSymbols: recentlyUpdated,
            updateCoverage: totalSymbols > 0 ? (recentlyUpdated / totalSymbols) : 0,
            performance: this.performanceMetrics,
            lastUpdateAt: this.lastUpdateTimes.size > 0 ? Math.max(...Array.from(this.lastUpdateTimes.values())) : 0
        };
    }

    /**
     * Start update loop for a specific symbol
     */
    /**
     * Calculate adaptive update interval based on WebSocket event rate
     * @returns {number} interval in milliseconds
     */
    getAdaptiveInterval() {
        const { eventsPerSecond } = this.eventRateTracking;

        // Low traffic: 50ms updates (20 updates/sec)
        if (eventsPerSecond < 100) {
            return 50;
        }

        // Normal traffic: 100ms updates (10 updates/sec)
        if (eventsPerSecond < 500) {
            return 100;
        }

        // High traffic: 200ms updates (5 updates/sec)
        if (eventsPerSecond < 1500) {
            return 200;
        }

        // Overload: 300ms updates (3.3 updates/sec)
        return 300;
    }

    /**
     * Update WebSocket event rate tracking
     * Called by WebSocket handlers on every event
     */
    trackWebSocketEvent() {
        this.eventRateTracking.currentEventCount++;

        const now = Date.now();
        const elapsed = now - this.eventRateTracking.lastCalculationAt;

        // Recalculate rate every second
        if (elapsed >= 1000) {
            const events = this.eventRateTracking.currentEventCount - this.eventRateTracking.lastEventCount;
            this.eventRateTracking.eventsPerSecond = Math.round(events / (elapsed / 1000));
            this.eventRateTracking.lastEventCount = this.eventRateTracking.currentEventCount;
            this.eventRateTracking.lastCalculationAt = now;
        }
    }

    startSymbolUpdates(symbol) {
        // Use adaptive interval instead of fixed tier-based interval
        let lastProcessAt = 0;

        const updateLoop = async () => {
            if (!this.isRunning) return;

            const now = Date.now();
            const dynamicInterval = this.getAdaptiveInterval();

            // Only process if enough time has passed
            if (now - lastProcessAt >= dynamicInterval) {
                await this.updateFeaturesForSymbol(symbol);
                lastProcessAt = now;
            }

            // Schedule next check with minimum interval to stay responsive
            setTimeout(updateLoop, Math.min(dynamicInterval, 50));
        };

        // Start the adaptive update loop
        updateLoop();

        // Track that this symbol is being updated (for stopping later)
        this.updateIntervals.set(symbol, { type: 'adaptive', symbol });

        // Initial update
        setImmediate(() => this.updateFeaturesForSymbol(symbol));
    }

    /**
     * Get microstructure data for a symbol
     */
    async getMicrostructureData(symbol) {
        try {
            // Use statically imported OrderbookManager functions
            const [orderbook, trades, candles1s, candles5s, candles15s] = await Promise.all([
                getOrderbookSummary(symbol, 10),
                getRecentTrades(symbol, 100),
                getCandles(symbol, '1s', 100),
                getCandles(symbol, '5s', 100),
                getCandles(symbol, '15s', 100)
            ]);

            // Combine candles into a map
            const candles = {
                '1s': candles1s || [],
                '5s': candles5s || [],
                '15s': candles15s || []
            };

            // Check if we have ANY usable data for this symbol
            // orderbook must have bids/asks arrays with data, not just exist as empty object
            const hasOrderbookData = orderbook && orderbook.bids && orderbook.bids.length > 0 && orderbook.asks && orderbook.asks.length > 0;
            const hasTradesData = trades && trades.length > 0;
            const hasData = hasOrderbookData || hasTradesData;

            // DEBUG: Log null data pattern
            if (!hasData) {
                this._nullDataCount++;
                if (this._nullDataCount <= 10) {
                    this.logger.info(`[DEBUG] No data for ${symbol}: orderbook=${hasOrderbookData}, trades=${trades?.length || 0}, candles1s=${candles1s?.length || 0}`);
                } else if (this._nullDataCount === 100) {
                    this.logger.warn(`[DEBUG] 100 symbols with no data. Success count: ${this._successDataCount}`);
                }
                return null;
            }

            this._successDataCount++;

            // DEBUG: Log first successful data fetch
            if (!this._firstDataLogged) {
                this._firstDataLogged = true;
                this.logger.info(`[DEBUG] First successful data fetch for ${symbol}: orderbook=${!!orderbook}, trades=${trades?.length || 0}`);
            }

            // Get current price from orderbook or trades
            let currentPrice = 0;
            if (orderbook && orderbook.bids && orderbook.bids.length > 0 && orderbook.asks && orderbook.asks.length > 0) {
                const topBid = parseFloat(orderbook.bids[0]?.[0] || 0);
                const topAsk = parseFloat(orderbook.asks[0]?.[0] || 0);
                currentPrice = (topBid + topAsk) / 2;

                // DEBUG: Log price calculation
                if (!this._priceDebugLogged) {
                    this._priceDebugLogged = true;
                    this.logger.info(`[DEBUG] Price calculation for ${symbol}:`, {
                        topBid,
                        topAsk,
                        currentPrice,
                        bidStructure: orderbook.bids[0],
                        askStructure: orderbook.asks[0]
                    });
                }
            } else if (trades && trades.length > 0) {
                currentPrice = parseFloat(trades[0].price);

                // DEBUG: Log fallback to trade price
                if (!this._tradePriceDebugLogged) {
                    this._tradePriceDebugLogged = true;
                    this.logger.info(`[DEBUG] Using trade price for ${symbol}:`, {
                        currentPrice,
                        tradeStructure: trades[0]
                    });
                }
            }

            // Get symbol metadata
            const symbolMeta = await this.getSymbolMetadata(symbol);

            return {
                orderbook: orderbook || { bids: [], asks: [], spread: 0 },
                trades: trades || [],
                candles,
                currentPrice,
                symbolMeta
            };

        } catch (error) {
            this.logger.error(`Failed to get microstructure data for ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Helper methods for data processing and analysis
     */
    createPriceHistory(trades, candles) {
        const priceHistory = [];

        // Add prices from recent trades
        if (trades && trades.length > 0) {
            for (const trade of trades.slice(-100)) {
                priceHistory.push({
                    price: parseFloat(trade.price),
                    timestamp: new Date(trade.timestamp).getTime()
                });
            }
        }

        // Add prices from candles if needed
        if (candles && candles['1s'] && priceHistory.length < 50) {
            for (const candle of candles['1s'].slice(-60)) {
                priceHistory.push({
                    price: parseFloat(candle.close),
                    timestamp: new Date(candle.timestamp).getTime()
                });
            }
        }

        // Sort by timestamp
        return priceHistory.sort((a, b) => a.timestamp - b.timestamp);
    }

    calculateOverallRiskScore(analyses) {
        const { volatility, walls, pump } = analyses;

        let riskScore = 0;

        // Volatility contributes 40%
        if (volatility?.volatilityScore) {
            riskScore += volatility.volatilityScore * 0.4;
        }

        // Walls/spoofing contributes 35%
        if (walls?.spoofingScore) {
            riskScore += walls.spoofingScore * 0.35;
        }

        // Pump signals contribute 25%
        if (pump?.pumpLikelihoodScore) {
            riskScore += pump.pumpLikelihoodScore * 0.25;
        }

        return Math.min(riskScore, 1);
    }

    assessMarketCondition(analyses) {
        const { imbalance, flow, volatility } = analyses;

        if (volatility?.riskLevel === 'EXTREME' || volatility?.explosionFlag) {
            return 'EXPLOSIVE';
        }

        if (imbalance?.imbalancedSide !== 'NONE' && flow?.currentDominantSide !== 'NONE') {
            return imbalance.imbalancedSide === flow.currentDominantSide ? 'DIRECTIONAL' : 'CONFLICTED';
        }

        if (volatility?.riskLevel === 'LOW' || volatility?.riskLevel === 'VERY_LOW') {
            return 'CALM';
        }

        return 'NORMAL';
    }

    assessDataQuality(microstructureData) {
        let qualityScore = 0;

        if (microstructureData.orderbook?.bids?.length >= 10) qualityScore += 25;
        if (microstructureData.trades?.length >= 20) qualityScore += 25;
        if (microstructureData.candles?.['5s']?.length >= 10) qualityScore += 25;
        if (microstructureData.currentPrice > 0) qualityScore += 25;

        if (qualityScore >= 90) return 'EXCELLENT';
        if (qualityScore >= 70) return 'GOOD';
        if (qualityScore >= 50) return 'FAIR';
        return 'POOR';
    }

    /**
     * Persistence and utility methods
     */
    async saveAllStates() {
        // DISABLED: Disk persistence fills disk too fast!
        // With 500 symbols × ~10KB per state = 5MB per save
        // At 10s interval = 1.8GB per hour = 43GB per day!
        // FeatureStates are already in RAM (this.featureStates Map)
        // Only write to disk on manual request or shutdown if needed
        this.logger.debug('saveAllStates() called but DISABLED to prevent disk fill');
        return;

        /* ORIGINAL CODE - DISABLED:
        try {
            const savePromises = [];

            for (const [symbol, state] of this.featureStates.entries()) {
                const filePath = path.join(this.config.dataPath, `${symbol}.json`);
                const savePromise = fs.writeFile(filePath, JSON.stringify(state, null, 2));
                savePromises.push(savePromise);
            }

            await Promise.allSettled(savePromises);
            this.logger.debug(`Saved feature states for ${this.featureStates.size} symbols`);

        } catch (error) {
            this.logger.error('Failed to save feature states:', error);
        }
        */
    }

    async ensureDataDirectory() {
        try {
            await fs.mkdir(this.config.dataPath, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    startPeriodicSave() {
        // DISABLED: Prevent disk fill - features kept in RAM only
        this.logger.info('Periodic save DISABLED - feature states kept in memory only');
        return;

        /* ORIGINAL CODE - DISABLED:
        this.saveIntervalId = setInterval(async () => {
            await this.saveAllStates();
        }, this.config.saveInterval);
        */
    }

    startPerformanceMonitoring() {
        setInterval(() => {
            // Reset counters for next interval
            this.performanceMetrics.updatesPerSecond = 0;
        }, 1000);
    }

    updatePerformanceMetrics(processingTime) {
        this.performanceMetrics.updatesPerSecond++;
        this.performanceMetrics.symbolsProcessed++;

        // Update average processing time
        this.performanceMetrics.averageUpdateTime =
            (this.performanceMetrics.averageUpdateTime + processingTime) / 2;
    }

    getSymbolTier(symbol) {
        // Simple tier classification - can be enhanced with actual tier data
        const primeSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
        if (primeSymbols.includes(symbol)) return 'prime';

        return 'normal'; // Default to normal tier
    }

    async getSymbolMetadata(symbol) {
        try {
            // Use static import (already imported at top)
            const universeMeta = getSymbolMeta(symbol);

            if (universeMeta) {
                // Return real metadata from universe
                return {
                    maxLeverage: universeMeta.maxLeverage || 1,
                    makerFee: 0.0001,  // Default fees (Bybit standard)
                    takerFee: 0.0004,
                    minNotional: 10,
                    category: universeMeta.category,
                    status: universeMeta.status
                };
            }

            // Fallback if symbol not in universe
            this.logger.warn(`Symbol ${symbol} not found in universe, using fallback`);
            return {
                maxLeverage: 1,  // No leverage if not in universe
                makerFee: 0.0001,
                takerFee: 0.0004,
                minNotional: 10
            };
        } catch (error) {
            this.logger.error(`Failed to get symbol metadata for ${symbol}:`, error);
            // Fallback on error
            return {
                maxLeverage: 1,
                makerFee: 0.0001,
                takerFee: 0.0004,
                minNotional: 10
            };
        }
    }

    createEmptyFeatureState(symbol) {
        return {
            symbol,
            lastUpdateAt: new Date().toISOString(),
            updateDuration: 0,
            imbalance: null,
            walls: null,
            flow: null,
            volatility: null,
            feeLeverage: null,
            pumpSignals: null,
            overallRiskScore: 0,
            marketCondition: 'UNKNOWN',
            metadata: {
                dataQuality: 'POOR',
                analysisVersion: '1.0.0',
                processingTime: 0
            }
        };
    }

    getEmptyAnalysisForType(error) {
        this.logger.warn('Analysis failed, using empty result:', error);
        return null;
    }

    /**
     * Get health status of the Feature Engine
     */
    getHealthStatus() {
        const performanceMetrics = this.performanceMetrics || {};
        const engines = this.engines || {};

        // Calculate activeSymbols from lastUpdateTimes (symbols updated in last 60s)
        const now = Date.now();
        const activeSymbols = Array.from(this.lastUpdateTimes.values())
            .filter(time => now - time < 60000).length;

        const status = {
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            activeSymbols: activeSymbols,
            totalSymbols: this.featureStates.size,
            totalAnalyses: this.featureStates.size, // Total symbols in universe
            performanceMetrics: performanceMetrics,
            engines: {
                imbalance: !!engines.imbalance,
                walls: !!engines.walls,
                flow: !!engines.flow,
                volatility: !!engines.volatility,
                leverage: !!engines.leverage,
                pumps: !!engines.pumps
            },
            lastUpdate: new Date().toISOString()
        };

        return status;
    }
}

export default FeatureEngine;
