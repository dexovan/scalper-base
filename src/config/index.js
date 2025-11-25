// src/config/index.js
import paths from "./paths.js";

const CONFIG = {
  // Prime symbols for categorization
  primeSymbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],

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
    venue: "BYBIT_LINEAR_PERP",

    // API URLs (LIVE mode)
    restBaseUrl: "https://api.bybit.com",
    wsPrivateUrl: "wss://stream.bybit.com/v5/private",

    // Safety limits
    maxSlippagePct: 0.10,      // Max 0.10% slippage from best price
    maxSpreadPct: 0.15,        // Max 0.15% spread to allow order
    orderTimeoutMs: 120000,    // 2 minutes order timeout
    maxRetryCount: 3,          // Max retries on network errors

    // Notional limits
    minNotionalUsd: 5,         // Minimum $5 per order
    maxNotionalUsd: 500,       // Maximum $500 per order

    // Order ID prefix
    clientOrderIdPrefix: "AISCLP",

    // Panic behavior
    panicCloseOnGlobalPanic: true,
    safeModeOnNetworkErrors: true,

    // Fill simulation (SIM mode)
    simSlippageBps: 2,         // 0.02% simulated slippage
    simFillDelayMs: 50,        // 50ms simulated fill delay
  },

  risk: {
    riskPerTrade: 0.02,
    maxPortfolioHeat: 0.06,
    dailyLossLimit: 0.10,
    unrealizedLimit: 0.05,
  },

  scoring: {
    weights: {
      orderbook: 0.30,
      flow: 0.30,
      walls: 0.05,
      volatility: 0.05,
      feeEdge: 0.30,
      spoof: 0.3,
      pump: 0.3,
      news: 1.0
    },
    thresholds: {
      watchThreshold: 12,
      armThreshold: 22
    }
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

    // RECONNECT parametri za WS (opciono)
    wsReconnectBaseDelayMs: 1000,
    wsReconnectMaxDelayMs: 15000,
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
    logLevel: "info",
    universeRefreshIntervalMs: 15000,
    bybitWsReconnectDelayMs: 3000
  },

  microstructure: {
    maxOrderbookDepth: {
      prime: 100,
      normal: 50,
      wild: 20,
    },
    maxTradesPerSymbol: 2000,
    candleTimeframes: ["1s", "3s", "5s", "15s"],
    snapshotWriteIntervalMs: 2000, // svake 2s upis orderbook-a i candles-a
  },

  custom: {
    // Allow Universe v2 to provide Prime symbols automatically
    // primeSymbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"], // Commented out to use Universe v2
  },

  paths,
};

export default CONFIG;
