/**
 * SYSTEM HEALTH DIAGNOSTICS
 * Comprehensive health checks that detect problems INSTANTLY
 */

import * as OrderbookManager from '../microstructure/OrderbookManager.js';

/**
 * Run all diagnostic checks
 * @returns {Object} Complete health report with all issues
 */
export async function runFullDiagnostics(featureEngine) {
    const report = {
        timestamp: new Date().toISOString(),
        overall: 'HEALTHY',
        issues: [],
        warnings: [],
        checks: {}
    };

    // Check 1: WebSocket Data Flow
    const wsCheck = checkWebSocketDataFlow();
    report.checks.websocket = wsCheck;
    if (wsCheck.status === 'ERROR') {
        report.issues.push(wsCheck.message);
        report.overall = 'CRITICAL';
    }

    // Check 2: Orderbook Depth
    const depthCheck = checkOrderbookDepth();
    report.checks.orderbookDepth = depthCheck;
    if (depthCheck.status === 'ERROR') {
        report.issues.push(depthCheck.message);
        report.overall = 'CRITICAL';
    } else if (depthCheck.status === 'WARNING') {
        report.warnings.push(depthCheck.message);
        if (report.overall === 'HEALTHY') report.overall = 'DEGRADED';
    }

    // Check 3: Feature Engine Processing
    if (featureEngine) {
        const feCheck = checkFeatureEngine(featureEngine);
        report.checks.featureEngine = feCheck;
        if (feCheck.status === 'ERROR') {
            report.issues.push(feCheck.message);
            report.overall = 'CRITICAL';
        }
    }

    // Check 4: Wall Detection
    if (featureEngine) {
        const wallCheck = checkWallDetection(featureEngine);
        report.checks.wallDetection = wallCheck;
        if (wallCheck.status === 'WARNING') {
            report.warnings.push(wallCheck.message);
            if (report.overall === 'HEALTHY') report.overall = 'DEGRADED';
        }
    }

    // Check 5: Data Format Validation
    const formatCheck = checkDataFormats();
    report.checks.dataFormats = formatCheck;
    if (formatCheck.status === 'ERROR') {
        report.issues.push(formatCheck.message);
        report.overall = 'CRITICAL';
    }

    return report;
}

/**
 * Check WebSocket data flow
 */
function checkWebSocketDataFlow() {
    const activeSymbols = OrderbookManager.getActiveSymbols();

    if (activeSymbols.length === 0) {
        return {
            status: 'ERROR',
            message: '❌ NO WEBSOCKET DATA! Active symbols = 0. Check WebSocket connection.',
            activeSymbols: 0
        };
    }

    if (activeSymbols.length < 50) {
        return {
            status: 'WARNING',
            message: `⚠️ Low active symbols (${activeSymbols.length}). Expected 300+.`,
            activeSymbols: activeSymbols.length
        };
    }

    return {
        status: 'OK',
        message: `✅ WebSocket data flowing (${activeSymbols.length} symbols)`,
        activeSymbols: activeSymbols.length
    };
}

/**
 * Check orderbook depth (CRITICAL for wall detection)
 */
function checkOrderbookDepth() {
    const activeSymbols = OrderbookManager.getActiveSymbols();

    if (activeSymbols.length === 0) {
        return {
            status: 'ERROR',
            message: '❌ No orderbook data available',
            avgDepth: 0
        };
    }

    // Sample first 10 symbols
    const samples = activeSymbols.slice(0, 10).map(symbol => {
        const ob = OrderbookManager.getOrderbookSummary(symbol, 50);
        return {
            symbol,
            bidLevels: ob?.bids?.length || 0,
            askLevels: ob?.asks?.length || 0
        };
    });

    const avgDepth = samples.reduce((sum, s) => sum + s.bidLevels + s.askLevels, 0) / (samples.length * 2);

    if (avgDepth < 2) {
        return {
            status: 'ERROR',
            message: `❌ INSUFFICIENT ORDERBOOK DEPTH! Average: ${avgDepth.toFixed(1)} levels. Need 20+ for wall detection. Check WebSocket subscription (should be orderbook.50, not orderbook.1)`,
            avgDepth,
            samples
        };
    }

    if (avgDepth < 5) {
        return {
            status: 'WARNING',
            message: `⚠️ Low orderbook depth (${avgDepth.toFixed(1)} levels). Wall detection will be limited. May be starting up - wait 30s and refresh.`,
            avgDepth,
            samples
        };
    }

    return {
        status: 'OK',
        message: `✅ Orderbook depth sufficient (${avgDepth.toFixed(1)} levels average)`,
        avgDepth,
        samples: samples.slice(0, 3) // Show just 3 examples
    };
}

/**
 * Check Feature Engine processing
 */
function checkFeatureEngine(featureEngine) {
    const health = featureEngine.getHealthStatus();

    // Check if Feature Engine is actually processing symbols
    if (!health.activeSymbols || health.activeSymbols === 0) {
        return {
            status: 'ERROR',
            message: '❌ Feature Engine NOT RUNNING (no active symbols)',
            activeSymbols: health.activeSymbols,
            totalSymbols: health.totalSymbols
        };
    }

    if (health.activeSymbols < 50) {
        return {
            status: 'WARNING',
            message: `⚠️ Feature Engine low activity (${health.activeSymbols} active symbols)`,
            activeSymbols: health.activeSymbols,
            totalSymbols: health.totalSymbols
        };
    }

    return {
        status: 'OK',
        message: `✅ Feature Engine processing (${health.activeSymbols} active symbols, ${health.totalSymbols} total)`,
        activeSymbols: health.activeSymbols,
        totalSymbols: health.totalSymbols,
        engines: health.engines
    };
}

/**
 * Check wall detection functionality
 */
function checkWallDetection(featureEngine) {
    const overview = featureEngine.getFeaturesOverview();
    const symbolsWithWalls = overview.filter(s =>
        s.spoofingScore > 0 ||
        (s.walls && (s.walls.hasBidWall || s.walls.hasAskWall))
    ).length;

    const avgSpoofing = overview.reduce((sum, s) => sum + (s.spoofingScore || 0), 0) / overview.length;

    // If we have good orderbook depth but NO walls detected at all, something is wrong
    if (symbolsWithWalls === 0 && overview.length > 100) {
        return {
            status: 'WARNING',
            message: '⚠️ Wall detection may not be working. 0 walls detected across all symbols. Check thresholds.',
            symbolsWithWalls: 0,
            avgSpoofingScore: 0,
            totalSymbols: overview.length
        };
    }

    return {
        status: 'OK',
        message: `✅ Wall detection active (${symbolsWithWalls} symbols with walls, avg score: ${avgSpoofing.toFixed(3)})`,
        symbolsWithWalls,
        avgSpoofingScore: avgSpoofing,
        totalSymbols: overview.length
    };
}

/**
 * Check data format consistency (arrays vs objects)
 */
function checkDataFormats() {
    const activeSymbols = OrderbookManager.getActiveSymbols();

    if (activeSymbols.length === 0) {
        return {
            status: 'ERROR',
            message: '❌ No data to validate',
            validSymbols: 0
        };
    }

    // Check format of first few symbols
    const samples = activeSymbols.slice(0, 5);
    const formatIssues = [];

    for (const symbol of samples) {
        const ob = OrderbookManager.getOrderbookSummary(symbol, 10);

        if (!ob) continue;

        // Check if bids/asks are arrays of arrays (correct format)
        if (ob.bids && ob.bids.length > 0) {
            const firstBid = ob.bids[0];
            if (!Array.isArray(firstBid)) {
                formatIssues.push({
                    symbol,
                    issue: 'Bids not in [price, qty] array format',
                    actualFormat: typeof firstBid
                });
            }
        }
    }

    if (formatIssues.length > 0) {
        return {
            status: 'ERROR',
            message: '❌ DATA FORMAT ERROR! Orderbook not in [price, qty] array format',
            issues: formatIssues
        };
    }

    return {
        status: 'OK',
        message: '✅ Data formats valid',
        samplesChecked: samples.length
    };
}

/**
 * Get quick status summary (for dashboard)
 */
export function getQuickStatus() {
    const activeSymbols = OrderbookManager.getActiveSymbols();

    // Sample orderbook depth
    let avgDepth = 0;
    if (activeSymbols.length > 0) {
        const samples = activeSymbols.slice(0, 5);
        avgDepth = samples.reduce((sum, symbol) => {
            const ob = OrderbookManager.getOrderbookSummary(symbol, 50);
            return sum + (ob?.bids?.length || 0);
        }, 0) / samples.length;
    }

    return {
        wsActive: activeSymbols.length > 0,
        activeSymbols: activeSymbols.length,
        orderbookDepth: Math.round(avgDepth),
        status: activeSymbols.length > 100 && avgDepth > 10 ? 'HEALTHY' :
                activeSymbols.length > 0 ? 'DEGRADED' : 'CRITICAL'
    };
}
