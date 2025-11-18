// src/config/index.js
import paths from "./paths.js";

const CONFIG = {
  market: {
    venue: "BYBIT_LINEAR_PERP",
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "AI16ZUSDT", "DOGEUSDT"],
    categories: {
      "Prime": ["BTCUSDT", "ETHUSDT"],
      "Normal": ["SOLUSDT", "ADAUSDT"],
      "Wild": ["AI16ZUSDT", "DOGEUSDT"]
    }
  },

  execution: {
    mode: "SIM", // SIM | DRY_RUN | LIVE
    maxSlippagePct: 0.10,
    maxSpreadPct: 0.15,
    orderTimeoutMs: 120000,
    maxRetryCount: 3,
    minNotionalUsd: 5,
    maxNotionalUsd: 500
  },

  risk: {
    riskPerTrade: 0.02,
    maxPortfolioHeat: 0.06,
    dailyLossLimit: 0.10,
    unrealizedLimit: 0.05,
  },

  scoring: {
    watchThreshold: 60,
    armThreshold: 80,
  },

  latency: {
    latencyPriceBufferPct: 0.02,
  },

  fees: {
    maker: 0.0002,
    taker: 0.00055,
  },

  bybit: {
    restBase: "https://api.bybit.com",
    wsPublic: "wss://stream.bybit.com/v5/public/linear",
    wsPrivate: "wss://stream.bybit.com/v5/private",
    apiKey: "",
    apiSecret: "",
  },

  health: {
    updateIntervalMs: 5000,
    checkIntervalMs: 30000,
    services: [
      "config",
      "marketData",
      "featureEngine",
      "regimeEngine",
      "scoringEngine",
      "stateMachine",
      "riskEngine",
      "executionEngine"
    ]
  },

  system: {
    retentionIntervalMs: 1000 * 60 * 60,
    logLevel: "info"
  },

  paths,
};

export default CONFIG;
