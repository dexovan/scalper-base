/* ============================================
   Dashboard Configuration
   Centralized API endpoints and settings
   ============================================ */

export const DashboardConfig = {
    // API Endpoints
    endpoints: {
        tickers: "/monitor/api/tickers",
        trades: "/monitor/api/trades",
        storage: "/monitor/api/storage",
        summary: "/monitor/api/summary",
        universe: "/api/universe",
        symbols: "/api/universe",
        microstructure: "/api/microstructure/symbols",
        featuresHealth: "/api/features/health",
    },

    // Update Intervals (milliseconds)
    intervals: {
        tickers: 2000,      // 2s
        trades: 3000,       // 3s
        storage: 10000,     // 10s
        universe: 30000,    // 30s
        microstructure: 5000, // 5s
        features: 5000,     // 5s
    },

    // Timeouts
    timeouts: {
        fetch: 30000,       // 30s fetch timeout
        default: 10000,     // 10s default timeout
    },

    // UI Settings
    ui: {
        maxRecentTrades: 25,
        defaultCategory: "Prime",
        animationDuration: 300,
    },

    // Debug mode
    debug: true,  // Set to false in production
};

// Helper function for logging (respects debug mode)
export function debugLog(message, ...args) {
    if (DashboardConfig.debug) {
        console.log(message, ...args);
    }
}

// Export default
export default DashboardConfig;
