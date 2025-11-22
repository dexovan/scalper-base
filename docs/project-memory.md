# SCALPER-BASE PROJECT MEMORY

**Last Updated:** 2025-11-22 23:45
**Purpose:** Persistent knowledge base for critical problems, solutions, and best practices

---

## ⚠️ KRITIČNA PRAVILA ZA AI ASISTENTA

### 🔴 **PRAVILO #1: UVEK PROVERI PRE NEGO ŠTO DODAJEŠ KOD**

**Problem:** AI često dodaje funkcije/varijable koje već postoje, što izaziva:

- `SyntaxError: Identifier 'X' has already been declared`
- Duplicate function declarations
- Engine crash-ove

**Obavezna procedura pre dodavanja bilo čega:**

1. **GREP SEARCH** - Proveri da li funkcija/varijabla već postoji:

   ```
   grep_search: "^export.*functionName|^function functionName|^const variableName"
   ```

2. **COUNT MATCHES** - Ako nađeš 1+ match, NE DODAVAJ DUPLIKAT!

3. **READ CONTEXT** - Pročitaj okolni kod da razumeš šta već postoji

4. **DIFF CHECK** - Uporedi što želiš dodati sa postojećim

**Primer greške (22.11.2025):**

```javascript
// Dodao sam:
export function getUniverseStats() { ... }  // Line 184

// Ali već je postojala:
export function getUniverseStats() { ... }  // Line 208

// Rezultat: ENGINE CRASH!
```

**Kako ispravno:**

```bash
# 1. Prvo pretraži
grep_search: "getUniverseStats"

# 2. Ako postoji - NE DODAVAJ!
# 3. Ako treba promeniti - EDIT postojeću, ne dodavaj novu
```

### 🟡 **PRAVILO #2: COMMIT MALI, TESTIRAJ ČESTO**

- Ne pravi 10 izmena odjednom
- Commit po commit, restart engine, proveri da li radi
- Ako nešto pukne, lakše je rollback-ovati

### 🟢 **PRAVILO #3: DOKUMENTUJ SVE U project-memory.md**

- Svaki kritični bug → dokumentuj ovde
- Svaka arhitekturalna odluka → zapiši razlog
- Svaka greška → objasni kako je nastala i kako je rešena

---

## 🔍 SYSTEM AUDIT - NOVEMBER 22, 2025

**Status:** 🚧 IN PROGRESS
**Started:** 2025-11-22 23:30
**Reason:** After repeated debugging sessions with endpoint confusion, missing awaits, and module conflicts, identified need for comprehensive architectural review and reorganization.

**Goal:** Map entire codebase structure, identify anti-patterns, document all endpoints, trace data flows, and prepare recommendations for centralized architecture.

### AUDIT FINDINGS - PART 1: API ENDPOINT INVENTORY

#### **Dashboard Server (PORT 8080)** - `web/server.js`

**Direct Routes (Dashboard-local handlers):**

| Method | Path             | Handler Location    | Purpose                        | Status   |
| ------ | ---------------- | ------------------- | ------------------------------ | -------- |
| GET    | `/login`         | `web/server.js:246` | Login page                     | ✅ Works |
| GET    | `/`              | `web/server.js:261` | Dashboard home (requires auth) | ✅ Works |
| GET    | `/dashboard`     | `web/server.js:269` | Dashboard alias                | ✅ Works |
| GET    | `/monitor`       | `web/server.js:277` | System monitor page            | ✅ Works |
| GET    | `/monitor-micro` | `web/server.js:284` | Microstructure page (FAZA 3)   | ✅ Works |

**Router Mounts (Dashboard sub-routes):**

| Mount Path      | Router File                  | Endpoints                                  | Purpose                                         |
| --------------- | ---------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `/api/universe` | `web/routes/api-universe.js` | `GET /`, `GET /categories`                 | Universe data (cross-process via disk)          |
| `/api/features` | `web/routes/api-features.js` | 9 endpoints                                | Feature Engine API (deprecated - proxied below) |
| `/api`          | `web/routes/api.js`          | `GET /health/*`                            | Health checks                                   |
| `/api/test`     | `web/routes/api-test.js`     | 4 test endpoints                           | Dev testing routes                              |
| `/` (root)      | `web/routes/auth.js`         | `GET /login`, `POST /login`, `GET /logout` | Authentication                                  |

**Proxy Middleware (Forward to Engine on 8090):**

| Dashboard Path          | Engine Target                                     | Timeout | Purpose                  |
| ----------------------- | ------------------------------------------------- | ------- | ------------------------ |
| `/monitor/api/*`        | `http://localhost:8090/api/monitor/*`             | 30s     | Monitor API proxy        |
| `/api/microstructure/*` | `http://localhost:8090/api/microstructure/*`      | 30s     | Microstructure API proxy |
| `/api/symbol/*`         | `http://localhost:8090/api/symbol/*`              | 30s     | Symbol data proxy        |
| `/api/health`           | `http://localhost:8090/api/microstructure/health` | 30s     | Health proxy             |
| `/api/features/*`       | `http://localhost:8090/api/features/*`            | 30s     | Feature Engine proxy     |

⚠️ **PROBLEM IDENTIFIED:**

- Confusion between local routes and proxied routes
- `/api/features` defined TWICE (local router + proxy) - proxy overwrites local
- No central registry of all endpoints

---

#### **Engine Server (PORT 8090)** - `src/http/monitorApi.js`

**All Engine API Endpoints:**

| Method | Path                                     | Handler Line | Purpose                      | Data Source                                |
| ------ | ---------------------------------------- | ------------ | ---------------------------- | ------------------------------------------ |
| GET    | `/api/monitor/summary`                   | 155          | System overview              | `metrics`, `wsMetrics`, `OrderbookManager` |
| GET    | `/api/monitor/logs`                      | 229          | PM2 log viewer               | File system (`logs/`)                      |
| GET    | `/api/monitor/tickers`                   | 250          | Live ticker prices           | `latestTickers` Map (RAM)                  |
| GET    | `/api/monitor/trades`                    | 262          | Recent trades                | `recentTrades` Array (RAM)                 |
| GET    | `/api/monitor/storage`                   | 277          | Disk usage stats             | `getStorageStats()`                        |
| GET    | `/api/monitor/universe`                  | 297          | Universe snapshot            | `getUniverseSnapshot()` from `universe_v2` |
| GET    | `/api/monitor/symbols/:category`         | 328          | Symbols by category          | `getSymbolsByCategory()`                   |
| GET    | `/api/monitor/symbol/:symbol`            | 381          | Single symbol full data      | `getSymbolMeta()` + tickers + orderbook    |
| GET    | `/api/symbol/:symbol/basic`              | 412          | Symbol basic info            | `getSymbolMeta()`                          |
| GET    | `/api/symbols`                           | 459          | All symbols list             | `getUniverseSnapshot()`                    |
| GET    | `/api/monitor/symbols`                   | 482          | Monitor symbols (duplicate?) | `getUniverseSnapshot()`                    |
| POST   | `/api/monitor/refresh-ws`                | 523          | Force WS reconnect           | `bybitPublic` instance                     |
| GET    | `/api/symbol/:symbol/micro`              | 550          | Microstructure stats         | `OrderbookManager`                         |
| GET    | `/api/symbol/:symbol/orderbook`          | 582          | Orderbook depth              | `OrderbookManager`                         |
| GET    | `/api/symbol/:symbol/trades`             | 616          | Symbol trades                | `recentTrades` filter                      |
| GET    | `/api/symbol/:symbol/candles/:timeframe` | 642          | OHLCV candles                | Bybit REST API                             |
| GET    | `/api/microstructure/symbols`            | 670          | All symbols micro stats      | `OrderbookManager.getAllSymbols()`         |
| GET    | `/api/microstructure/health`             | 704          | Microstructure health        | `OrderbookManager.getHealthMetrics()`      |
| GET    | `/api/features/health`                   | 767          | Feature Engine health        | `FeatureEngine.getHealth()`                |
| GET    | `/api/features/config`                   | 786          | Feature config               | `FeatureEngine.getConfig()`                |
| GET    | `/api/features/overview`                 | 805          | All features overview        | `FeatureEngine.getOverview()`              |
| GET    | `/api/features/symbol/:symbol`           | 824          | Symbol-specific features     | `FeatureEngine.getFeaturesBySymbol()`      |
| POST   | `/api/features/update`                   | 844          | Trigger feature update       | `FeatureEngine.updateFeatures()`           |

⚠️ **PROBLEMS IDENTIFIED:**

1. **Endpoint Duplication:**

   - `/api/symbols` (line 459) vs `/api/monitor/symbols` (line 482) - both return universe
   - `/api/monitor/universe` vs `/api/symbols` - redundant

2. **Inconsistent Naming:**

   - Some use `/api/monitor/...` prefix
   - Some use `/api/...` directly
   - No clear pattern when to use which

3. **Mixed Responsibilities:**

   - `monitorApi.js` handles Monitor + Microstructure + Features - should be split

4. **Unused Alternative:** `src/http/simpleMonitorApi.js` exists but not used (87 lines, similar endpoints)

---

### AUDIT FINDINGS - PART 2: MODULE DEPENDENCIES

#### **Critical Module Relationships:**

```
src/index.js (Engine Entry)
  ├─ src/connectors/bybitPublic.js (WebSocket)
  │   └─ src/microstructure/OrderbookManager.js
  ├─ src/ws/eventHub.js (Event aggregation)
  │   └─ src/connectors/bybitPublic.js (circular?)
  ├─ src/http/monitorApi.js (API Server)
  │   ├─ src/core/metrics.js
  │   ├─ src/monitoring/wsMetrics.js
  │   ├─ src/market/universe_v2.js ✅
  │   ├─ src/microstructure/OrderbookManager.js
  │   └─ src/features/featureEngine.js
  └─ src/market/universe_v2.js (Market Universe)
      └─ src/connectors/bybitPublic.js (for fetch)

web/server.js (Dashboard Entry)
  ├─ web/routes/api-universe.js
  │   └─ src/market/universe_v2.js ✅
  ├─ web/routes/api-features.js
  │   └─ src/features/featureEngine.js (direct import!)
  ├─ web/routes/api.js (Health)
  ├─ web/routes/auth.js
  └─ web/auth/* (middleware, db)

src/features/featureEngine.js
  ├─ src/features/orderbookImbalance.js
  ├─ src/features/wallsSpoofing.js
  ├─ src/features/flowDelta.js
  ├─ src/features/volatilityEngine.js
  ├─ src/features/feeLeverageEngine.js
  ├─ src/features/pumpPreSignals.js
  ├─ src/utils/logger.js
  └─ src/market/universe.js ⚠️ STARI!
```

⚠️ **PROBLEMS IDENTIFIED:**

1. **universe.js vs universe_v2.js Confusion:**

   - `src/market/universe.js` (165 lines) - DEPRECATED, stari kod
   - `src/market/universe_v2.js` (246 lines) - AKTIVAN
   - `featureEngine.js` uvozi `universe.js` umesto `universe_v2.js` (line 30)
   - Danas smo imali bug jer je `api-universe.js` importovao stari modul

2. **Direct Cross-Process Imports:**

   - `web/routes/api-features.js` direktno uvozi `src/features/featureEngine.js`
   - Ali Feature Engine je u Engine procesu (8090), Dashboard je (8080)
   - Ovo može raditi samo ako dele kod, ali NE dele state!
   - Bolje bi bilo da Feature API rute budu samo proxy

3. **Circular Import Risk:**

   - `bybitPublic.js` → `OrderbookManager.js`
   - `eventHub.js` → `bybitPublic.js` (via publicEmitter)
   - Potencijalni circular dependency

4. **Logger Duplication:**
   - Svi feature engine-i uvode `src/utils/logger.js`
   - Logger bi trebao biti centralizovan Singleton

---

### AUDIT FINDINGS - PART 3: DATA FLOW ANALYSIS

#### **Real-Time Data Flow (WebSocket → Browser):**

```
1. Bybit WebSocket
   ↓ (raw messages)
2. src/connectors/bybitPublic.js
   ├─ Parse & validate
   ├─ Update OrderbookManager (orderbook updates)
   ├─ Emit event via publicEmitter
   └─ Store in latestTickers Map
   ↓
3. src/ws/eventHub.js
   ├─ Listen to publicEmitter
   ├─ Aggregate events
   └─ (Optional) trigger features update
   ↓
4. src/http/monitorApi.js
   ├─ Reads latestTickers Map
   ├─ Reads OrderbookManager state
   └─ Serves via GET /api/monitor/tickers
   ↓
5. web/server.js (proxy middleware)
   ├─ Dashboard calls /monitor/api/tickers
   └─ Proxies to localhost:8090/api/monitor/tickers
   ↓
6. Browser (dashboard.ejs)
   ├─ fetchWithTimeout() calls /monitor/api/tickers
   ├─ Parses JSON response
   └─ Updates DOM
```

#### **Universe Data Flow (Periodic + On-Demand):**

```
ENGINE PROCESS (8090):
1. src/index.js startup
   ├─ await initUniverse() (from universe_v2.js)
   ├─ Fetch from Bybit /v5/market/instruments-info
   ├─ Categorize (Prime/Normal/Wild)
   ├─ Store in UniverseState (RAM)
   └─ Write to data/system/universe.v2.json (disk)
   ↓
2. Periodic refresh (every X minutes)
   └─ Repeat step 1

DASHBOARD PROCESS (8080):
3. User clicks Universe tab in browser
   ↓
4. Dashboard frontend calls /api/universe
   ↓
5. web/routes/api-universe.js
   ├─ await getUniverseSnapshot() (from universe_v2.js)
   ├─ universe_v2 checks if UniverseState empty
   ├─ If empty → loadExistingUniverse() reads data/system/universe.v2.json
   └─ Returns JSON
   ↓
6. Browser filters by category and renders table
```

⚠️ **PROBLEM IDENTIFIED:**

- Dual-path access (Engine direct, Dashboard via disk)
- No notification mechanism when Universe updates
- Dashboard shows stale data until refresh

---

### AUDIT FINDINGS - PART 4: ASYNC/AWAIT VALIDATION

**Async Functions Found:**

| File                            | Function                    | Awaited? | Issue                                                           |
| ------------------------------- | --------------------------- | -------- | --------------------------------------------------------------- |
| `src/market/universe_v2.js:152` | `getUniverseSnapshot()`     | ⚠️       | Fixed today - missing await in `index.js:58` caused 170 crashes |
| `web/routes/api-universe.js:13` | `router.get("/", async...)` | ✅       | Awaits `getUniverseSnapshot()`                                  |
| `src/http/monitorApi.js:155`    | `/api/monitor/summary`      | ⚠️       | Doesn't await `getUniverseSnapshot()` on line 172               |
| `src/http/monitorApi.js:297`    | `/api/monitor/universe`     | ✅       | Properly awaits                                                 |
| `src/features/featureEngine.js` | `updateFeatures()`          | ⚠️       | Returns Promise but callers may not await                       |

⚠️ **PROBLEMS TO FIX:**

1. **monitorApi.js line 172:**

   ```javascript
   // POGREŠNO (not awaited):
   universe: getUniverseSnapshot(),

   // ISPRAVNO:
   universe: await getUniverseSnapshot(),
   ```

2. **Feature Engine calls:**
   - Need to audit all places where `FeatureEngine.updateFeatures()` is called
   - Ensure proper error handling if Promise rejects

---

### AUDIT FINDINGS - PART 5: ANTI-PATTERNS & CODE SMELLS

#### 🔴 **Critical Issues:**

1. **Endpoint Chaos:**

   - No single source of truth for API routes
   - Routes split across 8+ files
   - Overlapping/duplicate endpoints
   - Inconsistent naming conventions

2. **Module Confusion:**

   - `universe.js` (old) vs `universe_v2.js` (new) both exist
   - Imports use wrong module randomly
   - No deprecation warnings in old files

3. **Cross-Process State Sharing:**

   - Dashboard and Engine share code but not state
   - Rely on disk files for IPC
   - No real-time sync mechanism

4. **Missing Error Boundaries:**

   - Many async functions don't have try/catch
   - Proxy timeouts added today but errors not logged properly

5. **No API Documentation:**
   - No OpenAPI/Swagger spec
   - No comments explaining what each endpoint does
   - Frontend guesses endpoint structure

#### ⚠️ **Medium Issues:**

6. **Duplicate API Servers:**

   - `monitorApi.js` (880 lines, active)
   - `simpleMonitorApi.js` (256 lines, unused?)
   - Why two files?

7. **Feature Engine Import in Dashboard:**

   - `web/routes/api-features.js` directly imports engine code
   - Should proxy to Engine API instead

8. **Global State in Modules:**

   - `latestTickers` Map in `monitorApi.js`
   - `recentTrades` Array in `monitorApi.js`
   - Should be in centralized State Manager

9. **No Request Validation:**

   - API endpoints don't validate params
   - No input sanitization
   - Security risk

10. **Inconsistent Response Formats:**
    - Some return `{ success: true, data: {...} }`
    - Some return raw data
    - Some return `{ error: "..." }`
    - No standard error format

---

### AUDIT FINDINGS - PART 6: FILE ORGANIZATION

**Current Structure:**

```
scalper-base/
├── src/               (Engine Backend)
│   ├── config/        (Configuration)
│   ├── connectors/    (Bybit WebSocket/REST)
│   ├── core/          (metrics.js)
│   ├── features/      (Feature Engine - 7 modules)
│   ├── http/          (monitorApi.js + simpleMonitorApi.js)
│   ├── market/        (universe.js + universe_v2.js + symbolProfile.js)
│   ├── microstructure/(OrderbookManager.js)
│   ├── monitoring/    (health.js, wsMetrics.js, metricsTracker.js)
│   ├── storage/       (jsonStore.js)
│   ├── utils/         (dataStorage.js, logger.js)
│   ├── ws/            (eventHub.js)
│   └── index.js       (Engine Entry Point)
│
├── web/               (Dashboard Frontend)
│   ├── auth/          (auth.js, middleware.js)
│   ├── public/        (Static files, monitor-api.js client)
│   ├── routes/        (5 route files)
│   ├── views/         (EJS templates)
│   └── server.js      (Dashboard Server Entry Point)
│
├── data/              (Persistent Data)
│   ├── sessions/      (SQLite session store)
│   └── system/        (universe.v2.json)
│
├── tests/             (Test files - 9 files)
└── docs/              (project-memory.md)
```

⚠️ **PROBLEMS:**

1. **No Clear Separation:**

   - `/src/http/` mixes API routes with business logic
   - `/web/routes/` has local handlers AND proxy configs
   - Feature Engine logic scattered across 7 files

2. **Flat Structure:**

   - `/src/` has 15+ subdirectories at root level
   - Hard to navigate
   - No grouping by domain (Trading, Monitoring, Features, etc.)

3. **Mixed Concerns:**

   - `monitorApi.js` handles Monitor + Microstructure + Features
   - Should be 3 separate API routers

4. **No API Layer:**
   - Business logic mixed with route handlers
   - No service/controller separation
   - Hard to test

---

### IMMEDIATE ACTION ITEMS (Before Refactor):

1. ✅ **Fix Missing Await in monitorApi.js:**

   - Line 172: `universe: await getUniverseSnapshot()`

2. ✅ **Delete or Deprecate universe.js:**

   - Rename to `universe.js.deprecated`
   - Or add big warning comment at top

3. ✅ **Fix FeatureEngine Import:**

   - `featureEngine.js` line 30: Change from `universe.js` to `universe_v2.js`

4. ✅ **Document All Endpoints:**

   - Create `docs/API_ENDPOINTS.md` with full list

5. ⏳ **Discuss Architecture:**
   - Review findings with Dejan
   - Decide on reorganization strategy

---

### NEXT STEPS:

**STEP 2:** Discuss Architecture Options (see below)

**STEP 3:** Design New Structure (after agreement)

---

## 📋 META: O ovom fajlu

**Svrha:** Automatski knowledge base za Scalper-Base projekat
**Ažuriranje:** AI automatski dodaje kritične probleme i rešenja tokom razvoja
**Pravilo:** ⚠️ **NIKAD NE BRISATI** ovaj fajl!
**Owner permission:** Dejan - odobrio automatsko ažuriranje (21.11.2025)
**Commit:** Uvek git commit ovaj fajl kada se ažurira

---

## 🔴 KRITIČNI PROBLEMI I REŠENJA

### [2025-11-22] Market Universe Filtering - Multi-Process Architecture Bug - REŠENO ✅

**Problem:**

- Universe category tabs (Prime/Normal/Wild/All) prikazivali isti sadržaj (6 Prime simbola)
- Engine se restartovao svakih 3 sekunde (170+ restarta)
- 504 Gateway Timeout greške na svim API endpointima
- Dashboard nije mogao da učita universe podatke

**Root Cause (4-layer problem):**

1. **Frontend routing:** Dashboard zvao pogrešan endpoint `/monitor/api/symbols/Prime` umesto `/api/universe`
2. **Backend imports:** `api-universe.js` importovao stari `universe.js` umesto `universe_v2.js`
3. **Process isolation:** Engine (PM2 proces na 8090) i Dashboard (PM2 proces na 8080) ne dele RAM
4. **Missing async/await:** `getUniverseSnapshot()` promenjeno u async ali nije awaited u `index.js`

**Rešenje:**

1. **Dashboard frontend** (`web/views/dashboard.ejs`):

   ```javascript
   // BILO: const symbolsUrl = `/monitor/api/symbols/Prime`
   // SADA: const symbolsUrl = `/api/universe`
   // Filter logika: Object.values(data.symbols).filter(s => s.category === category)
   ```

2. **API route** (`web/routes/api-universe.js`):

   ```javascript
   // BILO: } from "../../src/market/universe.js";
   // SADA: } from "../../src/market/universe_v2.js";

   // BILO: router.get("/", (req, res) => { const uni = getUniverseSnapshot();
   // SADA: router.get("/", async (req, res) => { const uni = await getUniverseSnapshot();
   ```

3. **Universe module** (`src/market/universe_v2.js`):

   ```javascript
   // Dodato auto-load za cross-process pristup:
   export async function getUniverseSnapshot() {
     if (
       !UniverseState.fetchedAt ||
       Object.keys(UniverseState.symbols || {}).length === 0
     ) {
       await loadExistingUniverse(); // Učitaj sa diska ako je state prazan
     }
     return JSON.parse(JSON.stringify(UniverseState));
   }
   ```

4. **Engine startup** (`src/index.js` line 58):

   ```javascript
   // BILO: const universeCheck = getUniverseSnapshot();
   // SADA: const universeCheck = await getUniverseSnapshot();
   ```

5. **Proxy timeouts** (`web/server.js`):

   ```javascript
   // Dodato na sve proxy middleware:
   timeout: 30000,
   proxyTimeout: 30000,
   ```

6. **Client-side timeout** (`web/views/dashboard.ejs`):
   ```javascript
   // BILO: async fetchWithTimeout(url, options = {}, timeout = 10000)
   // SADA: async fetchWithTimeout(url, options = {}, timeout = 30000)
   ```

**Commits:**

- `60b35d9` - Add debug logging for universe API response
- `26d747f` - Fix universe API to use universe_v2.js instead of universe.js
- `bbb0ed4` - Add universe init verification logging
- `ecbcd75` - Fix universe_v2 auto-load from disk for dashboard process
- `522b6d8` - Increase proxy timeout to 30s to fix 504 errors
- `8a73c62` - Increase client-side fetch timeout to 30s to match proxy timeout
- `29ae1d3` - Fix: await getUniverseSnapshot() in engine startup

**Rezultat:**

- ✅ Universe kategorije filtriraju ispravno (Prime=6, Normal=494, Wild=0, All=500)
- ✅ Engine stabilan (nema više crash-ova)
- ✅ 504 greške eliminisane
- ✅ Dashboard i Engine komuniciraju preko `/api/universe` endpointa

**Lekcija:**
U multi-process PM2 arhitekturi, in-memory singletons ne funkcionišu preko procesa. Mora postojati:

- Disk persistence (`data/system/universe.v2.json`)
- Auto-load mehanizam za cross-process pristup
- Pravilno async/await propagiranje kroz codebase

---

### [2025-11-21] Disk Space / Inode Overflow - REŠENO ✅

**Problem:**

- Sistem puni disk za 2-3 sata (35GB → 100% full)
- Inode-ovi na 100% (2.4M fajlova, najviše u `/data/orderbook/`)
- Git pull ne radi: "No space left on device"

**Root Cause:**

- Orderbook snapshots snimaju SVAKI update (~100-1000/sec po simbolu)
- Ticker updates takođe snimaju svaki event
- Rezultat: 400,000+ JSON fajlova u nekoliko sati

**Rešenje:**

1. **Isključeno disk snimanje:**

   - `src/microstructure/OrderbookManager.js` - line 98: `// storeOrderbookSnapshot()`
   - `src/connectors/bybitPublic.js` - lines 266, 309: `// writeTickersToFile()`
   - `src/ws/eventHub.js` - line 33: `// storeTicker()`
   - `src/index.js` - line 78: `// saveTicker()`

2. **Cron cleanup već postoji:**

   - `/etc/cron.d/scalper-cleanup` - čisti fajlove starije od 6h svakih 6h

3. **Emergency cleanup:**
   ```bash
   sudo find /home/aiuser/scalper-base/data/orderbook -type f -delete
   sudo find /home/aiuser/scalper-base/data/tickers -type f -delete
   sudo find /home/aiuser/scalper-base/data/microcandles -type f -delete
   ```

**Commit:** `d7c279b` - "feat: Disable orderbook and ticker disk storage to prevent disk overflow"

**Monitoring:**

```bash
df -h   # Disk space
df -i   # Inodes (kritično!)
```

---

### [2025-11-21] Feature Engine Import Error - REŠENO ✅

**Problem:**

```
SyntaxError: The requested module '../features/featureEngine.js'
does not provide an export named 'FeatureEngine'
```

**Root Cause:**

- `featureEngine.js` koristi `export default FeatureEngine`
- `monitorApi.js` pokušavao `import { FeatureEngine }` (named import)

**Rešenje:**

```javascript
// POGREŠNO:
import { FeatureEngine } from "../features/featureEngine.js";

// ISPRAVNO:
import FeatureEngine from "../features/featureEngine.js";
```

**Lokacija:** `src/http/monitorApi.js` - line 23

**Best Practice:** Uvek proveri da li je `export default` ili `export { ... }`

---

## ⚙️ SYSTEM ARCHITECTURE

### Server Setup

- **Production Server:** scalp-vps (na kojem radimo)
- **Singapore Server:** 5.223.76.141 (backup/test)

### Multi-Process Architecture (PM2)

**Engine proces (port 8090):**

- `src/index.js` - Main entry point
- PM2 name: `engine`
- Funkcije:
  - WebSocket connectors (Bybit orderbook + tickers)
  - Market Universe initialization i refresh
  - Orderbook state management (RAM)
  - Feature Engine calculations
  - Monitor API server (Express)

**Dashboard proces (port 8080):**

- `web/server.js` - Web dashboard server
- PM2 name: `dashboard`
- Funkcije:
  - Serve frontend (EJS templates)
  - Proxy middleware (http-proxy-middleware) za Engine APIs
  - User authentication
  - Static files serving

**⚠️ KRITIČNO - Process Isolation:**

- Engine i Dashboard su **ODVOJENI PM2 procesi** - ne dele RAM!
- In-memory state mora biti persistovan na disk za cross-process pristup
- Primer: `data/system/universe.v2.json` - Engine piše, Dashboard čita

### Ports & Services

- **8080** - Dashboard (web server)

  - Frontend: `http://5.223.76.141:8080`
  - Proxy routes:
    - `/monitor/api/*` → `http://localhost:8090/api/monitor/*`
    - `/api/features/*` → `http://localhost:8090/api/features/*`
    - `/api/microstructure/*` → `http://localhost:8090/api/microstructure/*`
    - `/api/universe` → Dashboard-local route (čita iz universe_v2.js)
  - Timeout config: `timeout: 30000, proxyTimeout: 30000`

- **8090** - Engine API (kombinovani Express server)
  - Monitor API: `/api/monitor/*`
    - `/api/monitor/summary` - System stats
    - `/api/monitor/tickers` - Live ticker prices
    - `/api/monitor/trades` - Recent trades
    - `/api/monitor/storage` - Disk usage stats
  - Feature Engine API: `/api/features/*`
    - `/api/features/health` - Feature Engine status
    - `/api/features/overview` - All features
    - `/api/features/symbol/:symbol` - Per-symbol features
  - Microstructure API: `/api/microstructure/*`
    - `/api/microstructure/symbols` - Orderbook stats

### Data Flow Example:

1. **User** klikne na Universe tab u browseru
2. **Dashboard frontend** (8080) pozove `/api/universe`
3. **Dashboard backend** API route pozove `getUniverseSnapshot()` iz `universe_v2.js`
4. **universe_v2.js** vidi da je state prazan → učita `data/system/universe.v2.json` (auto-load)
5. **Engine** (8090) periodično refreshuje universe i piše u `universe.v2.json`
6. **Dashboard** vraća JSON response browseru
7. **Frontend** renderuje tabelu sa filterovanim simbolima

### PM2 Management

```bash
pm2 status              # Check status
pm2 logs engine --lines 50 --nostream
pm2 logs dashboard --lines 50 --nostream
pm2 restart engine
pm2 restart dashboard
pm2 describe engine     # Detaljne info (uptime, restarts, memory)
```

**⚠️ VAŽNO - Engine Restart Count:**

- Ako engine ima visok broj restarta (50+), to znači da crash-uje
- Proveri error log: `pm2 logs engine --err --lines 50`
- Tipični uzroci:
  - Missing `await` na async funkcijama
  - Uncaught promise rejections
  - Memory leaks (proveri sa `pm2 monit`)

**Dashboard ponekad treba full restart:**

```bash
pm2 delete dashboard
pm2 start web/server.js --name dashboard
```

---

## 💾 DATA STORAGE STRATEGY

### ✅ Šta KORISTI (u RAM-u):

- Live orderbook states (OrderbookManager)
- Live tickers (latestTickers Map)
- Live trades stream
- Feature Engine calculations
- Universe state (UniverseState singleton u universe_v2.js)

### ✅ Šta SNIMA (na disk):

**SQLite:**

- `users.db` - User accounts, sessions
- (Planirana) `trade_features.db` - ML learning data

**JSON persistence:**

- `data/system/universe.v2.json` - Market Universe snapshot (500 simbola, ~211KB)
  - Ažurira se periodično iz engine-a (svaki refresh)
  - Čita se iz dashboard-a (auto-load na demand)
  - Format: `{ fetchedAt, symbols: {...}, stats: {...} }`

**Monitoring:**

- PM2 logovi: `~/.pm2/logs/` (auto-rotate)
- Git repo: Izmene koda

### ❌ Šta VIŠE NE SNIMA (isključeno radi disk space-a):

**VAŽNO:** Ove feature-e smo NAMERNO ISKLJUČILI da ne puni disk!

1. **Orderbook snapshots** (isključeno u `src/microstructure/OrderbookManager.js`):

   ```javascript
   // Line 98: storeOrderbookSnapshot() - ZAKOMENTARISANO
   // Razlog: 100-1000 snapshots/sec po simbolu = 400K+ fajlova za 2h
   ```

2. **Ticker updates** (isključeno na 3 lokacije):

   ```javascript
   // src/connectors/bybitPublic.js - lines 266, 309: writeTickersToFile()
   // src/ws/eventHub.js - line 33: storeTicker()
   // src/index.js - line 78: saveTicker()
   // Razlog: Svaki ticker update = novi fajl, punjenje inode-ova
   ```

3. **Individual trades** (nikad implementirano):
   ```javascript
   // Razlog: Previše podataka, nepotrebno za ML
   ```

**Ako ikad treba re-enableovati:**

- Mora postojati agregacija (npr. samo svaki 10. snapshot)
- Mora postojati retention limit (npr. samo zadnjih 1h)
- Mora se pratiti `df -i` (inode usage) pored `df -h`

### 📊 Disk Usage Target:

- **Aktivno:** ~30-60 MB (30 dana ML podataka kada se implementira)
- **Total:** ~70 MB sa agregiranim podacima
- **Current:** ~21GB stabilno (pre čišćenja bilo 35GB)
- **Cleanup:** Automatski nakon 30 dana (cron job)

---

## 🧠 FAZA 4: FEATURE ENGINE

### Status: ✅ Implementirano

**Moduli:**

1. `orderbookImbalance.js` - Orderbook pressure analysis
2. `volatilityEngine.js` - Price movement volatility
3. `feeLeverageEngine.js` - Fee/leverage calculations
4. `flowDelta.js` - Buy/sell flow analysis
5. `wallsSpoofing.js` - Large order walls detection
6. `pumpPreSignals.js` - Pump pre-signal detection
7. `featureEngine.js` - Central orchestrator

### API Endpoints (na portu 8090):

- `GET /api/features/health` - Engine status
- `GET /api/features/config` - Configuration
- `GET /api/features/overview` - All features overview
- `GET /api/features/symbol/:symbol` - Symbol-specific features
- `POST /api/features/update` - Trigger update

### Dashboard Integration:

- FAZA 3: Microstructure Analytics - radi ✅
- FAZA 4: Feature Engine - radi ✅

---

## 🛠️ COMMON WORKFLOWS

### Deploy Changes (Standardni workflow):

```bash
# Lokalno (Windows):
git add .
git commit -m "Opis izmene"
git push

# Na serveru (Linux):
cd ~/scalper-base  # ⚠️ UVEK prvo uđi u direktorijum!
git pull origin master
pm2 restart engine
pm2 restart dashboard  # ako su frontend izmene

# Proveri status:
pm2 status
pm2 logs engine --lines 20 --nostream
```

**⚠️ Greška ako nisi u direktorijumu:**

```
fatal: not a git repository (or any of the parent directories): .git
```

### Debug Workflow (kada nešto ne radi):

1. **Proveri PM2 status:**

   ```bash
   pm2 status  # Gledaj restarts count - ako raste, engine pada!
   pm2 describe engine  # Detalji: uptime, memory, error count
   ```

2. **Proveri logove:**

   ```bash
   pm2 logs engine --lines 50 --nostream  # Output log
   pm2 logs engine --err --lines 50  # Error log
   pm2 logs dashboard --lines 50 --nostream
   ```

3. **Proveri da li API odgovara:**

   ```bash
   curl http://localhost:8090/api/monitor/summary  # Engine API
   curl http://localhost:8080/api/universe  # Dashboard API
   ```

4. **Proveri browser console:**
   - F12 → Console tab
   - Gledaj za 504 errors, JavaScript exceptions
   - Proveri Network tab za failed requests

### Common Issues & Fixes:

**Problem: 504 Gateway Timeout**

- **Uzrok:** Client timeout kraći od server timeout
- **Fix:** Proveri `fetchWithTimeout` default u dashboard.ejs (treba 30000ms)
- **Fix:** Proveri proxy timeout u web/server.js (treba 30000ms)

**Problem: Engine se restartuje (visok restart count)**

- **Uzrok:** Crash zbog missing await, null pointer, memory leak
- **Fix:** Proveri error log: `pm2 logs engine --err --lines 100`
- **Fix:** Najčešće: async funkcija nije awaited

**Problem: Universe ne učitava podatke**

- **Uzrok:** Process isolation - dashboard ne vidi engine state
- **Fix:** Proveri da `getUniverseSnapshot()` ima auto-load iz fajla
- **Fix:** Proveri da `data/system/universe.v2.json` postoji i nije prazan

**Problem: Disk full / No space left on device**

- **Uzrok:** Ticker/orderbook snimanje nije isključeno
- **Fix:** Proveri da su komentarisani: OrderbookManager.js, bybitPublic.js, eventHub.js
- **Fix:** Emergency cleanup (vidi dole)

### Git na serveru:

### Emergency Disk Cleanup:

```bash
# Check først
df -h   # Disk space percentage
df -i   # Inode usage (KRITIČNO!)

# Cleanup stari data fajlovi
sudo find /home/aiuser/scalper-base/data/orderbook -type f -delete
sudo find /home/aiuser/scalper-base/data/tickers -type f -delete
sudo find /home/aiuser/scalper-base/data/microcandles -type f -delete
sudo find /tmp -type f -mtime +0.04 -delete  # Tmp fajlovi stariji od 1h

# Verify
df -h && df -i

# Ako je i dalje full, proveri gde je problem:
du -sh /home/aiuser/scalper-base/* | sort -h
```

**Automatski cleanup:**

- Postoji cron job: `/etc/cron.d/scalper-cleanup`
- Radi svakih 6h, čisti fajlove starije od 6h
- Ali ako je snimanje uključeno, ne stigne da očisti!

### Dashboard Access Issues:

1. Proveri PM2 status: `pm2 status`
2. Proveri logove: `pm2 logs dashboard --lines 20`
3. Ako je stopped: `pm2 delete dashboard && pm2 start web/server.js --name dashboard`
4. Proveri port: `netstat -tulpn | grep 8080` (treba da sluša)
5. Proveri browser: `http://5.223.76.141:8080` (clear cache ako treba)

---

## 🧩 MARKET UNIVERSE SYSTEM

### Šta je Market Universe?

Centralizovani registry svih trading simbola sa kategorijama i metadatama.

**Lokacija:** `src/market/universe_v2.js` (aktivan) + `data/system/universe.v2.json` (persistence)

**Struktura:**

```javascript
UniverseState = {
  fetchedAt: "2025-11-22T08:40:48.328Z",
  symbols: {
    BTCUSDT: {
      symbol: "BTCUSDT",
      category: "Prime", // Prime | Normal | Wild
      maxLeverage: 125,
      status: "Trading",
      minPrice: "0.01",
      minQty: "0.00001",
      // ... ostali Bybit metadata
    },
    // ... 500 simbola total
  },
  stats: {
    totalSymbols: 500,
    primeCount: 6, // BTC, ETH, BNB, ADA, DOT, AVAX
    normalCount: 494, // Altcoins - Andre sweet spot
    wildCount: 0, // Risky/new listings
  },
};
```

**Kategorije:**

1. **Prime (6 simbola):**

   - BTC, ETH, BNB, ADA, DOT, AVAX
   - Najviša likvidnost
   - **Andre strategy ih PRESKAČE** (previše stabilni)

2. **Normal (494 simbola):**

   - Mid/low-cap altcoins
   - **Andre strategy targeting**
   - Dovoljna likvidnost ali volatilnost za profit

3. **Wild (0 simbola trenutno):**
   - Ekstremna volatilnost ili novi listings
   - Risky, potencijalni pump targets

**Initialization Flow:**

1. **Engine startup** (`src/index.js`):

   ```javascript
   await initUniverse(); // Učita sa diska ili fetch-uj sa Bybit
   const check = await getUniverseSnapshot(); // ⚠️ Mora await!
   ```

2. **Periodic refresh** (svaki X minuta):

   - Fetch `/v5/market/instruments-info` sa Bybit API
   - Kategorizuj simbole (prime/normal/wild logic)
   - Snimi u `data/system/universe.v2.json`

3. **Dashboard access** (`web/routes/api-universe.js`):
   ```javascript
   router.get("/", async (req, res) => {
     const uni = await getUniverseSnapshot(); // Auto-load sa diska ako treba
     res.json({ success: true, universe: uni });
   });
   ```

**Dashboard UI:**

- Tabs: Prime / Normal / Wild / All
- Filter logika: `Object.values(symbols).filter(s => s.category === category)`
- Table kolone: Symbol, Category, Leverage, Status (Price uklonjen)

**Zašto je bitno:**

- Single source of truth za sve simbole
- Pre-validation (ne tradujemo simbole van universe-a)
- Risk management (izbegavanje Prime/Wild kategorija)
- Performance (cache umesto API poziva za svaki simbol)

---

## 📈 PERFORMANCE NOTES

### Disk Space Historical:

- **Pre optimizacije:** 35GB korišćeno → 100% za 2-3h
- **Posle optimizacije:** ~21GB stabilno, raste <1GB/dan

### Inode Usage Historical:

- **Pre optimizacije:** 2.4M/2.4M (100%) → git ne radi
- **Posle optimizacije:** ~2.0M/2.4M (83%) → stabilno

### Memory Usage:

- **Engine:** ~430-450 MB (normalno sa live data)
- **Dashboard:** ~50-60 MB

---

## 🔮 FUTURE IMPROVEMENTS

### Planirano - ML Learning Database:

- SQLite tablica `trade_features`
- Snimanje samo trade decisions + outcomes
- ~30 MB/mesec (održivo!)
- Auto-cleanup posle 30 dana

### Planirano - Redis Cache (opciono):

- Za multi-server setup
- Cache feature calculations
- Redukovano CPU opterećenje

---

## 📚 IMPORTANT FILES

### Konfiguracija:

- `config/default.json` - Default config
- `config/production.json` - Production overrides
- `/etc/cron.d/scalper-cleanup` - Automated cleanup

### Core Engine:

- `src/index.js` - Main entry point (PM2 engine proces)
- `src/http/monitorApi.js` - Combined API server (port 8090)
- `src/microstructure/OrderbookManager.js` - Orderbook state (line 98: snimanje isključeno)
- `src/features/featureEngine.js` - FAZA 4 orchestrator
- `src/market/universe_v2.js` - Market Universe system (aktivan)
- `src/market/universe.js` - Stari, depreciran (ne koristiti!)
- `src/connectors/bybitPublic.js` - Ticker updates (lines 266, 309: snimanje isključeno)
- `src/ws/eventHub.js` - Event aggregation (line 33: snimanje isključeno)

### Web Dashboard:

- `web/server.js` - Dashboard server (port 8080, PM2 dashboard proces)
- `web/views/dashboard.ejs` - Main dashboard view
- `web/routes/api-universe.js` - Universe API endpoint (async, koristi universe_v2)

### Data Persistence:

- `data/system/universe.v2.json` - Market Universe snapshot (~211KB, 500 simbola)
- `data/users.db` - User accounts (SQLite)

### PM2 Config:

- `~/.pm2/logs/engine-out.log` - Engine stdout
- `~/.pm2/logs/engine-error.log` - Engine stderr
- `~/.pm2/logs/dashboard-out.log` - Dashboard stdout
- `~/.pm2/pids/engine-2.pid` - Engine PID file

---

## 🎓 LESSONS LEARNED

### Multi-Process Architecture:

**Problem:** Dashboard i Engine su odvojeni PM2 procesi - ne dele RAM!

**Rešenje:**

- In-memory state MORA biti persistovan (JSON fajlovi, SQLite, Redis)
- Implementirati auto-load logic (proveri da li je state prazan → učitaj sa diska)
- Async funkcije moraju biti awaited **SVUDA** u call chain-u

**Primer:**

```javascript
// ❌ POGREŠNO (izaziva crashes):
export function getUniverseSnapshot() {
  return UniverseState;
}

// ✅ ISPRAVNO:
export async function getUniverseSnapshot() {
  if (
    !UniverseState.fetchedAt ||
    Object.keys(UniverseState.symbols || {}).length === 0
  ) {
    await loadExistingUniverse(); // Auto-load iz fajla
  }
  return JSON.parse(JSON.stringify(UniverseState));
}

// ⚠️ I SVAKI CALLER MORA:
const universe = await getUniverseSnapshot(); // NE ZABORAVI await!
```

### Timeout Coordination:

**Problem:** Proxy timeout 30s, ali client timeout 10s → 504 errors

**Rešenje:**

- Client-side timeout >= Server-side timeout
- Dashboard `fetchWithTimeout`: 30000ms
- Proxy middleware: `timeout: 30000, proxyTimeout: 30000`

### Debugging Multi-Process Systems:

**Najbitnije alati:**

1. `pm2 describe engine` - Restart count pokazuje stabilnost
2. `pm2 logs engine --err` - Error log za crash uzroke
3. `curl localhost:8090/api/...` - Direktan API test
4. Browser DevTools Network tab - Client-side view
5. `df -i` ne samo `df -h` - Inode exhaustion je realan problem!

### Disk Space Management:

**Problem:** 400K+ fajlova za 2h, 100% inode usage

**Rešenje:**

- NAMERNO isključiti snimanje high-frequency data
- Komentarisati storage funkcije, ne samo disablovati flag
- Commit sa jasnim komentarom zašto je isključeno
- Dokumentovati u project-memory.md za buduću referencu

---

**End of Project Memory**
_Automatski ažurirano tokom development sesija_
