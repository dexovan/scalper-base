# 🔄 Restart Engine na Linux serveru (Singapore)

Izvršite ove komande **na Linux serveru** da primijenite nove Prime simbole:

## 1️⃣ Prvo - Pull promjene sa GitHub-a

```bash
cd ~/scalper-base
git pull origin master
```

**Očekivani output:**

```
remote: Enumerating objects: 10, done.
...
Already up to date.
# ili ako ima novih promjena:
# Updating abc1234..def5678
# Fast-forward
#  src/market/universe_v2.js | 28 insertions(+)
#  PROFIT_CALCULATOR.md      | ...
```

---

## 2️⃣ Restart Engine procesa

```bash
pm2 restart engine
```

**Output:**

```
[PM2] Applying action restartProcessName on app [engine]...
[PM2] ✓ restarted
```

---

## 3️⃣ Provjerite status

```bash
pm2 list
```

Trebalo bi da vidite `engine` sa statusom `online`.

---

## 4️⃣ Provjerite logs da vidite nove Prime simbole

```bash
pm2 logs engine --lines 50
```

**Trebalo bi da vidite nešto kao:**

```
🌍 [UNIVERSE] Snapshot updated → total=500+, prime=28, normal=..., wild=...
📡 [WS] Subscribing to TICKERS + ORDERBOOK for 28 Prime symbols...
```

❌ Ako vidite samo `6 Prime symbols` - promjene nisu primijenjene (trebate re-pull)

---

## 5️⃣ Takođe restartovati Signal Scanner

```bash
pm2 restart signal-scanner
```

---

## ✅ Nakon restarta trebalo bi da vidite:

```
📊 Stage 1: Scanning 28+ tracked symbols...
```

Umjesto prethodnog:

```
📊 Stage 1: Scanning 6 tracked symbols...
```

---

## 🚀 Full restart (ako trebate)

```bash
# Restart svi procesi
pm2 restart all

# Ili u drugom prozoru pratite sve logs
pm2 logs
```

---

## 📞 Ako nešto ne radi:

1. Provjerite da su promjene pull-ovane:

   ```bash
   git status
   git log --oneline | head -5
   ```

2. Provjerite grešku u src/market/universe_v2.js:

   ```bash
   node -c src/market/universe_v2.js
   ```

3. Pogledajte cijele logs:
   ```bash
   pm2 logs engine
   ```

---

## 🎯 Očekivani rezultat:

- ✅ Engine će subscribeovati orderbook za **28 valuta** umjesto 6
- ✅ Scanner će dobijati signale iz **više par**
- ✅ `api/tracked-symbols` će vratiti ~28 simbola sa orderbook podacima
