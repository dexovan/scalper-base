# SCALPER-BASE PROJECT MEMORY

**Last Updated:** 2025-11-22
**Purpose:** Persistent knowledge base for critical problems, solutions, and best practices

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
