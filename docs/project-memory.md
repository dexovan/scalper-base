# SCALPER-BASE PROJECT MEMORY

**Last Updated:** 2025-11-21
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

### Ports & Services

- **8080** - Dashboard (web server)

  - `web/server.js`
  - PM2 name: `dashboard`

- **8090** - Engine API (kombinovani)
  - Monitor API: `/api/monitor/*`
  - Feature Engine API: `/api/features/*`
  - Microstructure API: `/api/microstructure/*`
  - `src/index.js`
  - PM2 name: `engine`

### PM2 Management

```bash
pm2 status              # Check status
pm2 logs engine --lines 20
pm2 restart engine
pm2 restart dashboard
```

**VAŽNO:** Dashboard ponekad treba `pm2 delete dashboard` pa `pm2 start web/server.js --name dashboard`

---

## 💾 DATA STORAGE STRATEGY

### ✅ Šta KORISTI (u RAM-u):

- Live orderbook states (OrderbookManager)
- Live tickers (latestTickers Map)
- Live trades stream
- Feature Engine calculations

### ✅ Šta SNIMA (SQLite):

- `users.db` - User accounts, sessions
- (Planirana) `trade_features.db` - ML learning data

### ❌ Šta VIŠE NE SNIMA (isključeno):

- ~~Orderbook snapshots~~ - punjenje diska
- ~~Ticker updates~~ - punjenje diska
- ~~Individual trades~~ - punjenje diska

### 📊 Disk Usage Target:

- **Aktivno:** ~30-60 MB (30 dana ML podataka)
- **Total:** ~70 MB sa agregiranim podacima
- **Cleanup:** Automatski nakon 30 dana

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

### Git na serveru:

```bash
cd ~/scalper-base  # ⚠️ UVEK prvo uđi u direktorijum!
git pull origin master
pm2 restart engine
pm2 restart dashboard  # ako treba
```

**Greška ako nisi u direktorijumu:**

```
fatal: not a git repository (or any of the parent directories): .git
```

### Disk Cleanup (emergency):

```bash
# Check først
df -h && df -i

# Cleanup
sudo find /home/aiuser/scalper-base/data/orderbook -type f -delete
sudo find /home/aiuser/scalper-base/data/tickers -type f -delete
sudo find /home/aiuser/scalper-base/data/microcandles -type f -delete
sudo find /tmp -type f -mtime +0.04 -delete

# Verify
df -h && df -i
```

### Dashboard Access Issues:

1. Proveri PM2 status: `pm2 status`
2. Proveri logove: `pm2 logs dashboard --lines 20`
3. Ako je stopped: `pm2 delete dashboard && pm2 start web/server.js --name dashboard`

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

- `src/index.js` - Main entry point
- `src/http/monitorApi.js` - Combined API server (port 8090)
- `src/microstructure/OrderbookManager.js` - Orderbook state
- `src/features/featureEngine.js` - FAZA 4 orchestrator

### Web Dashboard:

- `web/server.js` - Dashboard server (port 8080)
- `web/views/dashboard.ejs` - Main dashboard view

---

**End of Project Memory**
_Automatski ažurirano tokom development sesija_
