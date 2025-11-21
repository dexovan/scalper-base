/**
 * FLOW / DELTA ENGINE
 *
 * Analyzes trade flow and volume delta to detect:
 * - Buy vs Sell pressure
 * - Volume imbalances
 * - Momentum shifts
 * - Dominance streaks
 * - Aggressive vs passive flow
 */

const logger = require('../utils/logger');

class FlowDeltaEngine {
    constructor(config = {}) {
        this.config = {
            // Time windows for analysis
            timeWindows: [1, 5, 15], // seconds

            // Buffer sizes for each window
            bufferSizes: {
                1: 120,   // 2 minutes of 1s data
                5: 60,    // 5 minutes of 5s aggregated data
                15: 40    // 10 minutes of 15s aggregated data
            },

            // Dominance thresholds
            dominanceThreshold: 0.2, // 20% delta ratio to declare dominance

            // Minimum volume for reliable calculations
            minVolumeThreshold: 100,

            // Streak tracking
            minStreakDuration: 3, // Minimum 3 seconds for streak

            ...config
        };

        this.logger = logger.child({ component: 'FlowDeltaEngine' });

        // Trade buffers for each time window
        this.tradeBuffers = {
            1: [],   // 1-second aggregated data
            5: [],   // 5-second aggregated data
            15: []   // 15-second aggregated data
        };

        // Streak tracking
        this.streakState = {
            currentSide: 'NONE',
            streakStartTime: null,
            streakDuration: 0
        };
    }

    /**
     * Analyze trade flow and delta for a symbol
     * @param {Array} recentTrades - Recent trade data
     * @returns {Object} Flow analysis result
     */
    analyzeFlow(recentTrades) {
        try {
            if (!this.isValidTradeData(recentTrades)) {
                return this.getEmptyFlowAnalysis();
            }

            // Update internal buffers with new trade data
            this.updateTradeBuffers(recentTrades);

            const result = {
                timestamp: new Date().toISOString(),

                // Volume metrics for each timeframe
                buyVolume1s: 0,
                sellVolume1s: 0,
                deltaVolume1s: 0,
                deltaRatio1s: 0,

                buyVolume5s: 0,
                sellVolume5s: 0,
                deltaVolume5s: 0,
                deltaRatio5s: 0,

                buyVolume15s: 0,
                sellVolume15s: 0,
                deltaVolume15s: 0,
                deltaRatio15s: 0,

                // Current state
                currentDominantSide: 'NONE',
                dominanceStreakSeconds: 0,
                aggressiveFlowRatio: 0,

                // Flow characteristics
                flowConsistency: 0,
                volumeAcceleration: 0,

                metadata: {
                    totalTrades: recentTrades.length,
                    timeRange: this.getTimeRange(recentTrades),
                    bufferSizes: this.getBufferSizes()
                }
            };

            // Calculate metrics for each timeframe
            for (const window of this.config.timeWindows) {
                const windowData = this.calculateWindowMetrics(window);

                result[`buyVolume${window}s`] = windowData.buyVolume;
                result[`sellVolume${window}s`] = windowData.sellVolume;
                result[`deltaVolume${window}s`] = windowData.deltaVolume;
                result[`deltaRatio${window}s`] = windowData.deltaRatio;
            }

            // Determine current dominant side
            result.currentDominantSide = this.determineDominantSide(result);

            // Update and get streak information
            result.dominanceStreakSeconds = this.updateStreakTracking(result.currentDominantSide);

            // Calculate advanced metrics
            result.aggressiveFlowRatio = this.calculateAggressiveFlowRatio(recentTrades);
            result.flowConsistency = this.calculateFlowConsistency(result);
            result.volumeAcceleration = this.calculateVolumeAcceleration();

            return result;

        } catch (error) {
            this.logger.error('Error analyzing flow:', error);
            return this.getEmptyFlowAnalysis();
        }
    }

    /**
     * Update trade buffers with new trade data
     */
    updateTradeBuffers(recentTrades) {
        const now = Date.now();

        // Group trades by time windows
        for (const window of this.config.timeWindows) {
            const windowMs = window * 1000;
            const windowStart = now - windowMs;

            // Filter trades within this window
            const windowTrades = recentTrades.filter(trade => {
                const tradeTime = new Date(trade.timestamp).getTime();
                return tradeTime >= windowStart;
            });

            // Aggregate volume by side
            const aggregated = this.aggregateTradesByWindow(windowTrades, window);

            // Update buffer
            this.tradeBuffers[window].push(aggregated);

            // Trim buffer to max size
            const maxSize = this.config.bufferSizes[window];
            if (this.tradeBuffers[window].length > maxSize) {
                this.tradeBuffers[window] = this.tradeBuffers[window].slice(-maxSize);
            }
        }
    }

    /**
     * Aggregate trades by time window
     */
    aggregateTradesByWindow(trades, windowSeconds) {
        let buyVolume = 0;
        let sellVolume = 0;
        let tradeCount = 0;
        let totalVolume = 0;

        for (const trade of trades) {
            const volume = parseFloat(trade.size || trade.quantity || 0);
            const isBuyerMaker = trade.side === 'buy' || trade.isBuyerMaker === false;

            totalVolume += volume;
            tradeCount++;

            if (isBuyerMaker) {
                buyVolume += volume;
            } else {
                sellVolume += volume;
            }
        }

        const deltaVolume = buyVolume - sellVolume;
        const deltaRatio = totalVolume > 0 ? deltaVolume / totalVolume : 0;

        return {
            timestamp: Date.now(),
            window: windowSeconds,
            buyVolume,
            sellVolume,
            deltaVolume,
            deltaRatio,
            tradeCount,
            totalVolume
        };
    }

    /**
     * Calculate metrics for a specific time window
     */
    calculateWindowMetrics(window) {
        const buffer = this.tradeBuffers[window];

        if (buffer.length === 0) {
            return {
                buyVolume: 0,
                sellVolume: 0,
                deltaVolume: 0,
                deltaRatio: 0
            };
        }

        // Get the most recent data point
        const latest = buffer[buffer.length - 1];

        return {
            buyVolume: latest.buyVolume,
            sellVolume: latest.sellVolume,
            deltaVolume: latest.deltaVolume,
            deltaRatio: latest.deltaRatio
        };
    }

    /**
     * Determine which side is currently dominant
     */
    determineDominantSide(flowData) {
        // Use 5-second window as primary indicator (balance between noise and signal)
        const primaryRatio = flowData.deltaRatio5s;

        if (primaryRatio > this.config.dominanceThreshold) {
            return 'BUY';
        } else if (primaryRatio < -this.config.dominanceThreshold) {
            return 'SELL';
        } else {
            return 'NONE';
        }
    }

    /**
     * Update streak tracking and return current streak duration
     */
    updateStreakTracking(currentSide) {
        const now = Date.now();

        if (currentSide !== this.streakState.currentSide) {
            // Streak changed
            this.streakState.currentSide = currentSide;
            this.streakState.streakStartTime = now;
            this.streakState.streakDuration = 0;
        } else if (currentSide !== 'NONE' && this.streakState.streakStartTime) {
            // Continue existing streak
            this.streakState.streakDuration = Math.floor(
                (now - this.streakState.streakStartTime) / 1000
            );
        }

        // Only count significant streaks
        return this.streakState.streakDuration >= this.config.minStreakDuration ?
               this.streakState.streakDuration : 0;
    }

    /**
     * Calculate aggressive vs passive flow ratio
     * Aggressive = market orders, Passive = limit orders
     */
    calculateAggressiveFlowRatio(recentTrades) {
        if (!recentTrades || recentTrades.length === 0) return 0;

        let aggressiveVolume = 0;
        let totalVolume = 0;

        for (const trade of recentTrades) {
            const volume = parseFloat(trade.size || trade.quantity || 0);
            totalVolume += volume;

            // Aggressive trades are typically market orders (taker trades)
            // This can be determined by checking if trade moved the price
            const isAggressive = trade.isBuyerMaker === false ||
                               trade.side === 'buy' ||
                               trade.type === 'market';

            if (isAggressive) {
                aggressiveVolume += volume;
            }
        }

        return totalVolume > 0 ? aggressiveVolume / totalVolume : 0;
    }

    /**
     * Calculate flow consistency across timeframes
     */
    calculateFlowConsistency(flowData) {
        const ratios = [
            flowData.deltaRatio1s,
            flowData.deltaRatio5s,
            flowData.deltaRatio15s
        ];

        // Check how many ratios agree on direction
        const positiveCount = ratios.filter(r => r > 0.1).length;
        const negativeCount = ratios.filter(r => r < -0.1).length;
        const neutralCount = ratios.filter(r => Math.abs(r) <= 0.1).length;

        const maxAgreement = Math.max(positiveCount, negativeCount);
        const consistency = maxAgreement / ratios.length;

        return consistency;
    }

    /**
     * Calculate volume acceleration (increasing/decreasing volume)
     */
    calculateVolumeAcceleration() {
        const buffer = this.tradeBuffers[5]; // Use 5s buffer

        if (buffer.length < 3) return 0;

        // Compare recent volume to earlier volume
        const recent = buffer.slice(-2);
        const earlier = buffer.slice(-4, -2);

        const recentAvg = recent.reduce((sum, data) => sum + data.totalVolume, 0) / recent.length;
        const earlierAvg = earlier.reduce((sum, data) => sum + data.totalVolume, 0) / earlier.length;

        if (earlierAvg === 0) return 0;

        const acceleration = (recentAvg - earlierAvg) / earlierAvg;

        // Clamp to reasonable range
        return Math.max(-2, Math.min(2, acceleration));
    }

    /**
     * Helper methods
     */
    getTimeRange(trades) {
        if (!trades || trades.length === 0) return null;

        const timestamps = trades.map(t => new Date(t.timestamp).getTime());
        return {
            start: Math.min(...timestamps),
            end: Math.max(...timestamps),
            duration: Math.max(...timestamps) - Math.min(...timestamps)
        };
    }

    getBufferSizes() {
        return Object.fromEntries(
            Object.entries(this.tradeBuffers).map(([window, buffer]) => [
                window + 's',
                buffer.length
            ])
        );
    }

    isValidTradeData(trades) {
        return Array.isArray(trades) && trades.length > 0;
    }

    getEmptyFlowAnalysis() {
        return {
            timestamp: new Date().toISOString(),
            buyVolume1s: 0,
            sellVolume1s: 0,
            deltaVolume1s: 0,
            deltaRatio1s: 0,
            buyVolume5s: 0,
            sellVolume5s: 0,
            deltaVolume5s: 0,
            deltaRatio5s: 0,
            buyVolume15s: 0,
            sellVolume15s: 0,
            deltaVolume15s: 0,
            deltaRatio15s: 0,
            currentDominantSide: 'NONE',
            dominanceStreakSeconds: 0,
            aggressiveFlowRatio: 0,
            flowConsistency: 0,
            volumeAcceleration: 0,
            metadata: {
                totalTrades: 0,
                timeRange: null,
                bufferSizes: {}
            }
        };
    }

    /**
     * Reset internal state (useful for testing)
     */
    reset() {
        this.tradeBuffers = {
            1: [],
            5: [],
            15: []
        };

        this.streakState = {
            currentSide: 'NONE',
            streakStartTime: null,
            streakDuration: 0
        };
    }
}

export default FlowDeltaEngine;
