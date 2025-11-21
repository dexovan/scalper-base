/**
 * FEE & LEVERAGE ENGINE
 *
 * Calculates profitability and risk metrics:
 * - Fee calculations (maker/taker)
 * - Minimum move for profit
 * - Slippage estimation
 * - Liquidation safety scoring
 * - Optimal leverage suggestions
 */

const logger = require('../utils/logger');

class FeeLeverageEngine {
    constructor(config = {}) {
        this.config = {
            // Default fee rates (can be overridden per symbol)
            defaultFees: {
                maker: 0.0001,    // 0.01%
                taker: 0.0004     // 0.04%
            },

            // Slippage estimation factors
            slippageFactors: {
                low: 0.0002,      // 0.02% for low volatility
                medium: 0.0005,   // 0.05% for medium volatility
                high: 0.0010,     // 0.10% for high volatility
                extreme: 0.0025   // 0.25% for extreme volatility
            },

            // Safety margins
            safetyMargins: {
                liquidation: 0.1,    // 10% safety margin from liquidation
                maxLeverage: 0.8     // Use max 80% of available leverage
            },

            // Minimum profit targets
            minProfitTargets: {
                maker: 0.0003,    // 0.03% minimum for maker trades
                taker: 0.0008     // 0.08% minimum for taker trades
            },

            ...config
        };

        this.logger = logger.child({ component: 'FeeLeverageEngine' });
    }

    /**
     * Analyze fee and leverage metrics for a symbol
     * @param {Object} params - Analysis parameters
     * @returns {Object} Fee and leverage analysis result
     */
    analyzeFeeAndLeverage(params) {
        try {
            const {
                symbol,
                symbolMeta = {},
                volatilityData = {},
                currentPrice = 0,
                customFees = {}
            } = params;

            if (!symbol || !currentPrice) {
                return this.getEmptyAnalysis();
            }

            // Get fee rates for this symbol
            const feeRates = this.getFeeRates(symbol, symbolMeta, customFees);

            // Calculate slippage estimation
            const slippage = this.estimateSlippage(volatilityData, currentPrice);

            // Calculate minimum moves for profit
            const minMoves = this.calculateMinimumMoves(feeRates, slippage, currentPrice);

            // Calculate leverage recommendations
            const leverageAnalysis = this.analyzeLeverage(symbolMeta, volatilityData);

            // Calculate liquidation safety
            const liquidationSafety = this.calculateLiquidationSafety(
                volatilityData,
                leverageAnalysis.defaultLeverage,
                symbolMeta.maxLeverage || 1
            );

            const result = {
                timestamp: new Date().toISOString(),
                symbol,
                assumedMakerFeeRate: feeRates.maker,
                assumedTakerFeeRate: feeRates.taker,
                estimatedSlippage: slippage.percentage,
                minMoveForProfitMaker: minMoves.maker,
                minMoveForProfitTaker: minMoves.taker,
                defaultLeverage: leverageAnalysis.defaultLeverage,
                maxSafeLeverage: leverageAnalysis.maxSafeLeverage,
                liqSafetyScore: liquidationSafety.score,
                riskAssessment: liquidationSafety.riskLevel,
                metadata: {
                    currentPrice,
                    volatilityRisk: volatilityData.riskLevel || 'UNKNOWN',
                    slippageEstimate: slippage,
                    leverageConstraints: leverageAnalysis.constraints
                }
            };

            return result;

        } catch (error) {
            this.logger.error('Error analyzing fee and leverage:', error);
            return this.getEmptyAnalysis();
        }
    }

    /**
     * Get fee rates for symbol (with fallbacks)
     */
    getFeeRates(symbol, symbolMeta, customFees) {
        return {
            maker: customFees.maker ||
                   symbolMeta.makerFee ||
                   this.config.defaultFees.maker,
            taker: customFees.taker ||
                   symbolMeta.takerFee ||
                   this.config.defaultFees.taker
        };
    }

    /**
     * Estimate slippage based on volatility
     */
    estimateSlippage(volatilityData, currentPrice) {
        const { volatilityScore = 0, riskLevel = 'MEDIUM', atr5s = 0 } = volatilityData;

        // Method 1: Based on risk level
        let slippageByRisk = this.config.slippageFactors.medium; // Default

        switch (riskLevel) {
            case 'VERY_LOW':
            case 'LOW':
                slippageByRisk = this.config.slippageFactors.low;
                break;
            case 'MEDIUM':
                slippageByRisk = this.config.slippageFactors.medium;
                break;
            case 'HIGH':
                slippageByRisk = this.config.slippageFactors.high;
                break;
            case 'EXTREME':
                slippageByRisk = this.config.slippageFactors.extreme;
                break;
        }

        // Method 2: Based on ATR (more precise)
        let slippageByATR = 0;
        if (atr5s && currentPrice) {
            slippageByATR = (atr5s / currentPrice) * 0.5; // 50% of ATR as slippage
        }

        // Use the higher estimate for safety
        const finalSlippage = Math.max(slippageByRisk, slippageByATR);

        return {
            percentage: finalSlippage,
            absolute: finalSlippage * currentPrice,
            method: slippageByATR > slippageByRisk ? 'ATR-based' : 'Risk-based'
        };
    }

    /**
     * Calculate minimum price moves required for profitability
     */
    calculateMinimumMoves(feeRates, slippage, currentPrice) {
        const slippagePct = slippage.percentage;

        // For maker trades: (maker fee * 2) + slippage + safety margin
        const minMoveMaker = (feeRates.maker * 2) + slippagePct + this.config.minProfitTargets.maker;

        // For taker trades: (taker fee * 2) + slippage + safety margin
        const minMoveTaker = (feeRates.taker * 2) + slippagePct + this.config.minProfitTargets.taker;

        return {
            maker: minMoveMaker,
            taker: minMoveTaker,
            makerAbsolute: minMoveMaker * currentPrice,
            takerAbsolute: minMoveTaker * currentPrice
        };
    }

    /**
     * Analyze leverage options and recommendations
     */
    analyzeLeverage(symbolMeta, volatilityData) {
        const maxLeverage = symbolMeta.maxLeverage || 1;
        const volatilityScore = volatilityData.volatilityScore || 0.5;
        const riskLevel = volatilityData.riskLevel || 'MEDIUM';

        // Calculate default leverage based on volatility
        let defaultLeverage = 1;

        if (maxLeverage > 1) {
            // Start with max allowed, then reduce based on risk
            const baseMultiplier = this.config.safetyMargins.maxLeverage;

            switch (riskLevel) {
                case 'VERY_LOW':
                    defaultLeverage = Math.floor(maxLeverage * baseMultiplier);
                    break;
                case 'LOW':
                    defaultLeverage = Math.floor(maxLeverage * baseMultiplier * 0.8);
                    break;
                case 'MEDIUM':
                    defaultLeverage = Math.floor(maxLeverage * baseMultiplier * 0.6);
                    break;
                case 'HIGH':
                    defaultLeverage = Math.floor(maxLeverage * baseMultiplier * 0.4);
                    break;
                case 'EXTREME':
                    defaultLeverage = Math.floor(maxLeverage * baseMultiplier * 0.2);
                    break;
            }

            // Minimum leverage is 1x
            defaultLeverage = Math.max(1, defaultLeverage);
        }

        // Calculate maximum safe leverage (with liquidation buffer)
        const maxSafeLeverage = Math.floor(
            maxLeverage * (1 - this.config.safetyMargins.liquidation)
        );

        return {
            defaultLeverage,
            maxSafeLeverage: Math.max(1, maxSafeLeverage),
            constraints: {
                maxAvailable: maxLeverage,
                volatilityReduction: 1 - (volatilityScore * 0.5), // Higher vol = lower leverage
                riskLevel
            }
        };
    }

    /**
     * Calculate liquidation safety score
     */
    calculateLiquidationSafety(volatilityData, leverage, maxLeverage) {
        const { volatilityScore = 0.5, explosionFlag = false } = volatilityData;

        let safetyScore = 1.0;

        // Reduce safety based on leverage usage
        const leverageRatio = leverage / maxLeverage;
        safetyScore -= leverageRatio * 0.4; // Up to 40% reduction for max leverage

        // Reduce safety based on volatility
        safetyScore -= volatilityScore * 0.4; // Up to 40% reduction for max volatility

        // Severe penalty for volatility explosions
        if (explosionFlag) {
            safetyScore -= 0.3;
        }

        // Normalize to 0-1 range
        safetyScore = Math.max(0, Math.min(1, safetyScore));

        // Determine risk level
        let riskLevel;
        if (safetyScore >= 0.8) {
            riskLevel = 'VERY_SAFE';
        } else if (safetyScore >= 0.6) {
            riskLevel = 'SAFE';
        } else if (safetyScore >= 0.4) {
            riskLevel = 'MODERATE';
        } else if (safetyScore >= 0.2) {
            riskLevel = 'RISKY';
        } else {
            riskLevel = 'VERY_RISKY';
        }

        return {
            score: safetyScore,
            riskLevel
        };
    }

    /**
     * Calculate break-even price for a position
     */
    calculateBreakEven(entryPrice, side, leverage, feeRate, slippage) {
        const totalCost = (feeRate * 2) + slippage; // Round-trip fees + slippage
        const leveragedCost = totalCost / leverage; // Cost is reduced by leverage

        if (side === 'LONG') {
            return entryPrice * (1 + leveragedCost);
        } else {
            return entryPrice * (1 - leveragedCost);
        }
    }

    /**
     * Helper methods
     */
    getEmptyAnalysis() {
        return {
            timestamp: new Date().toISOString(),
            symbol: '',
            assumedMakerFeeRate: this.config.defaultFees.maker,
            assumedTakerFeeRate: this.config.defaultFees.taker,
            estimatedSlippage: 0,
            minMoveForProfitMaker: 0,
            minMoveForProfitTaker: 0,
            defaultLeverage: 1,
            maxSafeLeverage: 1,
            liqSafetyScore: 0,
            riskAssessment: 'UNKNOWN',
            metadata: {
                currentPrice: 0,
                volatilityRisk: 'UNKNOWN',
                slippageEstimate: { percentage: 0, absolute: 0, method: 'none' },
                leverageConstraints: {}
            }
        };
    }
}

export default FeeLeverageEngine;
