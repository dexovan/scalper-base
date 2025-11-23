# 📚 API ENDPOINTS - USAGE EXAMPLES & INTEGRATION GUIDE

**Phase 4 Complete - November 23, 2025**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Common Request Examples](#common-request-examples)
3. [Frontend Integration Patterns](#frontend-integration-patterns)
4. [Error Handling](#error-handling)
5. [Performance Considerations](#performance-considerations)
6. [Complete API Reference](#complete-api-reference)
7. [Architecture Summary](#architecture-summary)

---

## 🎯 Overview

This document provides practical examples and integration patterns for the Scalper Base API system.

**Complete API Documentation:**

- [Engine API (Port 8090)](./API_ENDPOINTS_ENGINE.md) - 27 endpoints
- [Dashboard API (Port 8080)](./API_ENDPOINTS_DASHBOARD.md) - 34 endpoints

**Total Endpoints:** 61

---

## 🔧 Common Request Examples

### Example 1: Fetch System Summary

**Scenario:** Display main dashboard overview

```javascript
// From frontend (browser)
fetch("/monitor/api/summary")
  .then((res) => res.json())
  .then((data) => {
    console.log("System uptime:", data.data.engine.uptime);
    console.log("Active symbols:", data.data.microstructure.activeSymbols);
    console.log(
      "WebSocket status:",
      data.data.websocket.mainConnection.connected
    );
  });
```

**Flow:**

1. Browser → `http://localhost:8080/monitor/api/summary`
2. Dashboard proxy → `http://localhost:8090/api/monitor/summary`
3. Engine responds with full system metrics
4. Dashboard returns to browser (no CORS issues)

**Response Time:** ~50ms

---

### Example 2: Get Real-Time Symbol Price

**Scenario:** Update price display every second

```javascript
// Fetch single symbol price
async function updatePrice(symbol) {
  const response = await fetch(`/api/symbol/${symbol}/basic`);
  const data = await response.json();

  if (data.status === "success") {
    document.getElementById("price").textContent = data.data.price;
    document.getElementById("change24h").textContent =
      data.data.change24h + "%";
  }
}

// Update every second
setInterval(() => updatePrice("BTCUSDT"), 1000);
```

**Flow:**

1. Browser → `http://localhost:8080/api/symbol/BTCUSDT/basic`
2. Dashboard proxy → `http://localhost:8090/api/symbol/BTCUSDT/basic`
3. Engine returns real-time price from WebSocket data

**Response Time:** ~10ms

---

### Example 3: Monitor Microstructure Health

**Scenario:** Real-time microstructure dashboard

```javascript
// Using native proxy endpoint
async function checkMicroHealth() {
  try {
    const response = await fetch("/api/engine/health");
    const data = await response.json();

    if (data.ok) {
      updateMetrics({
        activeSymbols: data.activeSymbols,
        eventsPerSecond: data.eventsPerSecond,
        memoryUsageMB: data.memoryUsageMB,
      });
    } else {
      showError("Engine disconnected");
    }
  } catch (error) {
    showError("Failed to fetch health data");
  }
}

// Poll every 2 seconds
setInterval(checkMicroHealth, 2000);
```

**Why `/api/engine/health` instead of `/api/microstructure/health`?**

- Uses native Node.js `http` module (no dependencies)
- Better error handling
- Explicit timeout (5s)
- Used by `monitor-micro.ejs`

**Response Time:** ~15ms

---

### Example 4: Fetch Orderbook for Chart

**Scenario:** Display orderbook depth chart

```javascript
async function fetchOrderbook(symbol, depth = 20) {
  const response = await fetch(
    `/api/symbol/${symbol}/orderbook?depth=${depth}`
  );
  const data = await response.json();

  if (data.status === "success") {
    const { bids, asks, timestamp } = data.data;

    // Render depth chart
    renderDepthChart({
      bids: bids.map(([price, qty]) => ({ price, quantity: qty })),
      asks: asks.map(([price, qty]) => ({ price, quantity: qty })),
      timestamp,
    });
  }
}

fetchOrderbook("BTCUSDT", 20);
```

**Flow:**

1. Browser requests via dashboard proxy
2. Engine returns live orderbook from OrderbookManager
3. Data is real-time (updated every ~100ms from WebSocket)

**Response Time:** ~20ms

---

### Example 5: Get Feature Data for Symbol

**Scenario:** Display feature analysis dashboard

```javascript
async function fetchFeatures(symbol) {
  const response = await fetch(`/api/features/symbol/${symbol}`);
  const data = await response.json();

  if (data.status === "success") {
    const features = data.data.features;

    // Display features
    displayFeatureCard("Orderbook Imbalance", features.imbalance.tob);
    displayFeatureCard("Volatility Score", features.volatility.score);
    displayFeatureCard("Fee Edge Score", features.feeLeverage.edgeScore);
    displayFeatureCard("Spoofing Score", features.spoofing.score);
    displayFeatureCard("Pump Likelihood", features.pump.likelihoodScore);
  }
}

fetchFeatures("BTCUSDT");
```

**Flow:**

1. Browser → Dashboard proxy → Engine
2. Engine returns features calculated by FeatureEngine
3. Features updated every 1-2 seconds

**Response Time:** ~30ms

---

### Example 6: Fetch All Tickers for Markets Table

**Scenario:** Markets page with sortable table

```javascript
async function loadMarketsTable() {
  const response = await fetch("/monitor/api/tickers");
  const data = await response.json();

  if (data.status === "success") {
    const tickers = Object.values(data.data.tickers);

    // Sort by volume
    tickers.sort((a, b) => b.volume24h - a.volume24h);

    // Render table
    tickers.forEach((ticker) => {
      addTableRow({
        symbol: ticker.symbol,
        price: ticker.price,
        change24h: ticker.change24h,
        volume24h: ticker.volume24h,
      });
    });
  }
}

loadMarketsTable();
```

**Data Source:**

- Real-time prices from WebSocket
- 24h data from Bybit REST API (refreshed every 60s)

**Response Time:** ~100ms (large response ~300KB)

---

### Example 7: Fetch Universe by Category

**Scenario:** Filter symbols by Prime/Normal/Wild

```javascript
async function fetchPrimeSymbols() {
  const response = await fetch("/api/universe/categories");
  const data = await response.json();

  const primeSymbols = data.prime;
  const normalSymbols = data.normal;
  const wildSymbols = data.wild;

  // Display in separate tabs
  renderSymbolList("prime-tab", primeSymbols);
  renderSymbolList("normal-tab", normalSymbols);
  renderSymbolList("wild-tab", wildSymbols);
}

fetchPrimeSymbols();
```

**Response Time:** ~50ms

---

### Example 8: Manually Trigger WebSocket Reconnect

**Scenario:** Emergency WebSocket recovery

```javascript
async function reconnectWebSocket() {
  const response = await fetch("/monitor/api/refresh-ws", {
    method: "POST",
  });

  const data = await response.json();

  if (data.status === "success") {
    console.log("WebSocket reconnection triggered");

    // Wait 5 seconds and check status
    setTimeout(async () => {
      const statusResponse = await fetch("/monitor/api/summary");
      const statusData = await statusResponse.json();

      if (statusData.data.websocket.mainConnection.connected) {
        console.log("WebSocket reconnected successfully");
      }
    }, 5000);
  }
}

// Trigger on button click
document
  .getElementById("reconnect-btn")
  .addEventListener("click", reconnectWebSocket);
```

**Use Case:** When WebSocket connection issues detected

---

## 🖥️ Frontend Integration Patterns

### Pattern 1: API Client Wrapper

**File:** `web/public/js/api-client.js`

```javascript
class ScalperAPI {
  constructor(baseURL = "") {
    this.baseURL = baseURL;
  }

  async request(endpoint, options = {}) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, options);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // System endpoints
  async getSystemSummary() {
    return this.request("/monitor/api/summary");
  }

  async getMicroHealth() {
    return this.request("/api/engine/health");
  }

  async getStats() {
    return this.request("/api/stats");
  }

  // Symbol endpoints
  async getSymbolBasic(symbol) {
    return this.request(`/api/symbol/${symbol}/basic`);
  }

  async getOrderbook(symbol, depth = 20) {
    return this.request(`/api/symbol/${symbol}/orderbook?depth=${depth}`);
  }

  async getTrades(symbol, limit = 50) {
    return this.request(`/api/symbol/${symbol}/trades?limit=${limit}`);
  }

  async getCandles(symbol, timeframe, limit = 100) {
    return this.request(
      `/api/symbol/${symbol}/candles/${timeframe}?limit=${limit}`
    );
  }

  // Feature endpoints
  async getFeatures(symbol) {
    return this.request(`/api/features/symbol/${symbol}`);
  }

  async getFeaturesOverview() {
    return this.request("/api/features/overview");
  }

  // Universe endpoints
  async getUniverse() {
    return this.request("/api/universe");
  }

  async getUniverseCategories() {
    return this.request("/api/universe/categories");
  }
}

// Global instance
const api = new ScalperAPI();
```

**Usage in pages:**

```javascript
// In dashboard.ejs
async function loadDashboard() {
  const summary = await api.getSystemSummary();
  const stats = await api.getStats();

  updateDashboardMetrics(summary, stats);
}
```

---

### Pattern 2: Real-Time Updates with Polling

```javascript
class RealtimeUpdater {
  constructor(interval = 1000) {
    this.interval = interval;
    this.timers = {};
  }

  start(name, callback) {
    if (this.timers[name]) {
      clearInterval(this.timers[name]);
    }

    // Run immediately
    callback();

    // Then poll at interval
    this.timers[name] = setInterval(callback, this.interval);
  }

  stop(name) {
    if (this.timers[name]) {
      clearInterval(this.timers[name]);
      delete this.timers[name];
    }
  }

  stopAll() {
    Object.keys(this.timers).forEach((name) => this.stop(name));
  }
}

// Usage
const updater = new RealtimeUpdater(2000); // 2 second interval

updater.start("microHealth", async () => {
  const health = await api.getMicroHealth();
  updateHealthDisplay(health);
});

updater.start("symbolPrice", async () => {
  const price = await api.getSymbolBasic("BTCUSDT");
  updatePriceDisplay(price);
});

// Stop on page unload
window.addEventListener("beforeunload", () => {
  updater.stopAll();
});
```

---

### Pattern 3: Error Handling and Retry Logic

```javascript
class APIWithRetry {
  constructor(maxRetries = 3, retryDelay = 1000) {
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;
  }

  async fetchWithRetry(url, options = {}, retryCount = 0) {
    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.log(`Retry ${retryCount + 1}/${this.maxRetries} for ${url}`);
        await this.sleep(this.retryDelay);
        return this.fetchWithRetry(url, options, retryCount + 1);
      } else {
        console.error(`Failed after ${this.maxRetries} retries:`, error);
        throw error;
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Usage
const apiRetry = new APIWithRetry(3, 2000);

async function fetchCriticalData() {
  try {
    const data = await apiRetry.fetchWithRetry("/api/engine/health");
    return data;
  } catch (error) {
    showErrorNotification("Critical data fetch failed");
    return null;
  }
}
```

---

### Pattern 4: Batch Request Optimization

```javascript
class BatchAPI {
  async fetchMultipleSymbols(symbols) {
    // Fetch all symbols in parallel
    const promises = symbols.map((symbol) => api.getSymbolBasic(symbol));

    const results = await Promise.allSettled(promises);

    // Separate successful and failed requests
    const successful = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    const failed = results
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason);

    return { successful, failed };
  }
}

// Usage
const batchAPI = new BatchAPI();

async function loadMultiplePrices() {
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
  const { successful, failed } = await batchAPI.fetchMultipleSymbols(symbols);

  successful.forEach((data) => {
    updateSymbolDisplay(data.data.symbol, data.data.price);
  });

  if (failed.length > 0) {
    console.error(`Failed to fetch ${failed.length} symbols`);
  }
}
```

---

## ⚠️ Error Handling

### Standard Error Response Format

**Engine API Errors:**

```json
{
  "timestamp": "2025-11-23T14:30:00.000Z",
  "status": "error",
  "error": "Symbol not found",
  "message": "BTCUSDT does not exist in universe"
}
```

**Dashboard API Errors:**

```json
{
  "success": false,
  "message": "Failed to fetch data",
  "error": "ECONNREFUSED"
}
```

### Common Error Scenarios

**1. Engine Connection Failed**

```javascript
{
  "ok": false,
  "error": "Failed to connect to engine",
  "message": "ECONNREFUSED"
}
```

**Solution:** Check if engine process is running (`pm2 list`)

---

**2. Symbol Not Found**

```javascript
{
  "status": "error",
  "message": "No features found for symbol INVALIDUSDT"
}
```

**Solution:** Verify symbol exists in universe

---

**3. Timeout**

```javascript
{
  "ok": false,
  "error": "Engine request timeout"
}
```

**Solution:** Increase timeout or check engine performance

---

**4. No Data Available**

```json
{
  "success": false,
  "message": "No orderbook data available for BTCUSDT"
}
```

**Solution:** Wait for WebSocket to populate data

---

### Error Handling Best Practices

```javascript
async function safeAPICall(apiFunction, fallbackValue = null) {
  try {
    const response = await apiFunction();

    // Check response structure
    if (response.status === "error" || response.success === false) {
      console.error("API returned error:", response.message);
      return fallbackValue;
    }

    return response;
  } catch (error) {
    console.error("API call failed:", error);

    // Show user-friendly error
    showNotification("Connection issue. Retrying...", "warning");

    return fallbackValue;
  }
}

// Usage
const summary = await safeAPICall(
  () => api.getSystemSummary(),
  { data: { engine: { uptime: 0 } } } // Fallback
);
```

---

## ⚡ Performance Considerations

### 1. Request Frequency

**Recommended Polling Intervals:**

| Endpoint                       | Interval | Reason                              |
| ------------------------------ | -------- | ----------------------------------- |
| `/api/engine/health`           | 2s       | Real-time microstructure monitoring |
| `/api/symbol/:symbol/basic`    | 1s       | Live price updates                  |
| `/monitor/api/summary`         | 5s       | System overview (large response)    |
| `/api/features/symbol/:symbol` | 2s       | Feature calculations                |
| `/monitor/api/tickers`         | 10s      | All symbols (~300KB response)       |
| `/api/universe`                | 60s      | Static data (rarely changes)        |

---

### 2. Response Sizes

| Endpoint                        | Typical Size | Notes             |
| ------------------------------- | ------------ | ----------------- |
| `/api/engine/health`            | ~500 bytes   | Very lightweight  |
| `/api/symbol/:symbol/basic`     | ~300 bytes   | Single symbol     |
| `/api/symbol/:symbol/orderbook` | ~5KB         | 20 levels         |
| `/monitor/api/tickers`          | ~300KB       | All 312 symbols   |
| `/api/features/symbol/:symbol`  | ~2KB         | Complete features |
| `/monitor/api/summary`          | ~10KB        | Full system state |

---

### 3. Optimization Strategies

**A. Debounce User Input**

```javascript
function debounce(func, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// Search symbols with debounce
const searchSymbols = debounce(async (query) => {
  const universe = await api.getUniverse();
  const filtered = universe.symbols.filter((s) =>
    s.symbol.includes(query.toUpperCase())
  );
  displaySearchResults(filtered);
}, 300);
```

**B. Cache Static Data**

```javascript
class CachedAPI {
  constructor() {
    this.cache = new Map();
    this.cacheDuration = 60000; // 60 seconds
  }

  async getCached(key, fetchFunction) {
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    const data = await fetchFunction();
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });

    return data;
  }
}

const cachedAPI = new CachedAPI();

// Cache universe data for 60 seconds
async function getUniverse() {
  return cachedAPI.getCached("universe", () => api.getUniverse());
}
```

**C. Request Prioritization**

```javascript
// High priority: Real-time data
const highPriorityUpdater = new RealtimeUpdater(1000);
highPriorityUpdater.start("price", () => api.getSymbolBasic("BTCUSDT"));

// Low priority: Static data
const lowPriorityUpdater = new RealtimeUpdater(10000);
lowPriorityUpdater.start("universe", () => api.getUniverse());
```

---

## 📖 Complete API Reference

### Engine API (Port 8090) - 27 Endpoints

**Monitor Endpoints (11):**

1. `GET /api/monitor/summary` - Complete system overview
2. `GET /api/monitor/logs` - Recent log entries
3. `GET /api/monitor/tickers` - All symbol prices
4. `GET /api/monitor/24h-status` - 24h data refresh status
5. `GET /api/monitor/test-fetch` - Manual 24h data fetch
6. `GET /api/monitor/trades` - Recent trades
7. `GET /api/monitor/storage` - Storage statistics
8. `GET /api/monitor/universe` - Universe snapshot
9. `GET /api/monitor/symbols/:category` - Symbols by category
10. `GET /api/monitor/symbol/:symbol` - Symbol metadata
11. `POST /api/monitor/refresh-ws` - Reconnect WebSocket

**Symbol Data Endpoints (4):** 12. `GET /api/symbol/:symbol/basic` - Basic symbol data 13. `GET /api/symbols` - All symbol names 14. `GET /api/monitor/symbols` - All symbols with stats 15. `GET /api/symbol/:symbol/micro` - Microstructure analysis

**Microstructure Endpoints (6):** 16. `GET /api/symbol/:symbol/orderbook` - Orderbook snapshot 17. `GET /api/symbol/:symbol/trades` - Symbol trades 18. `GET /api/symbol/:symbol/candles/:timeframe` - Candle data 19. `GET /api/microstructure/symbols` - All symbol microstructure 20. `GET /api/microstructure/health` - **CRITICAL** Health check

**Feature Engine Endpoints (6):** 21. `GET /api/diagnostics` - Complete diagnostics 22. `GET /api/features/health` - Feature Engine health 23. `GET /api/features/config` - Feature configuration 24. `GET /api/features/overview` - All symbols overview 25. `GET /api/features/walls/stats` - Walls statistics 26. `GET /api/features/symbol/:symbol` - Symbol features 27. `POST /api/features/update` - Trigger feature update

---

### Dashboard API (Port 8080) - 34 Endpoints

**Dashboard Endpoints (9):**

1. `GET /api/engine/health` - Engine health proxy
2. `GET /api/stats` - System statistics
3. `GET /api/health` - Dashboard health
4. `GET /api/health/summary` - Health summary
5. `GET /api/health/services` - All services status
6. `GET /api/health/services/:serviceName` - Service detail
7. `GET /api/symbol/:symbol/orderbook` - Dashboard orderbook
8. `GET /api/symbol/:symbol/trades` - Dashboard trades
9. `GET /api/symbol/:symbol/candles/:timeframe` - Dashboard candles

**Universe Endpoints (2):** 10. `GET /api/universe` - Full universe 11. `GET /api/universe/categories` - Categorized symbols

**Feature Endpoints (9):** 12. `GET /api/features/health` - Dashboard Feature health 13. `GET /api/features/overview` - Features overview 14. `GET /api/features/performance` - Performance metrics 15. `GET /api/features/symbol/:symbol` - Symbol features 16. `POST /api/features/update/:symbol` - Update symbol features 17. `POST /api/features/bulk-update` - Batch update 18. `GET /api/features/risks` - Risk summary 19. `POST /api/features/reset` - Reset features 20. `GET /api/features/config` - Feature config

**Test Endpoints (4):** 21. `GET /api/test/ticker/:symbol` - Test ticker data 22. `GET /api/test/tradeflow/:symbol` - Test trade flow 23. `GET /api/test/orderbook/:symbol` - Test orderbook 24. `GET /api/test/ws` - WebSocket status

**Authentication Endpoints (3):** 25. `GET /login` - Login page 26. `POST /login` - Process login 27. `GET /logout` - Logout

**Page Routes (7):** 28. `GET /` - Dashboard homepage 29. `GET /dashboard` - Dashboard page 30. `GET /markets` - Markets page 31. `GET /monitor` - Monitor page 32. `GET /monitor-micro` - Microstructure page 33. `GET /features` - Features page 34. `GET /diagnostics` - Diagnostics page

---

## 🏗️ Architecture Summary

### Two-Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SCALPER BASE API                      │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────┐      ┌────────────────────┐   │
│  │   ENGINE PROCESS    │      │  DASHBOARD PROCESS │   │
│  │   Port 8090         │◄─────┤  Port 8080         │   │
│  │                     │ HTTP │                    │   │
│  │  - WebSocket Feeds  │ Proxy│  - Web UI (EJS)    │   │
│  │  - OrderbookManager │      │  - Static Files    │   │
│  │  - FeatureEngine    │      │  - Authentication  │   │
│  │  - 27 Endpoints     │      │  - 34 Endpoints    │   │
│  │                     │      │                    │   │
│  │  MEMORY: 206MB      │      │  MEMORY: 76MB      │   │
│  └─────────────────────┘      └────────────────────┘   │
│           ▲                            ▲                 │
│           │                            │                 │
│           │ WebSocket                  │ HTTP            │
│           │                            │                 │
│  ┌────────┴─────────┐        ┌────────┴─────────┐      │
│  │  Bybit WebSocket │        │     Browser      │      │
│  │  - Ticker        │        │  - Dashboard UI  │      │
│  │  - Trades        │        │  - Charts        │      │
│  │  - Orderbook     │        │  - Tables        │      │
│  └──────────────────┘        └──────────────────┘      │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### Key Architecture Points

1. **Process Isolation**

   - Engine and Dashboard are separate PM2 processes
   - Separate memory spaces (no shared state)
   - Engine crashes don't affect Dashboard

2. **Data Flow**

   - WebSocket → Engine → File/API → Dashboard → Browser
   - Dashboard proxies most requests to Engine
   - Some endpoints serve local Dashboard data

3. **Critical Endpoints**

   - `/api/microstructure/health` - Primary health check
   - `/api/engine/health` - Dashboard proxy to health
   - `/api/monitor/summary` - Complete system overview

4. **Performance**
   - Engine handles real-time data processing
   - Dashboard serves UI with minimal processing
   - Proxy adds ~5-10ms latency

---

## ✅ Phase 4 Complete

**Documentation Complete:**

- ✅ Engine API - 27 endpoints documented
- ✅ Dashboard API - 34 endpoints documented
- ✅ Usage examples and integration patterns
- ✅ Error handling and best practices
- ✅ Performance considerations
- ✅ Architecture overview

**Total Endpoints Documented:** 61

**Date:** November 23, 2025

**Next Phase:** Phase 5 - WebSocket Architecture (Already Complete)

**Future Phases:**

- Phase 6 - Scoring & Signal Engine
- Phase 7 - State Machine
- Phase 8 - Order Execution
- Phase 9 - Risk Management

---

**Related Documentation:**

- [Engine API Reference](./API_ENDPOINTS_ENGINE.md)
- [Dashboard API Reference](./API_ENDPOINTS_DASHBOARD.md)
- [WebSocket Architecture](./WEBSOCKET_ARCHITECTURE.md)
- [Project Memory](./project-memory.md)
