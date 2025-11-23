# 🚀 API ENDPOINTS DOCUMENTATION - ENGINE API (Port 8090)

**Phase 4 Complete - November 23, 2025**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Monitor Endpoints](#monitor-endpoints)
3. [Symbol Data Endpoints](#symbol-data-endpoints)
4. [Microstructure Endpoints](#microstructure-endpoints)
5. [Feature Engine Endpoints](#feature-engine-endpoints)
6. [Diagnostics Endpoints](#diagnostics-endpoints)

---

## 🎯 Overview

**Engine API Server** runs on **port 8090** and provides direct access to the trading engine's internal state. This API is the source of truth for:

- Real-time market data
- Orderbook microstructure
- Feature calculations
- System diagnostics

**File Location:** `src/http/monitorApi.js`

**Process:** PM2 process `engine` (separate from dashboard)

**Base URL:** `http://localhost:8090`

---

## 📊 Monitor Endpoints

### 1. GET `/api/monitor/summary`

**Purpose:** Complete system overview with all metrics

**Use Case:** Main dashboard real-time stats

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "engine": {
      "uptime": 86400,
      "decisionCount": 15234,
      "ordersSent": 1523,
      "tradesExecuted": 456,
      "successRate": 0.78,
      "memoryUsageMB": 145.23
    },
    "websocket": {
      "mainConnection": {
        "connected": true,
        "subscribedSymbols": 312,
        "messagesReceived": 1523456,
        "lastMessageAt": "2025-11-23T14:29:58.000Z",
        "uptimeMs": 86400000
      },
      "metricsConnection": {
        "connected": true,
        "subscribedSymbols": 4,
        "messagesReceived": 45678,
        "lastMessageAt": "2025-11-23T14:29:59.000Z"
      }
    },
    "universe": {
      "totalSymbols": 312,
      "primeSymbols": 45,
      "normalSymbols": 234,
      "wildSymbols": 33
    },
    "microstructure": {
      "activeSymbols": 312,
      "totalOrderbookUpdates": 5623456,
      "totalTradeUpdates": 892345,
      "avgUpdateRatePerSecond": 2.1
    },
    "features": {
      "status": "running",
      "symbolsProcessed": 312,
      "lastUpdateAt": "2025-11-23T14:29:59.000Z"
    }
  }
}
```

**Used By:**

- `web/views/dashboard.ejs` - main dashboard overview
- `web/public/js/api-client.js` - fetchSystemSummary()

**Why It Exists:** Single endpoint for complete system health check and metrics aggregation

---

### 2. GET `/api/monitor/logs`

**Purpose:** Retrieve recent PM2 log entries

**Use Case:** Live log viewing in dashboard

**Query Parameters:**

- `lines` (optional, default: 200) - number of log lines to return

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "stdout": [
      "2025-11-23T14:29:59 [INFO] Feature Engine updated 312 symbols",
      "2025-11-23T14:29:58 [INFO] Orderbook update: BTCUSDT",
      "..."
    ],
    "stderr": ["2025-11-23T14:25:00 [WARN] Websocket reconnecting...", "..."],
    "logPath": "/home/aiuser/scalper-base/logs",
    "lineCount": {
      "stdout": 150,
      "stderr": 5
    }
  }
}
```

**Used By:**

- `web/views/monitor.ejs` - live log viewer

**Why It Exists:** Real-time debugging and monitoring without SSH access to server

---

### 3. GET `/api/monitor/tickers`

**Purpose:** Real-time price data for all symbols

**Use Case:** Live price updates on dashboard

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "tickers": {
      "BTCUSDT": {
        "symbol": "BTCUSDT",
        "price": 43250.5,
        "change24h": 2.34,
        "volume24h": 1523456789.45,
        "timestamp": "2025-11-23T14:29:59.000Z",
        "last24hUpdate": "2025-11-23T14:25:00.000Z",
        "source": "websocket"
      },
      "ETHUSDT": {
        "symbol": "ETHUSDT",
        "price": 2250.75,
        "change24h": -1.23,
        "volume24h": 523456789.12,
        "timestamp": "2025-11-23T14:29:59.000Z",
        "last24hUpdate": "2025-11-23T14:25:00.000Z",
        "source": "websocket"
      }
    },
    "count": 312,
    "lastUpdate": "2025-11-23T14:29:59.000Z"
  }
}
```

**Data Flow:**

1. WebSocket receives ticker events → stored in `latestTickers` Map
2. Bybit REST API refreshes 24h data every 60s
3. Endpoint merges real-time prices with 24h statistics

**Used By:**

- `web/views/markets.ejs` - markets table
- `web/public/js/api-client.js` - fetchTickers()

**Why It Exists:** Combine WebSocket real-time prices with REST API 24h statistics for complete ticker data

---

### 4. GET `/api/monitor/24h-status`

**Purpose:** Status of 24h data refresh mechanism

**Use Case:** Monitor health of REST API data fetching

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "running": true,
    "lastSuccessfulFetch": "2025-11-23T14:29:00.000Z",
    "retryCount": 0,
    "totalTickers": 312,
    "intervalSeconds": 60,
    "nextRefreshIn": 45
  }
}
```

**Used By:**

- `web/views/diagnostics.ejs` - system health monitoring

**Why It Exists:** Ensure 24h statistics (volume, change%) are being refreshed properly

---

### 5. GET `/api/monitor/test-fetch`

**Purpose:** Manually trigger 24h data fetch (testing/debugging)

**Use Case:** Force refresh of 24h data without waiting for interval

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:15.000Z",
  "status": "success",
  "message": "24h data fetch triggered successfully",
  "data": {
    "updated": 312,
    "created": 0,
    "skipped": 0,
    "duration": 1523
  }
}
```

**Used By:**

- Manual testing via curl/Postman
- Dashboard diagnostics panel

**Why It Exists:** Debug and test 24h data refresh mechanism

---

### 6. GET `/api/monitor/trades`

**Purpose:** Recent trades across all symbols

**Use Case:** Live trade feed display

**Query Parameters:**

- `limit` (optional, default: 100) - max number of trades to return

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "trades": [
      {
        "symbol": "BTCUSDT",
        "side": "Buy",
        "price": 43250.5,
        "quantity": 0.125,
        "timestamp": "2025-11-23T14:29:59.500Z",
        "tickDirection": "PlusTick"
      },
      {
        "symbol": "ETHUSDT",
        "side": "Sell",
        "price": 2250.25,
        "quantity": 1.5,
        "timestamp": "2025-11-23T14:29:59.450Z",
        "tickDirection": "MinusTick"
      }
    ],
    "count": 100,
    "lastUpdate": "2025-11-23T14:29:59.500Z"
  }
}
```

**Data Source:** WebSocket trade events stored in `recentTrades` ring buffer (max 100 trades)

**Used By:**

- `web/views/monitor.ejs` - live trade feed

**Why It Exists:** Show recent market activity across all monitored symbols

---

### 7. GET `/api/monitor/storage`

**Purpose:** Storage usage statistics

**Use Case:** Monitor disk space usage for data files

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "totalSizeMB": 1523.45,
    "fileCount": 8934,
    "directories": {
      "wsSnapshots": {
        "sizeMB": 523.12,
        "fileCount": 2456
      },
      "metrics": {
        "sizeMB": 234.56,
        "fileCount": 1234
      },
      "candles": {
        "sizeMB": 765.77,
        "fileCount": 5244
      }
    }
  }
}
```

**Used By:**

- `web/views/diagnostics.ejs` - system health panel

**Why It Exists:** Monitor disk space usage and prevent storage issues

---

### 8. GET `/api/monitor/universe`

**Purpose:** Complete universe snapshot with all symbols and metadata

**Use Case:** Universe management and symbol discovery

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "fetchedAt": "2025-11-23T14:00:00.000Z",
    "totalSymbols": 312,
    "stats": {
      "totalSymbols": 312,
      "primeSymbols": 45,
      "normalSymbols": 234,
      "wildSymbols": 33,
      "avgVolume24h": 5234567.89,
      "avgChange24h": 1.23
    },
    "symbols": [
      {
        "symbol": "BTCUSDT",
        "category": "Prime",
        "volume24h": 1523456789.45,
        "change24h": 2.34,
        "leverage": "50x",
        "takerFee": 0.0006,
        "makerFee": 0.0001
      }
    ]
  }
}
```

**Used By:**

- `web/views/markets.ejs` - full markets table
- Symbol selection dropdowns

**Why It Exists:** Centralized source of truth for all tradeable symbols and their properties

---

### 9. GET `/api/monitor/symbols/:category`

**Purpose:** Symbols filtered by category (Prime/Normal/Wild)

**Use Case:** Category-specific symbol lists

**Path Parameters:**

- `category` - "Prime", "Normal", or "Wild"

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "category": "Prime",
    "symbols": [
      {
        "symbol": "BTCUSDT",
        "volume24h": 1523456789.45,
        "change24h": 2.34,
        "leverage": "50x"
      }
    ],
    "count": 45
  }
}
```

**Used By:**

- Dashboard category filters
- Prime symbols watchlist

**Why It Exists:** Quick access to specific symbol categories without fetching entire universe

---

### 10. GET `/api/monitor/symbol/:symbol`

**Purpose:** Complete metadata for single symbol

**Use Case:** Symbol detail page, configuration display

**Path Parameters:**

- `symbol` - Symbol name (e.g., "BTCUSDT")

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "symbol": "BTCUSDT",
    "category": "Prime",
    "baseCurrency": "BTC",
    "quoteCurrency": "USDT",
    "leverage": "50x",
    "takerFee": 0.0006,
    "makerFee": 0.0001,
    "minOrderSize": 0.001,
    "priceFilter": {
      "minPrice": "0.50",
      "maxPrice": "999999.00",
      "tickSize": "0.50"
    },
    "lotSizeFilter": {
      "minQty": "0.001",
      "maxQty": "500.000",
      "stepSize": "0.001"
    },
    "volume24h": 1523456789.45,
    "change24h": 2.34,
    "lastUpdate": "2025-11-23T14:00:00.000Z"
  }
}
```

**Used By:**

- Symbol detail modals
- Trading configuration forms

**Why It Exists:** Detailed symbol information for UI display and validation

---

### 11. POST `/api/monitor/refresh-ws`

**Purpose:** Manually trigger WebSocket reconnection

**Use Case:** Force reconnect when WebSocket issues detected

**Request Body:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "message": "WebSocket refresh triggered",
  "data": {
    "previousState": "connected",
    "action": "reconnecting"
  }
}
```

**Used By:**

- `web/views/diagnostics.ejs` - manual controls
- Emergency recovery procedures

**Why It Exists:** Manual intervention for WebSocket connection issues

---

## 📈 Symbol Data Endpoints

### 12. GET `/api/symbol/:symbol/basic`

**Purpose:** Basic real-time data for symbol

**Use Case:** Quick symbol overview without full details

**Path Parameters:**

- `symbol` - Symbol name

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "symbol": "BTCUSDT",
    "price": 43250.5,
    "change24h": 2.34,
    "volume24h": 1523456789.45,
    "high24h": 43500.0,
    "low24h": 42800.0,
    "lastUpdate": "2025-11-23T14:29:59.000Z"
  }
}
```

**Used By:**

- Quick price checks
- Symbol cards in UI

**Why It Exists:** Lightweight endpoint for basic symbol data

---

### 13. GET `/api/symbols`

**Purpose:** List of all symbol names (simple array)

**Use Case:** Autocomplete, dropdowns

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "..."],
    "count": 312
  }
}
```

**Used By:**

- Search autocomplete
- Symbol selection dropdowns

**Why It Exists:** Simple list for UI components

---

### 14. GET `/api/monitor/symbols`

**Purpose:** All symbols with basic stats

**Use Case:** Markets table data

**Query Parameters:**

- `category` (optional) - Filter by category
- `minVolume` (optional) - Minimum 24h volume filter

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "symbols": [
      {
        "symbol": "BTCUSDT",
        "price": 43250.5,
        "change24h": 2.34,
        "volume24h": 1523456789.45,
        "category": "Prime"
      }
    ],
    "count": 312,
    "filters": {
      "category": null,
      "minVolume": null
    }
  }
}
```

**Used By:**

- `web/views/markets.ejs` - markets table

**Why It Exists:** Filtered and sorted symbol lists for UI tables

---

## 🔬 Microstructure Endpoints

### 15. GET `/api/symbol/:symbol/micro`

**Purpose:** Microstructure analysis for single symbol

**Use Case:** Detailed orderbook analysis display

**Path Parameters:**

- `symbol` - Symbol name

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "symbol": "BTCUSDT",
    "orderbook": {
      "bids": [
        [43250.0, 1.523],
        [43249.5, 0.234]
      ],
      "asks": [
        [43250.5, 0.456],
        [43251.0, 1.234]
      ],
      "spread": 0.5,
      "spreadBps": 1.16,
      "lastUpdate": "2025-11-23T14:29:59.500Z"
    },
    "imbalance": {
      "tob": 0.54,
      "zoneShort": 0.48,
      "zoneMid": 0.52,
      "zoneFar": 0.5
    },
    "trades": {
      "lastTrade": {
        "price": 43250.5,
        "quantity": 0.125,
        "side": "Buy",
        "timestamp": "2025-11-23T14:29:59.500Z"
      },
      "count1m": 234,
      "volume1m": 25.34
    }
  }
}
```

**Used By:**

- `web/views/monitor-micro.ejs` - microstructure dashboard
- Orderbook visualization charts

**Why It Exists:** Detailed microstructure analysis for trading decisions

---

### 16. GET `/api/symbol/:symbol/orderbook`

**Purpose:** Raw orderbook snapshot

**Use Case:** Orderbook display, depth charts

**Path Parameters:**

- `symbol` - Symbol name

**Query Parameters:**

- `depth` (optional, default: 20) - Number of levels per side

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "symbol": "BTCUSDT",
    "bids": [
      [43250.0, 1.523],
      [43249.5, 0.234],
      [43249.0, 2.456]
    ],
    "asks": [
      [43250.5, 0.456],
      [43251.0, 1.234],
      [43251.5, 0.789]
    ],
    "timestamp": "2025-11-23T14:29:59.500Z",
    "updateId": 1523456789
  }
}
```

**Used By:**

- Orderbook visualizations
- Depth chart rendering

**Why It Exists:** Clean orderbook data for UI display

---

### 17. GET `/api/symbol/:symbol/trades`

**Purpose:** Recent trades for specific symbol

**Use Case:** Trade history display

**Path Parameters:**

- `symbol` - Symbol name

**Query Parameters:**

- `limit` (optional, default: 50) - Max trades to return

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "symbol": "BTCUSDT",
    "trades": [
      {
        "price": 43250.5,
        "quantity": 0.125,
        "side": "Buy",
        "timestamp": "2025-11-23T14:29:59.500Z",
        "tickDirection": "PlusTick"
      }
    ],
    "count": 50
  }
}
```

**Used By:**

- Trade history tables
- Recent trades feed

**Why It Exists:** Symbol-specific trade history

---

### 18. GET `/api/symbol/:symbol/candles/:timeframe`

**Purpose:** Micro-candle data for symbol

**Use Case:** Chart rendering, technical analysis

**Path Parameters:**

- `symbol` - Symbol name
- `timeframe` - "1s", "3s", "5s", or "15s"

**Query Parameters:**

- `limit` (optional, default: 100) - Max candles to return

**Response Structure:**

```json
{
  "ok": true,
  "symbol": "BTCUSDT",
  "timeframe": "5s",
  "candles": [
    {
      "timestamp": "2025-11-23T14:29:55.000Z",
      "open": 43250.0,
      "high": 43252.5,
      "low": 43248.0,
      "close": 43250.5,
      "volume": 5.234,
      "trades": 45
    }
  ],
  "count": 100,
  "timestamp": "2025-11-23T14:30:00.000Z"
}
```

**Used By:**

- Chart components
- Technical indicators

**Why It Exists:** High-frequency candle data for micro-scalping analysis

---

### 19. GET `/api/microstructure/symbols`

**Purpose:** Microstructure summary for all symbols

**Use Case:** System-wide microstructure health check

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "totalSymbols": 312,
    "activeSymbols": 312,
    "summary": {
      "BTCUSDT": {
        "lastUpdate": "2025-11-23T14:29:59.500Z",
        "orderbookLevels": 20,
        "tradesCount": 234,
        "spread": 0.5
      }
    }
  }
}
```

**Used By:**

- System health monitoring
- Microstructure overview dashboard

**Why It Exists:** Monitor microstructure health across all symbols

---

### 20. GET `/api/microstructure/health`

**Purpose:** **CRITICAL** - Microstructure system health status

**Use Case:** Main health check for orderbook/trade processing

**Query Parameters:** None

**Response Structure:**

```json
{
  "ok": true,
  "timestamp": "2025-11-23T14:30:00.000Z",
  "activeSymbols": 312,
  "totalOrderbookUpdates": 5623456,
  "totalTradeUpdates": 892345,
  "eventsPerSecond": 624.5,
  "memoryUsageMB": 145.23,
  "uptimeSeconds": 86400
}
```

**Used By:**

- **Dashboard process via proxy** (`/api/engine/health`)
- `web/views/monitor-micro.ejs` - main metrics display
- System health checks

**Why It Exists:** **PRIMARY health endpoint** for microstructure monitoring - tracks all orderbook/trade processing

**IMPORTANT:** This endpoint is proxied by dashboard to avoid CORS issues

---

## 🧠 Feature Engine Endpoints

### 21. GET `/api/diagnostics`

**Purpose:** Complete system diagnostics

**Use Case:** Full system health check, debug information

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "healthy",
  "data": {
    "engine": {
      "uptime": 86400,
      "memoryUsageMB": 145.23,
      "cpuUsage": 12.5
    },
    "websocket": {
      "main": "connected",
      "metrics": "connected"
    },
    "microstructure": {
      "activeSymbols": 312,
      "health": "ok"
    },
    "features": {
      "status": "running",
      "symbolsProcessed": 312
    },
    "universe": {
      "totalSymbols": 312,
      "lastUpdate": "2025-11-23T14:00:00.000Z"
    }
  }
}
```

**Used By:**

- `web/views/diagnostics.ejs` - full diagnostics panel
- Health monitoring systems

**Why It Exists:** Single endpoint for complete system diagnostics

---

### 22. GET `/api/features/health`

**Purpose:** Feature Engine health status

**Use Case:** Monitor feature calculation status

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "status": "running",
    "symbolsProcessed": 312,
    "lastUpdateAt": "2025-11-23T14:29:59.000Z",
    "updateIntervalMs": 1000,
    "queueSize": 5,
    "errorsCount": 0
  }
}
```

**Used By:**

- Feature Engine monitoring
- Health dashboards

**Why It Exists:** Monitor Feature Engine processing status

---

### 23. GET `/api/features/config`

**Purpose:** Feature Engine configuration

**Use Case:** Display current feature calculation settings

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "updateInterval": 1000,
    "throttling": {
      "tier1": 500,
      "tier2": 1000,
      "tier3": 2000
    },
    "features": {
      "orderbookImbalance": true,
      "volatilityEngine": true,
      "feeLeverageEngine": true,
      "flowDelta": true,
      "wallsSpoofing": true,
      "pumpPreSignals": true
    }
  }
}
```

**Used By:**

- Configuration displays
- Settings panels

**Why It Exists:** Show active feature calculation configuration

---

### 24. GET `/api/features/overview`

**Purpose:** Feature calculation overview for all symbols

**Use Case:** System-wide feature status

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "totalSymbols": 312,
    "symbols": {
      "BTCUSDT": {
        "lastUpdate": "2025-11-23T14:29:59.000Z",
        "featuresCalculated": 8,
        "status": "ok"
      }
    }
  }
}
```

**Used By:**

- Feature Engine overview dashboard

**Why It Exists:** Monitor feature calculations across all symbols

---

### 25. GET `/api/features/walls/stats`

**Purpose:** Walls & Spoofing statistics

**Use Case:** Monitor manipulation detection

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "totalWallsDetected": 45,
    "activeSpoofing": 3,
    "symbols": {
      "BTCUSDT": {
        "bidWalls": 2,
        "askWalls": 1,
        "spoofingScore": 0.12
      }
    }
  }
}
```

**Used By:**

- Manipulation monitoring dashboard
- Alert systems

**Why It Exists:** Track market manipulation indicators

---

### 26. GET `/api/features/symbol/:symbol`

**Purpose:** Complete feature set for single symbol

**Use Case:** Detailed feature analysis display

**Path Parameters:**

- `symbol` - Symbol name

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "symbol": "BTCUSDT",
    "features": {
      "imbalance": {
        "tob": 0.54,
        "zoneShort": 0.48,
        "zoneMid": 0.52,
        "zoneFar": 0.5
      },
      "volatility": {
        "atr5s": 12.5,
        "atr15s": 18.3,
        "score": 0.65
      },
      "feeLeverage": {
        "minMoveForProfit": 5.2,
        "edgeScore": 0.78
      },
      "flow": {
        "buyVolume1s": 2.34,
        "sellVolume1s": 1.45,
        "deltaRatio1s": 0.62
      },
      "walls": {
        "bidWalls": 2,
        "askWalls": 1,
        "absorbingSupportScore": 0.45,
        "absorbingResistanceScore": 0.23
      },
      "spoofing": {
        "score": 0.12,
        "detected": false
      },
      "pump": {
        "likelihoodScore": 0.08,
        "signals": []
      }
    },
    "timestamp": "2025-11-23T14:29:59.000Z"
  }
}
```

**Used By:**

- `web/views/features.ejs` - feature analysis dashboard
- Signal generation systems

**Why It Exists:** Complete feature data for trading decisions

---

### 27. POST `/api/features/update`

**Purpose:** Manually trigger feature update for symbol

**Use Case:** Force feature recalculation

**Request Body:**

```json
{
  "symbol": "BTCUSDT"
}
```

**Response Structure:**

```json
{
  "status": "success",
  "message": "Features updated for BTCUSDT",
  "timestamp": "2025-11-23T14:30:00.000Z"
}
```

**Used By:**

- Manual testing
- Debug tools

**Why It Exists:** Manual feature calculation trigger for testing

---

## 📊 Summary

**Total Engine Endpoints:** 27

**Breakdown by Category:**

- Monitor: 11 endpoints
- Symbol Data: 4 endpoints
- Microstructure: 6 endpoints
- Feature Engine: 6 endpoints

**Critical Endpoints:**

1. `/api/microstructure/health` - Primary health check
2. `/api/monitor/summary` - System overview
3. `/api/features/symbol/:symbol` - Feature data
4. `/api/symbol/:symbol/orderbook` - Orderbook data

---

**Next Document:** Dashboard API Endpoints (Port 8080)
