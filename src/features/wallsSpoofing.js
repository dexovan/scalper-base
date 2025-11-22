/**
 * WALLS & SPOOFING ENGINE
 *
 * Detects market manipulation patterns:
 * - Large walls (unusual concentration of orders)
 * - Spoofing (walls that disappear when price approaches)
 * - Order book manipulation
 * - Absorption analysis
 * - Wall strength and persistence tracking
 */

import logger from '../utils/logger.js';

class WallsSpoofingEngine {
    constructor(config = {}) {
        this.config = {
            // Wall detection multiplier (very low for testing - detects any above-average order)
            wallMultiplier: 2.0,  // Was 4.0 - now just 2x average

            // Minimum wall size (in USDT value) - very low for testing
            minWallSize: 100,  // Was 500 - now just $100

            // Wall tracking duration
            wallHistoryDuration: 30000, // 30 seconds

            // Spoof detection parameters
            spoofing: {
                minApproachDistance: 0.002,    // 0.2% price approach
                minWallDuration: 2000,         // 2 seconds minimum wall life
                maxDistanceFromPrice: 0.01,    // 1% max distance for tracking
                disappearanceThreshold: 0.3    // 30% size reduction = disappearance
            },

            // Absorption scoring
            absorption: {
                significantTradeThreshold: 0.1, // 10% of wall size
                timeWindow: 5000                // 5 seconds window
            },

            ...config
        };

        this.logger = logger.child({ component: 'WallsSpoofing' });

        // Wall tracking state
        this.wallHistory = [];
        this.activeSpoofTracking = new Map();
        this.absorptionEvents = [];
    }

    /**
     * Analyze walls and spoofing patterns
     * @param {Object} orderbookData - Current orderbook snapshot
     * @param {Array} recentTrades - Recent trade data
     * @param {number} currentPrice - Current market price
     * @returns {Object} Walls and spoofing analysis
     */
    analyzeWallsAndSpoofing(orderbookData, recentTrades = [], currentPrice = 0) {
        try {
            if (!this.isValidData(orderbookData, currentPrice)) {
                // DEBUG: Log validation failure
                if (!this._validationFailLogged) {
                    this._validationFailLogged = true;
                    this.logger.info('[WALLS DEBUG] Validation failed:', {
                        hasOrderbook: !!orderbookData,
                        hasBids: !!orderbookData?.bids,
                        hasAsks: !!orderbookData?.asks,
                        currentPrice,
                        bidsLength: orderbookData?.bids?.length || 0,
                        asksLength: orderbookData?.asks?.length || 0
                    });
                }
                return this.getEmptyAnalysis();
            }

            const { bids, asks, timestamp } = orderbookData;
            const now = Date.now();

            // Detect current walls
            const bidWalls = this.detectWalls(bids, 'bid', currentPrice);
            const askWalls = this.detectWalls(asks, 'ask', currentPrice);

            // DEBUG: Log wall detection
            if (!this._wallDebugLogged && (bidWalls.length > 0 || askWalls.length > 0)) {
                this._wallDebugLogged = true;
                this.logger.info('[WALLS DEBUG] Detected walls:', {
                    bidWalls: bidWalls.length,
                    askWalls: askWalls.length,
                    currentPrice,
                    topBidWall: bidWalls[0],
                    topAskWall: askWalls[0]
                });
            }

            // Update wall history
            this.updateWallHistory(bidWalls, askWalls, now);

            // Detect spoofing patterns
            const spoofingAnalysis = this.detectSpoofing(bidWalls, askWalls, currentPrice, now);

            // Analyze absorption events
            const absorptionAnalysis = this.analyzeAbsorption(recentTrades, currentPrice, now);

            // Calculate wall strengths and persistence
            const wallMetrics = this.calculateWallMetrics(bidWalls, askWalls);

            const result = {
                timestamp: timestamp || new Date().toISOString(),

                // Bid wall information
                hasBidWall: bidWalls.length > 0,
                bidWallPrice: bidWalls.length > 0 ? bidWalls[0].price : 0,
                bidWallStrength: bidWalls.length > 0 ? bidWalls[0].strength : 0,
                bidWallSize: bidWalls.length > 0 ? bidWalls[0].size : 0,

                // Ask wall information
                hasAskWall: askWalls.length > 0,
                askWallPrice: askWalls.length > 0 ? askWalls[0].price : 0,
                askWallStrength: askWalls.length > 0 ? askWalls[0].strength : 0,
                askWallSize: askWalls.length > 0 ? askWalls[0].size : 0,

                // Spoofing metrics
                spoofingScore: spoofingAnalysis.score,
                recentSpoofEvents: spoofingAnalysis.recentEvents,
                spoofOnBidSide: spoofingAnalysis.bidSideSpoof,
                spoofOnAskSide: spoofingAnalysis.askSideSpoof,

                // Absorption metrics
                absorptionScoreBid: absorptionAnalysis.bidAbsorption,
                absorptionScoreAsk: absorptionAnalysis.askAbsorption,

                // Advanced metrics
                wallPersistence: wallMetrics.persistence,
                manipulationRisk: this.calculateManipulationRisk(spoofingAnalysis, wallMetrics),

                metadata: {
                    totalBidWalls: bidWalls.length,
                    totalAskWalls: askWalls.length,
                    activeSpoofTrackers: this.activeSpoofTracking.size,
                    wallHistoryCount: this.wallHistory.length,
                    currentPrice
                }
            };

            return result;

        } catch (error) {
            this.logger.error('Error analyzing walls and spoofing:', error);
            return this.getEmptyAnalysis();
        }
    }

    /**
     * Detect walls in orderbook side
     */
    detectWalls(entries, side, currentPrice) {
        if (!entries || entries.length === 0) return [];

        const walls = [];

        // Calculate average quantity for comparison
        const quantities = entries.map(([price, qty]) => parseFloat(qty));
        const avgQuantity = quantities.reduce((sum, qty) => sum + qty, 0) / quantities.length;

        if (avgQuantity === 0) return [];

        // DEBUG: Log detection attempt periodically
        if (!this._wallDetectionLogged) {
            this._wallDetectionLogged = true;
            this.logger.info(`[WALLS DEBUG] Detection attempt on ${side} side:`, {
                levels: entries.length,
                avgQuantity,
                currentPrice,
                wallMultiplier: this.config.wallMultiplier,
                minWallSize: this.config.minWallSize,
                sample: entries.slice(0, 3).map(([p, q]) => ({ price: p, qty: q, usd: p * q }))
            });
        }

        // Find walls (quantities significantly above average)
        for (let i = 0; i < Math.min(entries.length, 20); i++) { // Check top 20 levels
            const [price, qty] = entries[i];
            const priceNum = parseFloat(price);
            const qtyNum = parseFloat(qty);

            // Check if this qualifies as a wall
            const strength = qtyNum / avgQuantity;
            const usdValue = qtyNum * priceNum;

            if (strength >= this.config.wallMultiplier && usdValue >= this.config.minWallSize) {
                // Calculate distance from current price
                const distancePercent = Math.abs(priceNum - currentPrice) / currentPrice;

                // Only track walls within reasonable distance
                if (distancePercent <= this.config.spoofing.maxDistanceFromPrice) {
                    walls.push({
                        side,
                        price: priceNum,
                        size: qtyNum,
                        usdValue,
                        strength,
                        distanceFromPrice: distancePercent,
                        level: i,
                        timestamp: Date.now()
                    });
                }
            }
        }

        // Sort by strength (strongest first)
        return walls.sort((a, b) => b.strength - a.strength);
    }

    /**
     * Update wall history for tracking persistence
     */
    updateWallHistory(bidWalls, askWalls, timestamp) {
        const allWalls = [...bidWalls, ...askWalls].map(wall => ({
            ...wall,
            timestamp
        }));

        // Add to history
        this.wallHistory.push({
            timestamp,
            walls: allWalls
        });

        // Cleanup old history
        const cutoff = timestamp - this.config.wallHistoryDuration;
        this.wallHistory = this.wallHistory.filter(entry => entry.timestamp > cutoff);
    }

    /**
     * Detect spoofing patterns
     */
    detectSpoofing(bidWalls, askWalls, currentPrice, timestamp) {
        let spoofingScore = 0;
        let recentEvents = 0;
        let bidSideSpoof = false;
        let askSideSpoof = false;

        // Check for wall disappearances (spoofing events)
        const allCurrentWalls = [...bidWalls, ...askWalls];

        // Track new walls
        for (const wall of allCurrentWalls) {
            const wallId = `${wall.side}_${wall.price.toFixed(6)}`;

            if (!this.activeSpoofTracking.has(wallId)) {
                this.activeSpoofTracking.set(wallId, {
                    initialSize: wall.size,
                    firstSeen: timestamp,
                    lastSeen: timestamp,
                    maxPriceApproach: wall.distanceFromPrice,
                    disappeared: false
                });
            } else {
                // Update existing tracker
                const tracker = this.activeSpoofTracking.get(wallId);
                tracker.lastSeen = timestamp;
                tracker.maxPriceApproach = Math.min(tracker.maxPriceApproach, wall.distanceFromPrice);
            }
        }

        // Check for disappeared walls (potential spoofs)
        const currentWallIds = new Set(allCurrentWalls.map(w => `${w.side}_${w.price.toFixed(6)}`));

        for (const [wallId, tracker] of this.activeSpoofTracking.entries()) {
            if (!currentWallIds.has(wallId) && !tracker.disappeared) {
                // Wall disappeared - check if it's a spoof
                const duration = tracker.lastSeen - tracker.firstSeen;
                const priceApproached = tracker.maxPriceApproach < this.config.spoofing.minApproachDistance;

                if (duration >= this.config.spoofing.minWallDuration && priceApproached) {
                    // This looks like spoofing!
                    spoofingScore += 0.3;
                    recentEvents += 1;

                    const side = wallId.split('_')[0];
                    if (side === 'bid') bidSideSpoof = true;
                    if (side === 'ask') askSideSpoof = true;

                    tracker.disappeared = true;

                    this.logger.info('Spoof detected:', {
                        wallId,
                        duration,
                        maxApproach: tracker.maxPriceApproach,
                        initialSize: tracker.initialSize
                    });
                }
            }
        }

        // Cleanup old trackers
        const cutoff = timestamp - this.config.wallHistoryDuration;
        for (const [wallId, tracker] of this.activeSpoofTracking.entries()) {
            if (tracker.lastSeen < cutoff) {
                this.activeSpoofTracking.delete(wallId);
            }
        }

        // Check for other manipulation patterns
        spoofingScore += this.detectOrderBookManipulation(bidWalls, askWalls);

        // Normalize spoofing score
        spoofingScore = Math.min(spoofingScore, 1.0);

        return {
            score: spoofingScore,
            recentEvents,
            bidSideSpoof,
            askSideSpoof
        };
    }

    /**
     * Detect other orderbook manipulation patterns
     */
    detectOrderBookManipulation(bidWalls, askWalls) {
        let manipulationScore = 0;

        // Pattern 1: Walls on both sides (squeeze setup)
        if (bidWalls.length > 0 && askWalls.length > 0) {
            const spread = askWalls[0].price - bidWalls[0].price;
            const midPrice = (askWalls[0].price + bidWalls[0].price) / 2;
            const spreadPercent = spread / midPrice;

            if (spreadPercent < 0.001) { // Very tight spread with walls
                manipulationScore += 0.2;
            }
        }

        // Pattern 2: Multiple walls at similar levels (layering)
        const checkLayering = (walls) => {
            if (walls.length < 2) return 0;

            let layeringScore = 0;
            for (let i = 1; i < walls.length; i++) {
                const priceDiff = Math.abs(walls[i].price - walls[i-1].price) / walls[i-1].price;
                if (priceDiff < 0.0005) { // Walls very close together
                    layeringScore += 0.1;
                }
            }
            return layeringScore;
        };

        manipulationScore += checkLayering(bidWalls);
        manipulationScore += checkLayering(askWalls);

        // Pattern 3: Single-sided dominance (potential spoof setup)
        if (bidWalls.length > 0 && askWalls.length === 0) {
            if (bidWalls[0].strength > 5) { // Very strong wall with no opposition
                manipulationScore += 0.15;
            }
        } else if (askWalls.length > 0 && bidWalls.length === 0) {
            if (askWalls[0].strength > 5) {
                manipulationScore += 0.15;
            }
        }

        // Pattern 4: Extreme size imbalance
        if (bidWalls.length > 0 && askWalls.length > 0) {
            const sizeRatio = bidWalls[0].size / askWalls[0].size;
            if (sizeRatio > 5 || sizeRatio < 0.2) { // 5x imbalance
                manipulationScore += 0.1;
            }
        }

        return manipulationScore;
    }

    /**
     * Analyze wall absorption by trades
     */
    analyzeAbsorption(recentTrades, currentPrice, timestamp) {
        let bidAbsorption = 0;
        let askAbsorption = 0;

        // Clean old absorption events
        const cutoff = timestamp - this.config.absorption.timeWindow;
        this.absorptionEvents = this.absorptionEvents.filter(event => event.timestamp > cutoff);

        // Analyze recent trades for absorption
        for (const trade of recentTrades) {
            const tradePrice = parseFloat(trade.price);
            const tradeSize = parseFloat(trade.size || trade.quantity || 0);
            const tradeTime = new Date(trade.timestamp).getTime();

            if (tradeTime < cutoff) continue;

            // Check if trade hit any walls
            const isNearCurrentPrice = Math.abs(tradePrice - currentPrice) / currentPrice < 0.001;

            if (isNearCurrentPrice && tradeSize > this.config.absorption.significantTradeThreshold * 1000) {
                // Significant trade near current price
                if (trade.side === 'buy' || trade.isBuyerMaker === false) {
                    askAbsorption += 0.1;
                } else {
                    bidAbsorption += 0.1;
                }

                this.absorptionEvents.push({
                    timestamp: tradeTime,
                    price: tradePrice,
                    size: tradeSize,
                    side: trade.side
                });
            }
        }

        return {
            bidAbsorption: Math.min(bidAbsorption, 1.0),
            askAbsorption: Math.min(askAbsorption, 1.0)
        };
    }

    /**
     * Calculate wall metrics (persistence, strength)
     */
    calculateWallMetrics(bidWalls, askWalls) {
        // Calculate persistence based on wall history
        let persistence = 0;

        if (this.wallHistory.length >= 2) {
            const recentHistories = this.wallHistory.slice(-5); // Last 5 snapshots
            let consistentWalls = 0;
            let totalChecks = 0;

            for (const history of recentHistories) {
                for (const wall of history.walls) {
                    totalChecks++;

                    // Check if similar wall exists in current snapshot
                    const currentWalls = [...bidWalls, ...askWalls];
                    const similarWall = currentWalls.find(current =>
                        current.side === wall.side &&
                        Math.abs(current.price - wall.price) / wall.price < 0.001 // Within 0.1%
                    );

                    if (similarWall) {
                        consistentWalls++;
                    }
                }
            }

            persistence = totalChecks > 0 ? consistentWalls / totalChecks : 0;
        }

        return { persistence };
    }

    /**
     * Calculate overall manipulation risk
     */
    calculateManipulationRisk(spoofingAnalysis, wallMetrics) {
        let riskScore = 0;

        // Spoofing contributes heavily to risk
        riskScore += spoofingAnalysis.score * 0.6;

        // Recent spoof events
        riskScore += Math.min(spoofingAnalysis.recentEvents * 0.1, 0.3);

        // Low wall persistence indicates potential manipulation
        riskScore += (1 - wallMetrics.persistence) * 0.1;

        return Math.min(riskScore, 1.0);
    }

    /**
     * Helper methods
     */
    isValidData(orderbookData, currentPrice) {
        return orderbookData &&
               orderbookData.bids &&
               orderbookData.asks &&
               currentPrice > 0;
    }

    getEmptyAnalysis() {
        return {
            timestamp: new Date().toISOString(),
            hasBidWall: false,
            bidWallPrice: 0,
            bidWallStrength: 0,
            bidWallSize: 0,
            hasAskWall: false,
            askWallPrice: 0,
            askWallStrength: 0,
            askWallSize: 0,
            spoofingScore: 0,
            recentSpoofEvents: 0,
            spoofOnBidSide: false,
            spoofOnAskSide: false,
            absorptionScoreBid: 0,
            absorptionScoreAsk: 0,
            wallPersistence: 0,
            manipulationRisk: 0,
            metadata: {
                totalBidWalls: 0,
                totalAskWalls: 0,
                activeSpoofTrackers: 0,
                wallHistoryCount: 0,
                currentPrice: 0
            }
        };
    }

    /**
     * Reset internal state (useful for testing)
     */
    reset() {
        this.wallHistory = [];
        this.activeSpoofTracking = new Map();
        this.absorptionEvents = [];
    }
}

export default WallsSpoofingEngine;
