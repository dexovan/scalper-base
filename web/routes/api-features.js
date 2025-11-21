// =======================================
// web/routes/api-features.js — FAZA 4 Feature Engine API
// =======================================

import express from "express";
import FeatureEngine from "../../src/features/featureEngine.js";

const router = express.Router();
const featureEngine = new FeatureEngine();

/* ---------------------------------------------------------
   MIDDLEWARE: JSON Response Wrapper
--------------------------------------------------------- */
const jsonResponse = (res, data, status = 200) => {
  return res.status(status).json({
    timestamp: new Date().toISOString(),
    status: status >= 200 && status < 300 ? "success" : "error",
    data
  });
};

const jsonError = (res, message, status = 500, error = null) => {
  return res.status(status).json({
    timestamp: new Date().toISOString(),
    status: "error",
    message,
    error: error ? error.message : null
  });
};

/* ---------------------------------------------------------
   GET /api/features/health — Feature Engine Health Check
--------------------------------------------------------- */
router.get("/health", (req, res) => {
  try {
    const health = featureEngine.getHealthStatus();
    jsonResponse(res, health);
  } catch (error) {
    console.error("Feature Engine health check failed:", error);
    jsonError(res, "Feature Engine health check failed", 500, error);
  }
});

/* ---------------------------------------------------------
   GET /api/features/overview — All Symbols Overview
--------------------------------------------------------- */
router.get("/overview", (req, res) => {
  try {
    const overview = featureEngine.getFeaturesOverview();
    jsonResponse(res, overview);
  } catch (error) {
    console.error("Failed to get features overview:", error);
    jsonError(res, "Failed to get features overview", 500, error);
  }
});

/* ---------------------------------------------------------
   GET /api/features/performance — Performance Metrics
--------------------------------------------------------- */
router.get("/performance", (req, res) => {
  try {
    const performance = featureEngine.getPerformanceMetrics();
    jsonResponse(res, performance);
  } catch (error) {
    console.error("Failed to get performance metrics:", error);
    jsonError(res, "Failed to get performance metrics", 500, error);
  }
});

/* ---------------------------------------------------------
   GET /api/features/symbol/:symbol — Single Symbol Features
--------------------------------------------------------- */
router.get("/symbol/:symbol", (req, res) => {
  try {
    const { symbol } = req.params;

    if (!symbol) {
      return jsonError(res, "Symbol parameter is required", 400);
    }

    const features = featureEngine.getFeaturesForSymbol(symbol);

    if (!features) {
      return jsonError(res, `No features found for symbol ${symbol}`, 404);
    }

    jsonResponse(res, {
      symbol,
      features,
      timestamp: features.timestamp
    });
  } catch (error) {
    console.error(`Failed to get features for symbol ${req.params.symbol}:`, error);
    jsonError(res, `Failed to get features for symbol ${req.params.symbol}`, 500, error);
  }
});

/* ---------------------------------------------------------
   POST /api/features/update/:symbol — Update Single Symbol
--------------------------------------------------------- */
router.post("/update/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const { marketData } = req.body;

    if (!symbol) {
      return jsonError(res, "Symbol parameter is required", 400);
    }

    if (!marketData) {
      return jsonError(res, "Market data is required in request body", 400);
    }

    // Update features for symbol
    const result = await featureEngine.updateFeaturesForSymbol(symbol, marketData);

    jsonResponse(res, {
      symbol,
      updated: true,
      features: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Failed to update features for symbol ${req.params.symbol}:`, error);
    jsonError(res, `Failed to update features for symbol ${req.params.symbol}`, 500, error);
  }
});

/* ---------------------------------------------------------
   POST /api/features/bulk-update — Update Multiple Symbols
--------------------------------------------------------- */
router.post("/bulk-update", async (req, res) => {
  try {
    const { updates } = req.body;

    if (!updates || !Array.isArray(updates)) {
      return jsonError(res, "Updates array is required in request body", 400);
    }

    const results = [];
    const errors = [];

    // Process each update
    for (const update of updates) {
      try {
        const { symbol, marketData } = update;

        if (!symbol || !marketData) {
          errors.push({ symbol: symbol || 'unknown', error: 'Symbol and marketData are required' });
          continue;
        }

        const result = await featureEngine.updateFeaturesForSymbol(symbol, marketData);
        results.push({
          symbol,
          updated: true,
          features: result
        });
      } catch (error) {
        errors.push({
          symbol: update.symbol || 'unknown',
          error: error.message
        });
      }
    }

    jsonResponse(res, {
      processed: updates.length,
      successful: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Failed to process bulk update:", error);
    jsonError(res, "Failed to process bulk update", 500, error);
  }
});

/* ---------------------------------------------------------
   GET /api/features/risks — Risk Summary Across All Symbols
--------------------------------------------------------- */
router.get("/risks", (req, res) => {
  try {
    const overview = featureEngine.getFeaturesOverview();

    // Extract risk data from overview
    const risks = {
      highRiskSymbols: [],
      mediumRiskSymbols: [],
      lowRiskSymbols: [],
      totalSymbols: overview.totalSymbols,
      avgRiskScore: overview.avgRiskScore,
      maxRiskScore: 0,
      riskDistribution: {
        high: 0,
        medium: 0,
        low: 0
      }
    };

    // Process each symbol's risk
    for (const [symbol, data] of Object.entries(overview.symbols || {})) {
      const riskScore = data.overallRiskScore || 0;
      risks.maxRiskScore = Math.max(risks.maxRiskScore, riskScore);

      if (riskScore >= 0.7) {
        risks.highRiskSymbols.push({ symbol, riskScore, features: data });
        risks.riskDistribution.high++;
      } else if (riskScore >= 0.4) {
        risks.mediumRiskSymbols.push({ symbol, riskScore, features: data });
        risks.riskDistribution.medium++;
      } else {
        risks.lowRiskSymbols.push({ symbol, riskScore, features: data });
        risks.riskDistribution.low++;
      }
    }

    // Sort by risk score (descending)
    risks.highRiskSymbols.sort((a, b) => b.riskScore - a.riskScore);
    risks.mediumRiskSymbols.sort((a, b) => b.riskScore - a.riskScore);

    jsonResponse(res, risks);
  } catch (error) {
    console.error("Failed to get risk summary:", error);
    jsonError(res, "Failed to get risk summary", 500, error);
  }
});

/* ---------------------------------------------------------
   POST /api/features/reset — Reset Feature Engine State
--------------------------------------------------------- */
router.post("/reset", (req, res) => {
  try {
    const { symbol } = req.body;

    if (symbol) {
      // Reset specific symbol
      featureEngine.resetSymbol(symbol);
      jsonResponse(res, {
        message: `Feature engine state reset for symbol ${symbol}`,
        symbol
      });
    } else {
      // Reset all
      featureEngine.reset();
      jsonResponse(res, {
        message: "Feature engine state reset for all symbols"
      });
    }
  } catch (error) {
    console.error("Failed to reset feature engine:", error);
    jsonError(res, "Failed to reset feature engine", 500, error);
  }
});

/* ---------------------------------------------------------
   GET /api/features/config — Get Engine Configuration
--------------------------------------------------------- */
router.get("/config", (req, res) => {
  try {
    const config = {
      throttling: {
        tier1: "500ms",
        tier2: "1000ms",
        tier3: "2000ms"
      },
      concurrency: {
        maxConcurrent: 10,
        description: "Maximum concurrent feature calculations"
      },
      persistence: {
        saveInterval: "30000ms",
        autoSave: true,
        dataPath: "data/features"
      },
      features: {
        orderbookImbalance: "TOB and zone-based imbalance analysis",
        volatilityEngine: "Multi-timeframe ATR volatility analysis",
        feeLeverageEngine: "Profitability and risk calculations",
        flowDelta: "Buy/sell pressure and momentum tracking",
        wallsSpoofing: "Market manipulation detection",
        pumpPreSignals: "Early pump/dump signal detection"
      },
      version: "1.0.0",
      phase: "FAZA 4"
    };

    jsonResponse(res, config);
  } catch (error) {
    console.error("Failed to get feature engine config:", error);
    jsonError(res, "Failed to get feature engine config", 500, error);
  }
});

export default router;
