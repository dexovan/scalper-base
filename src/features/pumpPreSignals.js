/**
 * PUMP PRE-SIGNALS ENGINE
 *
 * Detects early pump and dump signals:
 * - Price momentum analysis
 * - Volume spike detection
 * - Orderbook thinning
 * - Trade frequency analysis
 * - Multi-factor pump likelihood scoring
 */

const logger = require('../utils/logger');

class PumpPreSignalsEngine {
    constructor(config = {}) {
        this.config = {
            // Time windows for analysis
            timeWindows: {
                short: 5,    // 5 seconds
                medium: 15,  // 15 seconds
                long: 60     // 60 seconds
            },

            // Price change thresholds
            priceChangeThresholds: {
                minor: 0.02,     // 2%
                moderate: 0.05,  // 5%
                major: 0.10,     // 10%
                extreme: 0.20    // 20%
            },

            // Volume spike multipliers
            volumeSpikeThresholds: {
                minor: 2.0,      // 2x normal volume
                moderate: 5.0,   // 5x normal volume
                major: 10.0,     // 10x normal volume
                extreme: 20.0    // 20x normal volume
            },

            // Trade frequency thresholds (trades per second)
            tradeFrequencyThresholds: {
                normal: 2,
                elevated: 5,
                high: 10,
                extreme: 20
            },

            // Pump likelihood weights (professional calibration)
            pumpWeights: {
                priceChange5s: 0.40,
                volumeSpike5s: 0.30,
                orderbookThinScore: 0.20,
                tradesPerSecond5s: 0.10
            },

            // Rolling averages for baseline calculation
            baselineWindow: 300, // 5 minutes for baseline

            ...config
        };

        this.logger = logger.child({ component: 'PumpPreSignals' });

        // Historical data for baseline calculations
        this.priceHistory = [];
        this.volumeHistory = [];
        this.tradeHistory = [];
        this.orderbookHistory = [];
    }

    /**
     * Analyze pump pre-signals for a symbol
     * @param {Object} params - Analysis parameters
     * @returns {Object} Pump signals analysis result
     */
    analyzePumpSignals(params) {
        try {
            const {
                currentPrice = 0,
                priceHistory = [],
                recentTrades = [],
                orderbookData = null,
                candleData = {}
            } = params;

            if (!currentPrice || priceHistory.length < 10) {
                return this.getEmptyAnalysis();
            }

            // Update historical baselines
            this.updateBaselines(currentPrice, recentTrades, orderbookData);

            const result = {
                timestamp: new Date().toISOString(),

                // Price change metrics
                priceChange5sPct: 0,
                priceChange15sPct: 0,
                priceChange60sPct: 0,

                // Volume spike metrics
                volumeSpike5s: 0,
                volumeSpike15s: 0,

                // Trade frequency metrics
                tradesPerSecond5s: 0,
                tradesPerSecond15s: 0,

                // Orderbook metrics
                orderbookThinScore: 0,

                // Final pump likelihood
                pumpLikelihoodScore: 0,

                // Risk classification
                riskLevel: 'NORMAL',

                metadata: {
                    currentPrice,
                    baselineMetrics: this.getBaselineMetrics(),
                    totalTrades: recentTrades.length,
                    analysisQuality: 'HIGH'
                }
            };

            // Calculate price change percentages
            const priceChanges = this.calculatePriceChanges(currentPrice, priceHistory);
            result.priceChange5sPct = priceChanges.change5s;
            result.priceChange15sPct = priceChanges.change15s;
            result.priceChange60sPct = priceChanges.change60s;

            // Calculate volume spikes
            const volumeSpikes = this.calculateVolumeSpikes(recentTrades);
            result.volumeSpike5s = volumeSpikes.spike5s;
            result.volumeSpike15s = volumeSpikes.spike15s;

            // Calculate trade frequency
            const tradeFreq = this.calculateTradeFrequency(recentTrades);
            result.tradesPerSecond5s = tradeFreq.tps5s;
            result.tradesPerSecond15s = tradeFreq.tps15s;

            // Calculate orderbook thinning
            result.orderbookThinScore = this.calculateOrderbookThinning(orderbookData, currentPrice);

            // Calculate final pump likelihood
            result.pumpLikelihoodScore = this.calculatePumpLikelihood(result);

            // Determine risk level
            result.riskLevel = this.determineRiskLevel(result);

            // Update metadata
            result.metadata.analysisQuality = this.assessAnalysisQuality(params);

            return result;

        } catch (error) {
            this.logger.error('Error analyzing pump signals:', error);
            return this.getEmptyAnalysis();
        }
    }

    /**
     * Calculate price changes across different timeframes
     */
    calculatePriceChanges(currentPrice, priceHistory) {
        const now = Date.now();

        // Find prices at different time points
        const findPriceAt = (secondsAgo) => {
            const targetTime = now - (secondsAgo * 1000);

            // Find closest price point
            let closestPrice = currentPrice;
            let minTimeDiff = Infinity;

            for (const pricePoint of priceHistory) {
                const timeDiff = Math.abs(pricePoint.timestamp - targetTime);
                if (timeDiff < minTimeDiff) {
                    minTimeDiff = timeDiff;
                    closestPrice = pricePoint.price;
                }
            }

            return closestPrice;
        };

        const price5sAgo = findPriceAt(5);
        const price15sAgo = findPriceAt(15);
        const price60sAgo = findPriceAt(60);

        const change5s = price5sAgo > 0 ? (currentPrice - price5sAgo) / price5sAgo : 0;
        const change15s = price15sAgo > 0 ? (currentPrice - price15sAgo) / price15sAgo : 0;
        const change60s = price60sAgo > 0 ? (currentPrice - price60sAgo) / price60sAgo : 0;

        return {
            change5s,
            change15s,
            change60s
        };
    }

    /**
     * Calculate volume spikes compared to baseline
     */
    calculateVolumeSpikes(recentTrades) {
        const now = Date.now();

        // Calculate volume in different windows
        const calculateVolumeInWindow = (secondsAgo) => {
            const cutoff = now - (secondsAgo * 1000);
            return recentTrades
                .filter(trade => new Date(trade.timestamp).getTime() >= cutoff)
                .reduce((sum, trade) => sum + parseFloat(trade.size || trade.quantity || 0), 0);
        };

        const volume5s = calculateVolumeInWindow(5);
        const volume15s = calculateVolumeInWindow(15);

        // Get baseline average volumes
        const baselineVolume5s = this.getBaselineVolume(5);
        const baselineVolume15s = this.getBaselineVolume(15);

        const spike5s = baselineVolume5s > 0 ? volume5s / baselineVolume5s : 1;
        const spike15s = baselineVolume15s > 0 ? volume15s / baselineVolume15s : 1;

        return {
            spike5s,
            spike15s,
            volume5s,
            volume15s,
            baseline5s: baselineVolume5s,
            baseline15s: baselineVolume15s
        };
    }

    /**
     * Calculate trades per second frequency
     */
    calculateTradeFrequency(recentTrades) {
        const now = Date.now();

        const countTradesInWindow = (secondsAgo) => {
            const cutoff = now - (secondsAgo * 1000);
            const tradesInWindow = recentTrades.filter(
                trade => new Date(trade.timestamp).getTime() >= cutoff
            ).length;

            return tradesInWindow / secondsAgo; // trades per second
        };

        return {
            tps5s: countTradesInWindow(5),
            tps15s: countTradesInWindow(15)
        };
    }

    /**
     * Calculate orderbook thinning score
     */
    calculateOrderbookThinning(orderbookData, currentPrice) {
        if (!orderbookData || !orderbookData.bids || !orderbookData.asks) {
            return 0;
        }

        const { bids, asks } = orderbookData;

        // Calculate depth within reasonable price range (±2%)
        const priceRange = currentPrice * 0.02;
        const minPrice = currentPrice - priceRange;
        const maxPrice = currentPrice + priceRange;

        const relevantBids = bids.filter(([price]) =>
            parseFloat(price) >= minPrice && parseFloat(price) <= currentPrice
        );

        const relevantAsks = asks.filter(([price]) =>
            parseFloat(price) <= maxPrice && parseFloat(price) >= currentPrice
        );

        // Calculate total volume in range
        const bidVolume = relevantBids.reduce((sum, [, qty]) => sum + parseFloat(qty), 0);
        const askVolume = relevantAsks.reduce((sum, [, qty]) => sum + parseFloat(qty), 0);
        const totalVolume = bidVolume + askVolume;

        // Get baseline depth
        const baselineDepth = this.getBaselineDepth();

        if (baselineDepth === 0) return 0;

        // Thinning score: 1 = completely thin, 0 = normal depth
        const depthRatio = totalVolume / baselineDepth;
        const thinScore = Math.max(0, 1 - depthRatio);

        return Math.min(thinScore, 1);
    }

    /**
     * Calculate final pump likelihood using weighted formula
     */
    calculatePumpLikelihood(signals) {
        const weights = this.config.pumpWeights;

        // Normalize price change (absolute value, capped at 20%)
        const normalizedPriceChange = Math.min(Math.abs(signals.priceChange5sPct) / 0.20, 1);

        // Normalize volume spike (logarithmic scale)
        const normalizedVolumeSpike = Math.min(
            Math.log(Math.max(signals.volumeSpike5s, 1)) / Math.log(20),
            1
        );

        // Normalize trade frequency
        const normalizedTradeFreq = Math.min(
            signals.tradesPerSecond5s / this.config.tradeFrequencyThresholds.extreme,
            1
        );

        // Orderbook thinning is already normalized (0-1)
        const normalizedThinning = signals.orderbookThinScore;

        // Calculate weighted score
        const likelihood =
            weights.priceChange5s * normalizedPriceChange +
            weights.volumeSpike5s * normalizedVolumeSpike +
            weights.orderbookThinScore * normalizedThinning +
            weights.tradesPerSecond5s * normalizedTradeFreq;

        return Math.min(likelihood, 1);
    }

    /**
     * Determine risk level based on signals
     */
    determineRiskLevel(signals) {
        const { pumpLikelihoodScore, priceChange5sPct, volumeSpike5s } = signals;

        // Extreme conditions
        if (pumpLikelihoodScore > 0.8 ||
            Math.abs(priceChange5sPct) > 0.15 ||
            volumeSpike5s > 15) {
            return 'EXTREME_PUMP_RISK';
        }

        // High risk
        if (pumpLikelihoodScore > 0.6 ||
            Math.abs(priceChange5sPct) > 0.08 ||
            volumeSpike5s > 8) {
            return 'HIGH_PUMP_RISK';
        }

        // Moderate risk
        if (pumpLikelihoodScore > 0.4 ||
            Math.abs(priceChange5sPct) > 0.04 ||
            volumeSpike5s > 4) {
            return 'MODERATE_PUMP_RISK';
        }

        // Low risk
        if (pumpLikelihoodScore > 0.2) {
            return 'LOW_PUMP_RISK';
        }

        return 'NORMAL';
    }

    /**
     * Update baseline metrics for comparison
     */
    updateBaselines(currentPrice, recentTrades, orderbookData) {
        const now = Date.now();

        // Update price history
        this.priceHistory.push({ price: currentPrice, timestamp: now });

        // Update volume history (5s windows)
        const volume5s = recentTrades
            .filter(trade => new Date(trade.timestamp).getTime() >= (now - 5000))
            .reduce((sum, trade) => sum + parseFloat(trade.size || trade.quantity || 0), 0);

        this.volumeHistory.push({ volume: volume5s, timestamp: now });

        // Update trade count history
        const tradeCount5s = recentTrades
            .filter(trade => new Date(trade.timestamp).getTime() >= (now - 5000))
            .length;

        this.tradeHistory.push({ count: tradeCount5s, timestamp: now });

        // Update orderbook depth history
        if (orderbookData && orderbookData.bids && orderbookData.asks) {
            const totalDepth = [...orderbookData.bids, ...orderbookData.asks]
                .slice(0, 20) // Top 10 levels each side
                .reduce((sum, [, qty]) => sum + parseFloat(qty), 0);

            this.orderbookHistory.push({ depth: totalDepth, timestamp: now });
        }

        // Cleanup old history (keep only baseline window)
        const cutoff = now - (this.config.baselineWindow * 1000);
        this.priceHistory = this.priceHistory.filter(p => p.timestamp > cutoff);
        this.volumeHistory = this.volumeHistory.filter(v => v.timestamp > cutoff);
        this.tradeHistory = this.tradeHistory.filter(t => t.timestamp > cutoff);
        this.orderbookHistory = this.orderbookHistory.filter(o => o.timestamp > cutoff);
    }

    /**
     * Get baseline metrics
     */
    getBaselineVolume(windowSeconds) {
        if (this.volumeHistory.length < 10) return 1; // Default to prevent division by zero

        const volumes = this.volumeHistory.map(v => v.volume);
        return volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    }

    getBaselineDepth() {
        if (this.orderbookHistory.length < 10) return 1000; // Default depth

        const depths = this.orderbookHistory.map(o => o.depth);
        return depths.reduce((sum, depth) => sum + depth, 0) / depths.length;
    }

    getBaselineMetrics() {
        return {
            pricePoints: this.priceHistory.length,
            volumePoints: this.volumeHistory.length,
            tradePoints: this.tradeHistory.length,
            orderbookPoints: this.orderbookHistory.length,
            averageVolume5s: this.getBaselineVolume(5),
            averageDepth: this.getBaselineDepth()
        };
    }

    /**
     * Assess quality of analysis based on available data
     */
    assessAnalysisQuality(params) {
        let qualityScore = 0;

        if (params.priceHistory && params.priceHistory.length >= 60) qualityScore += 25;
        if (params.recentTrades && params.recentTrades.length >= 10) qualityScore += 25;
        if (params.orderbookData && params.orderbookData.bids) qualityScore += 25;
        if (this.volumeHistory.length >= 30) qualityScore += 25;

        if (qualityScore >= 90) return 'EXCELLENT';
        if (qualityScore >= 70) return 'HIGH';
        if (qualityScore >= 50) return 'MEDIUM';
        if (qualityScore >= 30) return 'LOW';
        return 'POOR';
    }

    /**
     * Helper methods
     */
    getEmptyAnalysis() {
        return {
            timestamp: new Date().toISOString(),
            priceChange5sPct: 0,
            priceChange15sPct: 0,
            priceChange60sPct: 0,
            volumeSpike5s: 0,
            volumeSpike15s: 0,
            tradesPerSecond5s: 0,
            tradesPerSecond15s: 0,
            orderbookThinScore: 0,
            pumpLikelihoodScore: 0,
            riskLevel: 'NORMAL',
            metadata: {
                currentPrice: 0,
                baselineMetrics: {},
                totalTrades: 0,
                analysisQuality: 'POOR'
            }
        };
    }

    /**
     * Reset internal state (useful for testing)
     */
    reset() {
        this.priceHistory = [];
        this.volumeHistory = [];
        this.tradeHistory = [];
        this.orderbookHistory = [];
    }
}

module.exports = PumpPreSignalsEngine;
