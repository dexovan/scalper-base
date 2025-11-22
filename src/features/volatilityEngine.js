/**
 * VOLATILITY ENGINE
 *
 * Calculates micro-timeframe volatility metrics using ATR (Average True Range):
 * - Multi-timeframe ATR (1s, 5s, 15s)
 * - Volatility scoring and normalization
 * - Explosion detection
 * - Risk assessment metrics
 */

import logger from '../utils/logger.js';

class VolatilityEngine {
    constructor(config = {}) {
        this.config = {
            // ATR calculation periods
            atrPeriods: {
                '1s': 14,
                '5s': 14,
                '15s': 14
            },

            // Rolling window for normalization (5 minutes)
            rollingWindowSize: 300,

            // Explosion detection multiplier
            explosionMultiplier: 3.0,

            // Minimum candles required for calculation (lowered from 5 to 2)
            minCandlesRequired: 2,

            ...config
        };

        this.logger = logger.child({ component: 'VolatilityEngine' });

        // Store historical ATR data for normalization
        this.atrHistory = {
            '1s': [],
            '5s': [],
            '15s': []
        };
    }

    /**
     * Analyze volatility across multiple timeframes
     * @param {Object} candleData - Multi-timeframe candle data
     * @returns {Object} Volatility analysis result
     */
    analyzeVolatility(candleData) {
        try {
            if (!this.isValidCandleData(candleData)) {
                // DEBUG: Log why candle data is invalid
                if (!this._invalidCandleLogCount) this._invalidCandleLogCount = 0;
                if (this._invalidCandleLogCount < 3) {
                    this._invalidCandleLogCount++;
                    console.log(`⚠️ [VOLATILITY DEBUG] Invalid candle data:`, {
                        has1s: candleData?.['1s']?.length || 0,
                        has5s: candleData?.['5s']?.length || 0,
                        has15s: candleData?.['15s']?.length || 0,
                        minRequired: this.config.minCandlesRequired
                    });
                }
                return this.getEmptyVolatility();
            }

            const result = {
                timestamp: new Date().toISOString(),
                atr1s: 0,
                atr5s: 0,
                atr15s: 0,
                volatilityScore: 0,
                explosionFlag: false,
                explosionStrength: 0,
                riskLevel: 'LOW',
                metadata: {
                    candleCounts: {},
                    atrHistory: {}
                }
            };

            // Calculate ATR for each timeframe
            for (const [timeframe, candles] of Object.entries(candleData)) {
                if (!candles || candles.length < this.config.minCandlesRequired) {
                    continue;
                }

                const atr = this.calculateATR(candles, this.config.atrPeriods[timeframe] || 14);
                const atrKey = `atr${timeframe}`;

                result[atrKey] = atr;
                result.metadata.candleCounts[timeframe] = candles.length;

                // Update historical data for normalization
                this.updateATRHistory(timeframe, atr);
            }

            // Calculate volatility score (normalized)
            result.volatilityScore = this.calculateVolatilityScore(result);

            // Detect volatility explosions
            const explosionAnalysis = this.detectExplosion(result);
            result.explosionFlag = explosionAnalysis.flag;
            result.explosionStrength = explosionAnalysis.strength;

            // Determine risk level
            result.riskLevel = this.determineRiskLevel(result);

            // Add metadata
            result.metadata.atrHistory = this.getATRHistoryStats();

            return result;

        } catch (error) {
            this.logger.error('Error analyzing volatility:', error);
            return this.getEmptyVolatility();
        }
    }

    /**
     * Calculate ATR (Average True Range) for candle series
     * Formula: ATR = SMA of True Range over N periods
     * True Range = max(high-low, |high-prevClose|, |low-prevClose|)
     */
    calculateATR(candles, period) {
        if (!candles || candles.length < 2) return 0;

        const trueRanges = [];

        for (let i = 1; i < candles.length; i++) {
            const current = candles[i];
            const previous = candles[i - 1];

            const high = parseFloat(current.high || current.close);
            const low = parseFloat(current.low || current.close);
            const prevClose = parseFloat(previous.close);

            // Calculate True Range
            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );

            trueRanges.push(tr);
        }

        // Calculate ATR as simple moving average of True Ranges
        const startIndex = Math.max(0, trueRanges.length - period);
        const relevantTRs = trueRanges.slice(startIndex);

        if (relevantTRs.length === 0) return 0;

        const atr = relevantTRs.reduce((sum, tr) => sum + tr, 0) / relevantTRs.length;
        return atr;
    }

    /**
     * Calculate normalized volatility score
     * Score = current ATR / max ATR in rolling window
     */
    calculateVolatilityScore(volatilityData) {
        const { atr1s, atr5s, atr15s } = volatilityData;

        // Use 5s ATR as primary metric (balance between noise and signal)
        const primaryATR = atr5s;
        if (primaryATR === 0) return 0;

        // Get historical max for normalization
        const history = this.atrHistory['5s'];
        if (history.length < 5) return 0.5; // Default to medium volatility

        const maxATR = Math.max(...history.slice(-this.config.rollingWindowSize));
        if (maxATR === 0) return 0;

        const score = Math.min(primaryATR / maxATR, 1);
        return score;
    }

    /**
     * Detect volatility explosions
     * Explosion occurs when current ATR significantly exceeds recent average
     */
    detectExplosion(volatilityData) {
        const { atr1s, atr5s, atr15s } = volatilityData;

        // Use 1s ATR for explosion detection (most sensitive)
        const currentATR = atr1s;
        if (currentATR === 0) return { flag: false, strength: 0 };

        const history = this.atrHistory['1s'];
        if (history.length < 10) return { flag: false, strength: 0 };

        // Calculate average ATR over recent period
        const recentPeriod = Math.min(60, history.length); // Last 60 data points
        const recentATRs = history.slice(-recentPeriod);
        const avgATR = recentATRs.reduce((sum, atr) => sum + atr, 0) / recentATRs.length;

        if (avgATR === 0) return { flag: false, strength: 0 };

        const explosionRatio = currentATR / avgATR;
        const explosionFlag = explosionRatio >= this.config.explosionMultiplier;

        return {
            flag: explosionFlag,
            strength: explosionRatio
        };
    }

    /**
     * Determine risk level based on volatility metrics
     */
    determineRiskLevel(volatilityData) {
        const { volatilityScore, explosionFlag, explosionStrength } = volatilityData;

        if (explosionFlag || explosionStrength > 4.0) {
            return 'EXTREME';
        } else if (volatilityScore > 0.8) {
            return 'HIGH';
        } else if (volatilityScore > 0.5) {
            return 'MEDIUM';
        } else if (volatilityScore > 0.2) {
            return 'LOW';
        } else {
            return 'VERY_LOW';
        }
    }

    /**
     * Update ATR history for normalization
     */
    updateATRHistory(timeframe, atr) {
        if (!this.atrHistory[timeframe]) {
            this.atrHistory[timeframe] = [];
        }

        this.atrHistory[timeframe].push(atr);

        // Keep only recent history to prevent memory bloat
        const maxHistorySize = this.config.rollingWindowSize * 2;
        if (this.atrHistory[timeframe].length > maxHistorySize) {
            this.atrHistory[timeframe] = this.atrHistory[timeframe].slice(-this.config.rollingWindowSize);
        }
    }

    /**
     * Get ATR history statistics for metadata
     */
    getATRHistoryStats() {
        const stats = {};

        for (const [timeframe, history] of Object.entries(this.atrHistory)) {
            if (history.length > 0) {
                stats[timeframe] = {
                    count: history.length,
                    current: history[history.length - 1],
                    avg: history.reduce((sum, val) => sum + val, 0) / history.length,
                    max: Math.max(...history),
                    min: Math.min(...history)
                };
            }
        }

        return stats;
    }

    /**
     * Validation and helper methods
     */
    isValidCandleData(candleData) {
        if (!candleData || typeof candleData !== 'object') {
            return false;
        }

        // Check if at least ONE timeframe has minimum required candles
        for (const [timeframe, candles] of Object.entries(candleData)) {
            if (candles && Array.isArray(candles) && candles.length >= this.config.minCandlesRequired) {
                return true;
            }
        }

        return false;
    }

    getEmptyVolatility() {
        return {
            timestamp: new Date().toISOString(),
            atr1s: 0,
            atr5s: 0,
            atr15s: 0,
            volatilityScore: 0,
            explosionFlag: false,
            explosionStrength: 0,
            riskLevel: 'UNKNOWN',
            metadata: {
                candleCounts: {},
                atrHistory: {}
            }
        };
    }

    /**
     * Reset historical data (useful for testing)
     */
    reset() {
        this.atrHistory = {
            '1s': [],
            '5s': [],
            '15s': []
        };
    }
}

export default VolatilityEngine;
