# 🌐 API ENDPOINTS DOCUMENTATION - DASHBOARD API (Port 8080)

**Phase 4 Complete - November 23, 2025**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Proxy Endpoints](#proxy-endpoints)
3. [Dashboard API Endpoints](#dashboard-api-endpoints)
4. [Universe API Endpoints](#universe-api-endpoints)
5. [Feature API Endpoints](#feature-api-endpoints)
6. [Test API Endpoints](#test-api-endpoints)
7. [Authentication Endpoints](#authentication-endpoints)
8. [Page Routes](#page-routes)

---

## 🎯 Overview

**Dashboard Server** runs on **port 8080** and serves the web interface. It provides:

- Web UI pages (EJS templates)
- Proxy endpoints to Engine API (port 8090)
- Dashboard-specific API endpoints
- Authentication system
- Static file serving

**File Location:** `web/server.js`

**Route Files:**

- `web/routes/api.js` - Main API routes
- `web/routes/api-universe.js` - Universe routes
- `web/routes/api-features.js` - Feature Engine routes
- `web/routes/api-test.js` - Test/debug routes
- `web/routes/auth.js` - Authentication routes

**Process:** PM2 process `dashboard` (separate from engine)

**Base URL:** `http://localhost:8080`

**Important:** Dashboard is a **separate Node.js process** with isolated memory from Engine

---

## 🔄 Proxy Endpoints

Dashboard proxies certain requests to Engine API to avoid CORS issues and provide unified API access.

### Configuration in `web/server.js`:

```javascript
// Proxy to Engine API (port 8090)
app.use("/monitor/api", proxy({ target: "http://localhost:8090/api/monitor" }));
app.use(
  "/api/microstructure",
  proxy({ target: "http://localhost:8090/api/microstructure" })
);
app.use("/api/symbol", proxy({ target: "http://localhost:8090/api/symbol" }));
app.use(
  "/api/features",
  proxy({ target: "http://localhost:8090/api/features" })
);
app.use(
  "/api/diagnostics",
  proxy({ target: "http://localhost:8090/api/diagnostics" })
);
```

### Proxy Behavior:

**Request Path:** `http://localhost:8080/api/microstructure/health`

**Proxied To:** `http://localhost:8090/api/microstructure/health`

**Why Proxy?**

1. **CORS Prevention** - Browser can't fetch from different port
2. **Unified API** - Single origin for all requests
3. **Authentication** - Can add auth middleware to proxy
4. **Load Balancing** - Can distribute requests across multiple engines

---

## 📡 Dashboard API Endpoints

**File:** `web/routes/api.js`

### 1. GET `/api/engine/health`

**Purpose:** Proxy to engine microstructure health with native HTTP

**Use Case:** Monitor-micro dashboard real-time updates

**Query Parameters:** None

**Implementation:**

```javascript
// Uses native Node.js http module (no external dependencies)
http.request({
  hostname: "localhost",
  port: 8090,
  path: "/api/microstructure/health",
  method: "GET",
  timeout: 5000,
});
```

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

**Error Response:**

```json
{
  "ok": false,
  "error": "Failed to connect to engine",
  "message": "ECONNREFUSED"
}
```

**Used By:**

- `web/views/monitor-micro.ejs` - main metrics display
- Real-time dashboard updates

**Why It Exists:** Solves CORS issue when dashboard fetches from engine API

**Technical Notes:**

- Uses native `http` module (not fetch/axios)
- 5 second timeout
- Graceful error handling
- Returns 500 on engine connection failure

---

### 2. GET `/api/stats`

**Purpose:** Live system statistics from file persistence

**Use Case:** Dashboard overview metrics

**Query Parameters:** None

**Data Source:** Reads from `data/stats.json` (written by engine process)

**Response Structure:**

```json
{
  "success": true,
  "timestamp": "2025-11-23T14:30:00.000Z",
  "data": {
    "activeSymbols": 312,
    "eventsPerSecond": 624,
    "eventsPerMinute": 37440,
    "totalOrderbookUpdates": 5623456,
    "totalTradeUpdates": 892345,
    "uptime": 86400,
    "decisionCount": 15234,
    "ordersSent": 1523,
    "tradesExecuted": 456,
    "memoryUsageMB": 76.45
  }
}
```

**Error Handling:**

- If `stats.json` doesn't exist: returns zeros
- If JSON parse fails: returns zeros with error log

**Used By:**

- Dashboard overview panels
- Real-time metrics displays

**Why It Exists:**

- Dashboard process has empty OrderbookManager state (separate memory)
- Engine writes stats to file every 2 seconds
- Dashboard reads from file instead of trying to access engine memory

**Data Flow:**

1. Engine: `OrderbookManager.startStatsPersistence()` → writes `data/stats.json` every 2s
2. Dashboard: Reads `data/stats.json` on API request
3. Returns aggregated stats to frontend

---

### 3. GET `/api/health`

**Purpose:** Dashboard process health check

**Use Case:** Monitor dashboard service status

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "services": {
      "webServer": {
        "status": "OK",
        "uptime": 86400,
        "port": 8080
      },
      "database": {
        "status": "OK",
        "type": "SQLite"
      },
      "session": {
        "status": "OK",
        "activeUsers": 2
      }
    },
    "mode": "production"
  }
}
```

**Used By:**

- Health monitoring systems
- Uptime checks

**Why It Exists:** Monitor dashboard process health independently from engine

---

### 4. GET `/api/health/summary`

**Purpose:** Health summary overview

**Use Case:** Quick health check status

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "summary": "All services operational",
    "uptime": 86400,
    "mode": "production"
  }
}
```

**Used By:**

- Dashboard header status indicator
- Quick health checks

**Why It Exists:** Lightweight health check endpoint

---

### 5. GET `/api/health/services`

**Purpose:** List all monitored services

**Use Case:** Service status dashboard

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "webServer": {
      "status": "OK",
      "lastCheck": "2025-11-23T14:29:59.000Z"
    },
    "database": {
      "status": "OK",
      "lastCheck": "2025-11-23T14:29:59.000Z"
    },
    "session": {
      "status": "OK",
      "lastCheck": "2025-11-23T14:29:59.000Z"
    }
  }
}
```

**Used By:**

- Services monitoring panel

**Why It Exists:** Detailed service status tracking

---

### 6. GET `/api/health/services/:serviceName`

**Purpose:** Health status for specific service

**Use Case:** Individual service monitoring

**Path Parameters:**

- `serviceName` - Name of service (e.g., "webServer", "database")

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "name": "webServer",
    "status": "OK",
    "uptime": 86400,
    "lastCheck": "2025-11-23T14:29:59.000Z",
    "details": {
      "port": 8080,
      "connections": 5
    }
  }
}
```

**Error Response (404):**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "error",
  "message": "Service 'invalidName' not found"
}
```

**Used By:**

- Service detail pages
- Monitoring dashboards

**Why It Exists:** Granular service monitoring

---

### 7. GET `/api/symbol/:symbol/orderbook`

**Purpose:** Real orderbook data from dashboard's OrderbookManager

**Use Case:** Orderbook display on dashboard

**Path Parameters:**

- `symbol` - Symbol name

**Query Parameters:**

- `depth` (optional, default: 10) - Number of levels per side

**Response Structure:**

```json
{
  "success": true,
  "data": {
    "symbol": "BTCUSDT",
    "bids": [
      [43250.0, 1.523],
      [43249.5, 0.234]
    ],
    "asks": [
      [43250.5, 0.456],
      [43251.0, 1.234]
    ],
    "timestamp": "2025-11-23T14:29:59.500Z",
    "spread": 0.5
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "message": "No orderbook data available for BTCUSDT"
}
```

**Data Source:** Dashboard's local `OrderbookManager` instance

**Important:** Dashboard has **separate OrderbookManager** from engine (isolated memory)

**Used By:**

- Dashboard orderbook widgets
- When engine proxy not available

**Why It Exists:** Fallback orderbook data source in dashboard process

---

### 8. GET `/api/symbol/:symbol/trades`

**Purpose:** Recent trades from dashboard's OrderbookManager

**Use Case:** Trade history display

**Path Parameters:**

- `symbol` - Symbol name

**Query Parameters:**

- `limit` (optional, default: 50) - Max trades to return

**Response Structure:**

```json
{
  "success": true,
  "data": [
    {
      "price": 43250.5,
      "quantity": 0.125,
      "side": "Buy",
      "timestamp": "2025-11-23T14:29:59.500Z"
    }
  ]
}
```

**Used By:**

- Dashboard trade feed widgets

**Why It Exists:** Local trade data access in dashboard process

---

### 9. GET `/api/symbol/:symbol/candles/:timeframe`

**Purpose:** Candle data from dashboard's OrderbookManager

**Use Case:** Chart rendering

**Path Parameters:**

- `symbol` - Symbol name
- `timeframe` - "1s", "3s", "5s", "15s"

**Query Parameters:**

- `limit` (optional, default: 100) - Max candles

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
      "volume": 5.234
    }
  ],
  "count": 100,
  "timestamp": "2025-11-23T14:30:00.000Z"
}
```

**Used By:**

- Dashboard chart components

**Why It Exists:** Local candle data in dashboard process

---

## 🌍 Universe API Endpoints

**File:** `web/routes/api-universe.js`

### 10. GET `/api/universe`

**Purpose:** Full universe snapshot

**Use Case:** Complete symbol list with stats

**Query Parameters:** None

**Response Structure:**

```json
{
  "fetchedAt": "2025-11-23T14:00:00.000Z",
  "totalSymbols": 312,
  "stats": {
    "totalSymbols": 312,
    "primeSymbols": 45,
    "normalSymbols": 234,
    "wildSymbols": 33
  },
  "symbols": [
    {
      "symbol": "BTCUSDT",
      "category": "Prime",
      "volume24h": 1523456789.45,
      "leverage": "50x"
    }
  ]
}
```

**Used By:**

- Markets page
- Symbol selection dropdowns

**Why It Exists:** Universe data access from dashboard

---

### 11. GET `/api/universe/categories`

**Purpose:** Symbols grouped by category

**Use Case:** Category-filtered symbol lists

**Query Parameters:** None

**Response Structure:**

```json
{
  "prime": [
    {
      "symbol": "BTCUSDT",
      "volume24h": 1523456789.45
    }
  ],
  "normal": [
    {
      "symbol": "DOGEUSDT",
      "volume24h": 123456789.45
    }
  ],
  "wild": [
    {
      "symbol": "PEPEUSDT",
      "volume24h": 12345678.9
    }
  ]
}
```

**Used By:**

- Category tabs in markets page
- Filtered watchlists

**Why It Exists:** Quick access to categorized symbols

---

## 🧠 Feature API Endpoints

**File:** `web/routes/api-features.js`

**Note:** These are dashboard-local Feature Engine routes (separate from engine proxy)

### 12. GET `/api/features/health`

**Purpose:** Dashboard Feature Engine health

**Use Case:** Monitor dashboard's local Feature Engine instance

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "status": "running",
    "symbolsProcessed": 0,
    "lastUpdateAt": null,
    "note": "Dashboard has separate Feature Engine instance"
  }
}
```

**Why It Exists:** Dashboard can run its own Feature Engine (currently not used)

---

### 13. GET `/api/features/overview`

**Purpose:** Feature overview from dashboard instance

**Use Case:** Dashboard-local feature calculations

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "totalSymbols": 0,
    "symbols": {}
  }
}
```

**Note:** Currently returns empty data as dashboard doesn't run feature calculations

**Why It Exists:** Placeholder for potential dashboard-side feature calculations

---

### 14. GET `/api/features/performance`

**Purpose:** Feature Engine performance metrics

**Use Case:** Performance monitoring

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "avgCalculationTimeMs": 0,
    "maxCalculationTimeMs": 0,
    "totalCalculations": 0
  }
}
```

**Why It Exists:** Performance monitoring placeholder

---

### 15. GET `/api/features/symbol/:symbol`

**Purpose:** Features for specific symbol (dashboard instance)

**Use Case:** Dashboard-local feature data

**Path Parameters:**

- `symbol` - Symbol name

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "error",
  "message": "No features found for symbol BTCUSDT"
}
```

**Note:** Returns 404 as dashboard doesn't calculate features

**Why It Exists:** API consistency (matches engine API structure)

---

### 16. POST `/api/features/update/:symbol`

**Purpose:** Trigger feature update (dashboard instance)

**Use Case:** Manual feature calculation trigger

**Path Parameters:**

- `symbol` - Symbol name

**Request Body:**

```json
{
  "marketData": {
    "price": 43250.5,
    "volume": 123.45
  }
}
```

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "symbol": "BTCUSDT",
    "updated": true,
    "features": {},
    "timestamp": "2025-11-23T14:30:00.000Z"
  }
}
```

**Why It Exists:** API endpoint for potential future use

---

### 17. POST `/api/features/bulk-update`

**Purpose:** Update features for multiple symbols

**Use Case:** Batch feature calculations

**Request Body:**

```json
{
  "updates": [
    {
      "symbol": "BTCUSDT",
      "marketData": { "price": 43250.5 }
    },
    {
      "symbol": "ETHUSDT",
      "marketData": { "price": 2250.75 }
    }
  ]
}
```

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "processed": 2,
    "successful": 2,
    "failed": 0,
    "results": [
      {
        "symbol": "BTCUSDT",
        "updated": true,
        "features": {}
      }
    ]
  }
}
```

**Why It Exists:** Batch processing endpoint

---

### 18. GET `/api/features/risks`

**Purpose:** Risk summary across symbols

**Use Case:** Risk monitoring dashboard

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "highRiskSymbols": [],
    "mediumRiskSymbols": [],
    "lowRiskSymbols": [],
    "totalSymbols": 0,
    "avgRiskScore": 0,
    "maxRiskScore": 0,
    "riskDistribution": {
      "high": 0,
      "medium": 0,
      "low": 0
    }
  }
}
```

**Why It Exists:** Risk aggregation and monitoring

---

### 19. POST `/api/features/reset`

**Purpose:** Reset Feature Engine state

**Use Case:** Debug and testing

**Request Body (optional):**

```json
{
  "symbol": "BTCUSDT"
}
```

**Response (specific symbol):**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "message": "Feature engine state reset for symbol BTCUSDT",
    "symbol": "BTCUSDT"
  }
}
```

**Response (all symbols):**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "message": "Feature engine state reset for all symbols"
  }
}
```

**Why It Exists:** Testing and debug utility

---

### 20. GET `/api/features/config`

**Purpose:** Feature Engine configuration

**Use Case:** Display configuration settings

**Query Parameters:** None

**Response Structure:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "success",
  "data": {
    "throttling": {
      "tier1": "500ms",
      "tier2": "1000ms",
      "tier3": "2000ms"
    },
    "concurrency": {
      "maxConcurrent": 10,
      "description": "Maximum concurrent feature calculations"
    },
    "persistence": {
      "saveInterval": "30000ms",
      "autoSave": true,
      "dataPath": "data/features"
    },
    "features": {
      "orderbookImbalance": "TOB and zone-based imbalance analysis",
      "volatilityEngine": "Multi-timeframe ATR volatility analysis",
      "feeLeverageEngine": "Profitability and risk calculations",
      "flowDelta": "Buy/sell pressure and momentum tracking",
      "wallsSpoofing": "Market manipulation detection",
      "pumpPreSignals": "Early pump/dump signal detection"
    },
    "version": "1.0.0",
    "phase": "FAZA 4"
  }
}
```

**Why It Exists:** Configuration display and documentation

---

## 🧪 Test API Endpoints

**File:** `web/routes/api-test.js`

### 21. GET `/api/test/ticker/:symbol`

**Purpose:** Test ticker data from file snapshots

**Use Case:** Debug WebSocket data persistence

**Path Parameters:**

- `symbol` - Symbol name

**Response Structure:**

```json
{
  "symbol": "BTCUSDT",
  "ok": true,
  "data": {
    "price": 43250.5,
    "timestamp": "2025-11-23T14:29:59.000Z"
  }
}
```

**Data Source:** `data/ws-snapshots/ticker/{SYMBOL}.json`

**Why It Exists:** Test WebSocket data persistence

---

### 22. GET `/api/test/tradeflow/:symbol`

**Purpose:** Test trade flow data from file snapshots

**Use Case:** Debug trade aggregation

**Path Parameters:**

- `symbol` - Symbol name

**Response Structure:**

```json
{
  "symbol": "BTCUSDT",
  "ok": true,
  "data": {
    "buyVolume": 123.45,
    "sellVolume": 98.76,
    "delta": 24.69
  }
}
```

**Data Source:** `data/ws-snapshots/trades/{SYMBOL}.json`

**Why It Exists:** Test trade flow calculations

---

### 23. GET `/api/test/orderbook/:symbol`

**Purpose:** Test orderbook data from file snapshots

**Use Case:** Debug orderbook persistence

**Path Parameters:**

- `symbol` - Symbol name

**Response Structure:**

```json
{
  "symbol": "BTCUSDT",
  "ok": true,
  "bids": [[43250.0, 1.523]],
  "asks": [[43250.5, 0.456]],
  "ts": "2025-11-23T14:29:59.500Z"
}
```

**Data Source:** `data/ws-snapshots/orderbook/{SYMBOL}.json`

**Why It Exists:** Test orderbook snapshot persistence

---

### 24. GET `/api/test/ws`

**Purpose:** WebSocket connection status

**Use Case:** Debug WebSocket connectivity

**Query Parameters:** None

**Response Structure:**

```json
{
  "connected": true,
  "subscribedSymbols": 312,
  "messagesReceived": 1523456,
  "lastMessageAt": "2025-11-23T14:29:59.000Z",
  "uptimeMs": 86400000
}
```

**Data Source:** `bybitPublic.getWsStatus()`

**Why It Exists:** Monitor WebSocket connection health

---

## 🔐 Authentication Endpoints

**File:** `web/routes/auth.js`

### 25. GET `/login`

**Purpose:** Login page display

**Use Case:** User authentication UI

**Query Parameters:** None

**Response:** HTML page (`views/login.ejs`)

**Behavior:**

- If already logged in → redirect to `/`
- If not logged in → show login form

**Why It Exists:** User login interface

---

### 26. POST `/login`

**Purpose:** Process login credentials

**Use Case:** User authentication

**Request Body:**

```json
{
  "username": "admin",
  "password": "password123"
}
```

**Success Response:** Redirect to `/` (dashboard)

**Error Response:** Re-render login page with error message

**Authentication Flow:**

1. Validate username and password not empty
2. Query user from SQLite database
3. Compare password with bcrypt hash
4. Create session if valid
5. Redirect to dashboard

**Session Data:**

```javascript
req.session.user = {
  id: 1,
  username: "admin",
  role: "user",
  loginAt: 1700750400000,
};
```

**Why It Exists:** Secure user authentication

---

### 27. GET `/logout`

**Purpose:** End user session

**Use Case:** User logout

**Query Parameters:** None

**Response:** Redirect to `/login`

**Behavior:**

- Destroy session
- Clear session cookie
- Redirect to login page

**Why It Exists:** User logout functionality

---

## 📄 Page Routes

**File:** `web/server.js`

All page routes require authentication (`requireAuth` middleware)

### 28. GET `/`

**Purpose:** Main dashboard homepage

**Response:** `views/dashboard.ejs`

**Authentication:** Required

**Why It Exists:** Main dashboard interface

---

### 29. GET `/dashboard`

**Purpose:** Dashboard page (alternative route)

**Response:** `views/dashboard.ejs`

**Authentication:** Required

**Why It Exists:** Alternative dashboard route

---

### 30. GET `/markets`

**Purpose:** Markets overview page

**Response:** `views/markets.ejs`

**Authentication:** Required

**Why It Exists:** Markets table and symbol list

---

### 31. GET `/monitor`

**Purpose:** System monitoring page

**Response:** `views/monitor.ejs`

**Authentication:** Required

**Why It Exists:** Live system monitoring and logs

---

### 32. GET `/monitor-micro`

**Purpose:** Microstructure monitoring dashboard

**Response:** `views/monitor-micro.ejs`

**Authentication:** Required

**Why It Exists:** Orderbook and microstructure analysis

---

### 33. GET `/features`

**Purpose:** Feature Engine dashboard

**Response:** `views/features.ejs`

**Authentication:** Required

**Why It Exists:** Feature calculation monitoring

---

### 34. GET `/diagnostics`

**Purpose:** System diagnostics page

**Response:** `views/diagnostics.ejs`

**Authentication:** Required

**Why It Exists:** Full system health check and diagnostics

---

## 📊 Summary

**Total Dashboard Endpoints:** 34

**Breakdown by Category:**

- Dashboard API: 9 endpoints
- Universe API: 2 endpoints
- Feature API: 9 endpoints
- Test API: 4 endpoints
- Authentication: 3 endpoints
- Page Routes: 7 routes

**Critical Endpoints:**

1. `/api/engine/health` - Engine health proxy
2. `/api/stats` - System statistics
3. `/login` - User authentication
4. `/api/universe` - Symbol data

**Architecture Notes:**

- Dashboard runs on port 8080 (separate process)
- Proxies requests to Engine API (port 8090)
- Has isolated memory (separate OrderbookManager, FeatureEngine)
- Uses SQLite for sessions and user data
- Serves EJS templates for UI

---

**Next Document:** API Usage Examples & Integration Guide
