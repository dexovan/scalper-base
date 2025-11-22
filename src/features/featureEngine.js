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
import { getUniverseSymbols } from '../market/universe_v2.js';

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
            const symbols = await getUniverseSymbols();
            this.logger.info(`Loaded ${symbols.length} symbols from universe`);

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

        // Start update loops for all symbols
        const symbols = Array.from(this.featureStates.keys());

        for (const symbol of symbols) {
            this.startSymbolUpdates(symbol);
        }

        // Start performance monitoring
        this.startPerformanceMonitoring();

        this.logger.info(`Feature Engine started - processing ${symbols.length} symbols`);
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

        try {
            // Get required data from microstructure
            const microstructureData = await this.getMicrostructureData(symbol);
            if (!microstructureData) {
                return false;
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
                Promise.resolve(this.engines.imbalance.analyzeImbalance(orderbook)),

                // Walls & spoofing analysis
                Promise.resolve(this.engines.walls.analyzeWallsAndSpoofing(orderbook, trades, currentPrice)),

                // Flow/delta analysis
                Promise.resolve(this.engines.flow.analyzeFlow(trades)),

                // Volatility analysis
                Promise.resolve(this.engines.volatility.analyzeVolatility(candles)),

                // Fee/leverage analysis
                Promise.resolve(this.engines.feeLeverage.analyzeFeeAndLeverage({
                    symbol,
                    symbolMeta,
                    volatilityData: {}, // Will be filled after volatility analysis
                    currentPrice
                })),

                // Pump pre-signals analysis
                Promise.resolve(this.engines.pumpSignals.analyzePumpSignals({
                    currentPrice,
                    priceHistory,
                    recentTrades: trades,
                    orderbookData: orderbook,
                    candleData: candles
                }))
            ]);

            // Extract results (handle any failures gracefully)
            const [
                imbalanceResult,
                wallsResult,
                flowResult,
                volatilityResult,
                feeLeverageResult,
                pumpResult
            ] = analyses.map(result =>
                result.status === 'fulfilled' ? result.value : this.getEmptyAnalysisForType(result.reason)
            );

            // Update fee/leverage with volatility data
            if (volatilityResult && feeLeverageResult) {
                const updatedFeeAnalysis = await this.engines.feeLeverage.analyzeFeeAndLeverage({
                    symbol,
                    symbolMeta,
                    volatilityData: volatilityResult,
                    currentPrice
                });
                Object.assign(feeLeverageResult, updatedFeeAnalysis);
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
     * Get feature overview for all symbols
     */
    getFeaturesOverview() {
        const overview = [];

        for (const [symbol, state] of this.featureStates.entries()) {
            overview.push({
                symbol,
                lastUpdateAt: state.lastUpdateAt,
                tobImbalance: state.imbalance?.tobImbalance || 0,
                spoofingScore: state.walls?.spoofingScore || 0,
                volatilityScore: state.volatility?.volatilityScore || 0,
                pumpLikelihoodScore: state.pumpSignals?.pumpLikelihoodScore || 0,
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
        const recentlyUpdated = Array.from(this.lastUpdateTimes.values())
            .filter(time => Date.now() - time < 30000).length; // Updated in last 30s

        return {
            status: this.isRunning ? 'RUNNING' : 'STOPPED',
            isInitialized: this.isInitialized,
            totalSymbols,
            activeSymbols: recentlyUpdated,
            updateCoverage: totalSymbols > 0 ? (recentlyUpdated / totalSymbols) : 0,
            performance: this.performanceMetrics,
            lastUpdateAt: Math.max(...Array.from(this.lastUpdateTimes.values()))
        };
    }

    /**
     * Start update loop for a specific symbol
     */
    startSymbolUpdates(symbol) {
        // Determine update interval based on symbol tier
        const tier = this.getSymbolTier(symbol);
        const interval = this.config.updateIntervals[tier];

        const intervalId = setInterval(async () => {
            if (this.isRunning) {
                await this.updateFeaturesForSymbol(symbol);
            }
        }, interval);

        this.updateIntervals.set(symbol, intervalId);

        // Initial update
        setImmediate(() => this.updateFeaturesForSymbol(symbol));
    }

    /**
     * Get microstructure data for a symbol
     */
    async getMicrostructureData(symbol) {
        try {
            // Import OrderbookManager functions
            const {
                getOrderbookSummary,
                getRecentTrades,
                getCandles
            } = await import('../microstructure/OrderbookManager.js');

            const [orderbook, trades, candles] = await Promise.all([
                getOrderbookSummary(symbol, 10),
                getRecentTrades(symbol, 100),
                getCandles(symbol, ['1s', '5s', '15s'])
            ]);

            // Get current price from orderbook or trades
            let currentPrice = 0;
            if (orderbook && orderbook.bids && orderbook.bids.length > 0 && orderbook.asks && orderbook.asks.length > 0) {
                currentPrice = (parseFloat(orderbook.bids[0]?.[0] || 0) +
                              parseFloat(orderbook.asks[0]?.[0] || 0)) / 2;
            } else if (trades && trades.length > 0) {
                currentPrice = parseFloat(trades[0].price);
            }

            // Get symbol metadata
            const symbolMeta = await this.getSymbolMetadata(symbol);

            return {
                orderbook,
                trades,
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
        // Placeholder - would integrate with actual symbol metadata
        return {
            maxLeverage: 20,
            makerFee: 0.0001,
            takerFee: 0.0004,
            minNotional: 10
        };
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
        const symbolData = this.symbolData || {};
        const performanceMetrics = this.performanceMetrics || {};
        const engines = this.engines || {};

        const status = {
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            activeSymbols: Object.keys(symbolData).length,
            totalAnalyses: Object.values(symbolData).reduce((total, data) => {
                return total + Object.keys((data && data.features) || {}).length;
            }, 0),
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
