/**
 * ORDERBOOK IMBALANCE ENGINE
 *
 * Analyzes orderbook depth and calculates imbalance metrics:
 * - TOB (Top of Book) imbalance
 * - Zone-based imbalance analysis (short/mid/far)
 * - Confidence scoring
 * - Dominant side detection
 */

import logger from '../utils/logger.js';

class OrderbookImbalanceEngine {
    constructor(config = {}) {
        this.config = {
            // Zone definitions (% from mid price)
            zones: {
                short: { min: 0.0000, max: 0.0005 }, // 0.00% - 0.05%
                mid:   { min: 0.0005, max: 0.0015 }, // 0.05% - 0.15%
                far:   { min: 0.0015, max: 0.0040 }  // 0.15% - 0.40%
            },

            // Thresholds for dominant side detection
            dominantThreshold: 0.25,

            // Minimum depth for reliable calculations
            minDepthForConfidence: 1000, // USDT

            ...config
        };

        this.logger = logger.child({ component: 'OrderbookImbalance' });
    }

    /**
     * Calculate comprehensive imbalance analysis for a symbol
     * @param {Object} orderbookData - Orderbook data from microstructure
     * @returns {Object} Imbalance analysis result
     */
    analyzeImbalance(orderbookData) {
        try {
            if (!this.isValidOrderbook(orderbookData)) {
                // DEBUG: Log why validation failed
                if (!this._validationDebugLogged) {
                    this._validationDebugLogged = true;
                    console.log('[IMBALANCE DEBUG] Invalid orderbook:', {
                        hasOrderbook: !!orderbookData,
                        hasBids: !!orderbookData?.bids,
                        hasAsks: !!orderbookData?.asks,
                        bidsIsArray: Array.isArray(orderbookData?.bids),
                        asksIsArray: Array.isArray(orderbookData?.asks),
                        bidsLength: orderbookData?.bids?.length || 0,
                        asksLength: orderbookData?.asks?.length || 0
                    });
                }
                return this.getEmptyImbalance();
            }

            const { bids, asks, timestamp } = orderbookData;
            const midPrice = this.calculateMidPrice(bids, asks);

            // Calculate TOB imbalance
            const tobImbalance = this.calculateTOBImbalance(bids, asks);

            // DEBUG: Log successful calculation
            if (!this._successDebugLogged) {
                this._successDebugLogged = true;
                console.log('[IMBALANCE DEBUG] Successful analysis:', {
                    tobImbalance,
                    bidsLength: bids.length,
                    asksLength: asks.length,
                    topBid: bids[0],
                    topAsk: asks[0]
                });
            }

            // Calculate zone-based imbalances
            const zoneImbalances = this.calculateZoneImbalances(bids, asks, midPrice);

            // Determine dominant side
            const imbalancedSide = this.determineDominantSide(tobImbalance);

            // Calculate confidence score
            const confidence = this.calculateConfidence(bids, asks, zoneImbalances);

            const result = {
                timestamp: timestamp || new Date().toISOString(),
                tobImbalance,
                zoneImbalanceShortTerm: zoneImbalances.short,
                zoneImbalanceMidTerm: zoneImbalances.mid,
                zoneImbalanceFarTerm: zoneImbalances.far,
                imbalancedSide,
                confidence,
                midPrice,
                metadata: {
                    bidLevels: bids.length,
                    askLevels: asks.length,
                    totalBidVolume: this.sumVolume(bids),
                    totalAskVolume: this.sumVolume(asks)
                }
            };

            return result;

        } catch (error) {
            this.logger.error('Error analyzing imbalance:', error);
            return this.getEmptyImbalance();
        }
    }

    /**
     * Calculate Top of Book imbalance
     * Formula: (bid_qty - ask_qty) / (bid_qty + ask_qty)
     * Range: -1 to +1
     */
    calculateTOBImbalance(bids, asks) {
        if (!bids.length || !asks.length) return 0;

        const bidQty = parseFloat(bids[0][1]);
        const askQty = parseFloat(asks[0][1]);

        if (bidQty + askQty === 0) return 0;

        return (bidQty - askQty) / (bidQty + askQty);
    }

    /**
     * Calculate zone-based imbalances
     */
    calculateZoneImbalances(bids, asks, midPrice) {
        const zones = {};

        for (const [zoneName, zoneConfig] of Object.entries(this.config.zones)) {
            const zoneBids = this.filterByZone(bids, midPrice, zoneConfig, 'bid');
            const zoneAsks = this.filterByZone(asks, midPrice, zoneConfig, 'ask');

            const bidVolume = this.sumVolume(zoneBids);
            const askVolume = this.sumVolume(zoneAsks);

            if (bidVolume + askVolume === 0) {
                zones[zoneName] = 0;
            } else {
                zones[zoneName] = (bidVolume - askVolume) / (bidVolume + askVolume);
            }
        }

        return zones;
    }

    /**
     * Filter orderbook entries by price zone
     */
    filterByZone(entries, midPrice, zoneConfig, side) {
        return entries.filter(([price, qty]) => {
            const priceNum = parseFloat(price);
            const distancePercent = Math.abs((priceNum - midPrice) / midPrice);

            // For bids, we want prices below midPrice within the zone
            // For asks, we want prices above midPrice within the zone
            const isInRange = distancePercent >= zoneConfig.min && distancePercent <= zoneConfig.max;

            if (side === 'bid') {
                return priceNum <= midPrice && isInRange;
            } else {
                return priceNum >= midPrice && isInRange;
            }
        });
    }

    /**
     * Calculate confidence score based on:
     * - Zone consistency (how many zones agree on direction)
     * - Total depth
     * - Spread quality
     */
    calculateConfidence(bids, asks, zoneImbalances) {
        let confidence = 0;

        // 1. Zone consistency (40% weight)
        const zoneValues = Object.values(zoneImbalances);
        const positiveZones = zoneValues.filter(v => v > 0.1).length;
        const negativeZones = zoneValues.filter(v => v < -0.1).length;
        const neutralZones = zoneValues.filter(v => Math.abs(v) <= 0.1).length;

        const maxDirection = Math.max(positiveZones, negativeZones);
        const zoneConsistency = maxDirection / zoneValues.length;
        confidence += zoneConsistency * 0.4;

        // 2. Total depth adequacy (30% weight)
        const totalDepth = this.sumVolume(bids) + this.sumVolume(asks);
        const depthScore = Math.min(totalDepth / this.config.minDepthForConfidence, 1);
        confidence += depthScore * 0.3;

        // 3. Spread quality (30% weight)
        if (bids.length && asks.length) {
            const spread = parseFloat(asks[0][0]) - parseFloat(bids[0][0]);
            const midPrice = this.calculateMidPrice(bids, asks);
            const spreadPercent = spread / midPrice;

            // Tighter spread = higher confidence
            const spreadScore = Math.max(0, 1 - (spreadPercent * 1000)); // Normalize for crypto
            confidence += spreadScore * 0.3;
        }

        return Math.min(confidence, 1);
    }

    /**
     * Determine which side is dominant based on TOB imbalance
     */
    determineDominantSide(tobImbalance) {
        if (tobImbalance > this.config.dominantThreshold) {
            return 'BUY';
        } else if (tobImbalance < -this.config.dominantThreshold) {
            return 'SELL';
        } else {
            return 'NONE';
        }
    }

    /**
     * Helper methods
     */
    calculateMidPrice(bids, asks) {
        if (!bids.length || !asks.length) return 0;

        const bestBid = parseFloat(bids[0][0]);
        const bestAsk = parseFloat(asks[0][0]);

        return (bestBid + bestAsk) / 2;
    }

    sumVolume(entries) {
        return entries.reduce((sum, [price, qty]) => sum + parseFloat(qty), 0);
    }

    isValidOrderbook(orderbook) {
        return orderbook &&
               orderbook.bids &&
               orderbook.asks &&
               Array.isArray(orderbook.bids) &&
               Array.isArray(orderbook.asks) &&
               orderbook.bids.length > 0 &&
               orderbook.asks.length > 0;
    }

    getEmptyImbalance() {
        return {
            timestamp: new Date().toISOString(),
            tobImbalance: 0,
            zoneImbalanceShortTerm: 0,
            zoneImbalanceMidTerm: 0,
            zoneImbalanceFarTerm: 0,
            imbalancedSide: 'NONE',
            confidence: 0,
            midPrice: 0,
            metadata: {
                bidLevels: 0,
                askLevels: 0,
                totalBidVolume: 0,
                totalAskVolume: 0
            }
        };
    }
}

export default OrderbookImbalanceEngine;
