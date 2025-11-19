# DTrade / Dexovan AI Scalper – Arhitektura v1 (MAPA SISTEMA)

Ovaj dokument opisuje trenutnu arhitekturu projekta, ulogu svakog bitnog fajla i sloj kome pripada.

Struktura je koncipirana kao višeslojni sistem:

- **core/** – engine, scheduler, sistemsko stanje
- **connectors/** – Bybit konektori (WS + REST)
- **ws/** – real-time data (orderbook, tickers, tradeflow)
- **market/** – univerzum, simboli, profili, klasifikacija
- **monitoring/** – health, crash guard, metrički tracking
- **web/** – dashboard, login, API rute
- **data/** – fajl sistem za snapshotove, sesije, metrikе itd.

---

## 1. ROOT PROJEKTA

### Fajlovi u root-u

- `package.json`

  - Glavni Node projekat
  - Sadrži:
    - `"type": "module"` → ES modules
    - skripte (`npm start`, testovi ako ih dodamo)
    - zavisnosti (express, sqlite3, ws, itd.)

- `ecosystem.config.cjs`

  - PM2 konfiguracija:
    - proces `engine` (core / WS / obrada)
    - proces `dashboard` (web/server.js)
  - Definiše kako se servis podiže na serveru (Singapur VPS).

- `reset.sh`

  - Helper skripta za čišćenje/log rotate/restart (Linux).

- `LINUX_DEPLOYMENT.md`

  - Uputstvo za deploy na Linux server (Hetzner).

- `docs/*.txt`, `docs/PHASE-*.md`, `plan*.txt`
  - Dokumentacija faza (tvoj radni plan, šta je urađeno po fazama).
  - **Nisu deo runtime-a**, ali su kritični za razumevanje projekta.

---

## 2. DATA SLOJ (fajl sistem)

Folder: `data/`

- `data/users.db`

  - SQLite baza za korisnike (admin login).
  - Koristi se u `web/auth/auth.js`.

- `data/sessions/sessions.db`

  - SQLite baza za express-session store.
  - Konfigurisano u `web/server.js` preko `connect-sqlite3`.

- `data/system/universe.json`

  - Snapshot univerzuma simbola (Bybit USDT perp).
  - Puni se iz modula `src/market/universeFile.js` / `universe.js`.

- `data/system/logs/`

  - Sistemskih logovi (mogu se koristiti kasnije u “Engine Monitor” tabu).

- `data/orderbook/`

  - Orderbook snapshotovi po simbolu (npr. `BTCUSDT.json`).
  - Puni ih `src/ws/orderbookWatcher.js`.

- `data/metrics/`

  - Metrički fajlovi (MAI, WS status, health, itd.) – koristi `monitoring/metricsTracker.js` (ako/ kada ga povežemo).

- `data/tmp/`

  - Privremeni fajlovi (bufferi, testovi, future features).

- `data/trades/`
  - Logovi trejdova (kada ubacimo live trading modul).

---

## 3. SRC – GLAVNI ENGINE SLOJ

Folder: `src/`

### 3.1. `src/index.js`

- **Uloga**: Glavni entry point za `engine` proces.
- Tipično radi:
  - učitava config (`src/config`)
  - pokreće `core/bootstrap.js`
  - startuje WS konektore, market scanning, itd.

> Ovo je fajl koji PM2 koristi za `engine` (preko `ecosystem.config.cjs`).

---

## 4. CONFIG SLOJ

Folder: `src/config/`

- `paths.js`

  - Centralizovani path management:
    - `PROJECT_ROOT`
    - `DATA_DIR`
    - `TMP_DIR`
    - folderi za `profiles`, `orderbook`, `metrics`, itd.
  - Koriste ga i `src/*` moduli i `web/server.js`.

- `defaults.js`

  - Default vrednosti konfiguracija:
    - intervali osvežavanja,
    - default timeout-i,
    - max broj simbola, itd. (kad dopunimo).

- `index.js`
  - Glue modul:
    - spaja `default` podešavanja sa `config/*.json` iz `config/` root foldera (`config/default.json`, `config/production.json`).
    - omogućava: `import config from "../config/index.js";`.

---

## 5. BYBIT CONNECTORS

Folder: `src/connectors/`

### 5.1. `src/connectors/bybitPublic.js`

- **Uloga**: “High-level” javni connector ka Bybit-u.
- Radi sa:
  - `ws` podsistemom (ticker, trades, orderbook),
  - REST modulima (universe, instruments).
- Obično:
  - izveze funkcije tipa `startPublicFeeds()`, `getWsStatus()`, `refreshUniverse()`, itd.
  - koristi `./bybit/publicWS.js` i `./bybit/publicREST.js`.

### 5.2. Folder `src/connectors/bybit/`

- `publicWS.js`

  - Low-level WebSocket konektor:
    - konekcija na Bybit WS endpoint,
    - subscribe na `tickers`, `orderbook`, `publicTrade`, itd.
  - Emisija događaja prema `ws/eventHub.js`.

- `publicREST.js`

  - REST wrapper:
    - loaduje listu simbola,
    - market metadata,
    - instrument info,
    - može koristiti za health check Bybit API-a.

- `schema.js`
  - Definiše strukture/polje za:
    - `ticker` event,
    - `trade` event,
    - `orderbook` snapshot / diff,
    - možda instrument info (tickSize, lotSize, max leverage...).

---

## 6. CORE ENGINE SLOJ

Folder: `src/core/`

- `engine.js`

  - Glavni “brain” engine-a:
    - pokreće/koordinira:
      - WS feedove,
      - market univerzum,
      - klasifikaciju simbola,
      - skoriranje (u budućnosti).
    - biće centralno mesto za:
      - MAI,
      - režime (trend / chop / pump),
      - triggerovanje scalp strategija.

- `bootstrap.js`

  - Inicijalizacija sistema:
    - učitavanje configa,
    - inicijalizacija system state-a (`systemState.js`),
    - start konektora (`bybitPublic`),
    - start WS watcher-a (`ws/*`),
    - start health monitoringa (`monitoring/health.js`).

- `scheduler.js`

  - Zakazani taskovi:
    - periodičan refresh univerzuma,
    - čišćenje starih fajlova (retention),
    - snapshoti (once per X minuta),
    - future: dnevni/ satni rebalans.

- `systemState.js`
  - Globalna slika stanja:
    - koji simboli su aktivni,
    - koje WS konekcije rade,
    - zadnji health,
    - sistemski mutex-i/lockovi (ako treba).

---

## 7. MARKET SLOJ

Folder: `src/market/`

- `universe.js`

  - Radi sa listom svih simbola (USDT perp).
  - Poziva REST modul (`publicREST.js`) da povuče fresh listu.
  - Može da pravi filter:
    - isključeni simboli,
    - samo derivatives,
    - samo linear.

- `universeFile.js`

  - Radi I/O:
    - čita/piše `data/system/universe.json`.
  - Odvojeno od `universe.js` da bi testiranje bilo lakše.

- `symbolProfile.js`

  - Drži “profil” simbola:
    - volatnost / ATR,
    - fee + minimalan realan profit,
    - depth liqudity (orderbook),
    - istorija pumpanja.
  - Radi zajedno sa `symbolClassifier.js` & `marketUtils.js`.

- `symbolClassifier.js`

  - Klasifikacija simbola:
    - normalan / pump / illiquid / shitcoin / stable.
  - Koristi podatke iz `profiles`, `metrics`, `orderbook`.

- `marketUtils.js`
  - Helperi za rad sa cenama, tick-size, step-size, itd.

---

## 8. WS / REAL-TIME SLOJ

Folder: `src/ws/`

- `eventHub.js`

  - Centralni EventEmitter za sve WS događaje:
    - “ticker update”
    - “tradeflow event”
    - “orderbook update”
  - Konačna tačka za integraciju engine-a sa WS feedovima.

- `tickerHub.js`

  - Logika za:
    - prijem `tickers` eventova sa Bybit WS,
    - normalizaciju,
    - zapis u `data/metrics` ili `data/tmp`,
    - slanje dalje u `eventHub`.

- `tradeFlow.js`

  - Stream trade-ova:
    - agresor (buy/sell),
    - veličina,
    - tempo,
    - agregacija:
      - buy/sell ratio,
      - imbalans, spoofing patterni (u budućnosti).

- `orderbookWatcher.js`

  - Obrada orderbook-a:
    - snapshot/diff,
    - zapis u `data/orderbook/<symbol>.json`,
    - top N nivoa, dubina, zidovi,
    - signali za spoofing / wall-trap (u budućnosti).

- `storage.js`

  - Low-level I/O util za WS podatke:
    - safe write,
    - rotacija starijh fajlova,
    - eventualni cache.

- `wsTypes.js`
  - Enum/konstante:
    - tipovi streamova: `TICKER`, `TRADES`, `ORDERBOOK`
    - nazivi topika, sub-protocoli, itd.

---

## 9. MONITORING / STABILITY

Folder: `src/monitoring/`

- `health.js`

  - Health check engine-a:
    - proverava da li WS živi,
    - proverava fajl sistem (`data/*`),
    - loguje status (u `logs/` ili `data/metrics`),
    - koristi ga i `web/server.js` za dashboard health info.

- `crashGuard.js`

  - Protect layer:
    - global error handler,
    - restart signali,
    - logovanje fatalnih grešaka.

- `metricsTracker.js`
  - Skuplja i zapisuje metričke vrednosti:
    - latency,
    - broj simbola,
    - broj WS reconnect-a,
    - future: MAI, winrate, PnL po režimu.

---

## 10. WEB / DASHBOARD SLOJ

Folder: `web/`

### 10.1. `web/server.js`

- Express server za UI + API:
  - podešava:
    - EJS kao view engine,
    - `views` → `web/views`,
    - `layout` → `layout.ejs` (glavni template),
    - session store (SQLite),
    - static fajlove (`web/public`),
  - registruje rute:
    - `/login` (GET, POST – preko `authRoutes`)
    - `/logout`
    - `/` (dashboard – protected, `requireAuth`)
    - `/api/*` rute (link ka engine-u).
  - koristi `paths.js` iz `src/config` da zna gde je `data/`.

### 10.2. Auth modul

Folder: `web/auth/`

- `auth.js`

  - Radi sa `data/users.db`:
    - kreira DB ako ne postoji,
    - CRUD nad userima (trenutno: `admin`),
    - verifikacija passworda (bcrypt).

- `middleware.js`
  - `requireAuth`:
    - ako `req.session.user` ne postoji → redirect `/login`,
    - koristi se za zaštitu dashboarda i drugih ruta.

### 10.3. API rute

Folder: `web/routes/`

- `authRoutes.js` / `auth.js`

  - Rute:
    - `GET /login`
    - `POST /login`
    - `GET /logout`
  - Koriste `auth.js` i sessions.

- `api.js`

  - Glavni API prema engine-u:
    - npr. `/api/health`
    - `/api/metrics`
    - `/api/engine/status`
    - (u zavisnosti šta je već implementirano).

- `api-universe.js`

  - Rute za univerzum:
    - `GET /api/universe` – vraća listu simbola iz `data/system/universe.json`
    - future: filteri, detalji o simbolu.

- `api-test.js`
  - Test endpointi:
    - `/api/test/ticker/:symbol`
    - `/api/test/tradeflow/:symbol`
    - `/api/test/orderbook/:symbol`
  - Čita direktno JSON snapshotove iz `data/wsSnapshots` / `data/orderbook`.

### 10.4. View-ovi (EJS)

Folder: `web/views/`

- `layout.ejs`

  - Glavni template:
    - `<html>`, `<head>`, `<body>`
    - sidebar (DTrade logo, meni)
    - header (user info)
    - footer (Dexovan AI Scalper — 2025)
    - `<%- body %>` → gde login/dashboard ubacuju sadržaj.

- `login.ejs`

  - Full page login:
    - centra box,
    - Tailwind-based dizajn,
    - koristi `layout.ejs` ali BEZ sidebar-a (conditional render preko `isAuthPage` ili sličnog).

- `dashboard.ejs`
  - Glavni DTrade admin panel:
    - kartice: System Status, Portfolio Value, Active Trades, AI Engine status, Alerts…
    - koristi Tailwind i layout sidebar.

---

## 11. TESTOVI

Folder: `tests/`

- `test-instruments.js`

  - Testira povlačenje instrument liste sa Bybit-a (`publicREST`).
  - Proverava da li se univerzum pravilno gradi.

- `test-universe-refresh-interval.js`
  - Testira osvežavanje univerzuma u pravilnom intervalu.
  - Koristi `scheduler` + `universe` modul.

---

## 12. PREGLED – FILE → MODUL ROLE TABELA

(Ovo nije sva sitna internal logika, nego ključni fajlovi)

| Putanja                              | Modul / Uloga                              | Sloj       |
| ------------------------------------ | ------------------------------------------ | ---------- |
| `src/index.js`                       | Entry point engine-a                       | core       |
| `src/config/paths.js`                | Centralni path map                         | config     |
| `src/config/index.js`                | Glue za config                             | config     |
| `src/connectors/bybitPublic.js`      | High-level Bybit public connector          | connectors |
| `src/connectors/bybit/publicWS.js`   | Low-level WS konekcija                     | connectors |
| `src/connectors/bybit/publicREST.js` | REST wrapper za Bybit                      | connectors |
| `src/connectors/bybit/schema.js`     | Sheme podataka (ticker, trades, orderbook) | connectors |
| `src/core/bootstrap.js`              | Inicijalizacija sistema                    | core       |
| `src/core/engine.js`                 | Glavni trading engine                      | core       |
| `src/core/scheduler.js`              | Cron / scheduling                          | core       |
| `src/core/systemState.js`            | Global state                               | core       |
| `src/market/universe.js`             | Rad sa universe listom simbola             | market     |
| `src/market/universeFile.js`         | I/O univerzuma na disk                     | market     |
| `src/market/symbolProfile.js`        | Profil simbola                             | market     |
| `src/market/symbolClassifier.js`     | Klasifikacija simbola                      | market     |
| `src/market/marketUtils.js`          | Helperi za tržište                         | market     |
| `src/ws/eventHub.js`                 | Event hub za sve WS eventove               | ws         |
| `src/ws/tickerHub.js`                | Ticker stream & obrada                     | ws         |
| `src/ws/tradeFlow.js`                | Tradeflow stream                           | ws         |
| `src/ws/orderbookWatcher.js`         | Orderbook obrada + snapshot                | ws         |
| `src/ws/storage.js`                  | I/O storage za WS fajlove                  | ws         |
| `src/ws/wsTypes.js`                  | Enum / konstante za WS tipove              | ws         |
| `src/monitoring/health.js`           | Health monitoring                          | monitoring |
| `src/monitoring/crashGuard.js`       | Global error handling                      | monitoring |
| `src/monitoring/metricsTracker.js`   | Metrički tracking                          | monitoring |
| `web/server.js`                      | Express server za dashboard + API          | web        |
| `web/auth/auth.js`                   | User DB + auth logika                      | web/auth   |
| `web/auth/middleware.js`             | `requireAuth` middleware                   | web/auth   |
| `web/routes/api.js`                  | Glavni REST API                            | web/api    |
| `web/routes/api-universe.js`         | API za univerzum simbola                   | web/api    |
| `web/routes/api-test.js`             | Test WS fajlova                            | web/api    |
| `web/routes/authRoutes.js`           | Login / logout rute                        | web/auth   |
| `web/views/layout.ejs`               | Glavni layout (sidebar + header + footer)  | web/ui     |
| `web/views/login.ejs`                | Login ekran                                | web/ui     |
| `web/views/dashboard.ejs`            | Dashboard ekran                            | web/ui     |
| `data/system/universe.json`          | Snapshot univerzuma                        | data       |
| `data/sessions/sessions.db`          | Session store DB                           | data       |
| `data/users.db`                      | User DB                                    | data       |

---

## 13. ŠTA SLEDI (ZA DALJE KORAKE)

Na osnovu ove mape možemo dalje, potpuno bezbedno, da:

1. **Definišemo stabilne “public” API-je** između slojeva (npr. šta tačno izveze `bybitPublic`, šta prima `engine`).
2. **Refaktorišemo ime fajlova** (ako nešto hoćeš da preimenujemo) uz minimalan rizik.
3. Dodamo **“Engine Monitor” tab** u dashboard-u koji:
   - čita health,
   - čita logove,
   - prikazuje WS status,
   - prikazuje poslednji univerzum refresh itd.

Ako želiš, sledeći korak može da bude:

👉 **KORAK 4: MAPA ENDPOINTA (`ENDPOINT_MAP.md`)** –
svi `/api/*`, `/login`, `/logout`, `/` + šta tačno vraćaju i odakle vuku podatke.

Samo reci:

- **„Ajde ENDPOINT_MAP“** → pravim sledeći detaljan fajl, isto ovako spreman za `docs/`.
