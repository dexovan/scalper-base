# Live Candle Collector

## Overview

Live Candle Collector je lightweight proces koji održava **rolling 6-hour window** najsvežijih candlestick podataka za svaki praćeni simbol.

### Key Features

✅ **Rolling Window:** Čuva samo zadnjih 6 sati (360 candles)
✅ **Auto-Cleanup:** Automatski briše candles starije od 6h
✅ **Minimal Disk:** ~83 KB per simbol (fiksno)
✅ **Real-time Updates:** Refresh svaki minut
✅ **Multiple Symbols:** Podrška za više coinova
✅ **PM2 Integration:** Radi kao background service

---

## Storage

### Location

```
data/live/
  ├─ AAVEUSDT_live.json    (~83 KB, 360 candles, 6h window)
  ├─ SOLUSDT_live.json     (~83 KB, 360 candles, 6h window)
  └─ DOGEUSDT_live.json    (~83 KB, 360 candles, 6h window)
```

### Disk Usage

- **1 simbol:** ~83 KB (fiksno)
- **10 simbola:** ~830 KB
- **100 simbola:** ~8.3 MB

**Comparison:**

- Old (1000 candles): 228 KB per simbol
- New (360 candles): 83 KB per simbol
- **Savings: 64% less space**

---

## File Format

```json
{
  "symbol": "AAVEUSDT",
  "windowHours": 6,
  "windowSize": 360,
  "lastUpdate": "2025-11-25T21:14:00.000Z",
  "oldestCandle": "2025-11-25T15:14:00.000Z",
  "newestCandle": "2025-11-25T21:14:00.000Z",
  "candles": [
    {
      "timestamp": 1764092040000,
      "datetime": "2025-11-25T15:14:00.000Z",
      "open": 175.0,
      "high": 175.1,
      "low": 174.95,
      "close": 175.05,
      "volume": 215.5,
      "turnover": 37986.44
    }
    // ... 359 more candles
  ]
}
```

---

## Configuration

Edit `scripts/live-candle-collector.js`:

```javascript
const CONFIG = {
  symbols: [
    "AAVEUSDT",
    "SOLUSDT",
    "DOGEUSDT",
    // Add more symbols here
  ],
  interval: "1", // 1-minute candles
  windowHours: 6, // Keep last 6 hours
  windowSize: 360, // 6 hours × 60 minutes
  updateInterval: 60000, // Update every 60 seconds
  dataDir: path.join(__dirname, "../data/live"),
};
```

---

## Deployment (Linux Server)

### 1. Pull Latest Code

```bash
cd ~/scalper-base
git pull origin master
```

### 2. Restart PM2 with Candle Collector

```bash
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
```

### 3. Verify Running

```bash
pm2 list
# Should show: engine, dashboard, candle-collector

pm2 logs candle-collector --lines 50
# Check for successful bootstrap
```

### 4. Check Data Files

```bash
ls -lh data/live/
# Should show: AAVEUSDT_live.json, etc.

cat data/live/AAVEUSDT_live.json | jq '{symbol, windowHours, lastUpdate, candleCount: (.candles | length)}'
# Should show 360 candles
```

---

## Manual Testing (Windows/Local)

```powershell
# Run once manually
node scripts/live-candle-collector.js

# Should see:
# 🚀 LIVE CANDLE COLLECTOR - INITIAL LOAD
# 📥 Bootstrapping AAVEUSDT...
# ✅ [AAVEUSDT] Bootstrapped with 360 candles
# 🔁 Starting periodic updates every 60s...
```

---

## Monitoring

### Check Logs

```bash
pm2 logs candle-collector --lines 100
```

### Check Disk Usage

```bash
du -sh data/live/
# Should be: ~250 KB (3 symbols × 83 KB)

ls -lh data/live/*.json
```

### Check Update Cycle

```bash
pm2 logs candle-collector --lines 20
# Should see updates every 60s:
# ✅ [AAVEUSDT] +1 new, 1 total
```

---

## How It Works

### 1. Initial Bootstrap

- Fetches up to 360 candles (6 hours) from Bybit
- Saves to `data/live/{SYMBOL}_live.json`

### 2. Periodic Updates (Every 60s)

- Fetches last 5 candles (to catch any missed)
- Merges new candles (avoids duplicates)
- Removes candles older than 6 hours
- Keeps only 360 most recent candles

### 3. Auto-Cleanup

- **Time-based:** Removes candles older than `cutoffTime = now - 6h`
- **Count-based:** Keeps max 360 candles (safety limit)
- **Result:** File size stays constant (~83 KB)

---

## Usage in Code

### Load Live Data

```javascript
import fs from "fs";
import path from "path";

function loadLiveCandles(symbol) {
  const filePath = path.join("data/live", `${symbol}_live.json`);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return data.candles; // Array of 360 candles (last 6h)
}

// Example: Calculate average volume
const candles = loadLiveCandles("AAVEUSDT");
const avgVolume =
  candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
console.log(`Average volume (6h): ${avgVolume.toFixed(2)}`);
```

### Detect Volume Spike

```javascript
const candles = loadLiveCandles("AAVEUSDT");
const avgVolume =
  candles.slice(0, -1).reduce((sum, c) => sum + c.volume, 0) /
  (candles.length - 1);
const currentVolume = candles[candles.length - 1].volume;
const spike = currentVolume / avgVolume;

if (spike > 3.0) {
  console.log(`🚀 VOLUME SPIKE: ${spike.toFixed(1)}x average!`);
}
```

---

## Troubleshooting

### Collector Not Running

```bash
pm2 list
# If missing, restart:
pm2 start ecosystem.config.js
pm2 save
```

### No Data Files Created

```bash
# Check permissions
ls -ld data/live/
# Should be writable by aiuser

# Create manually if needed
mkdir -p data/live
chmod 755 data/live
```

### Old Candles Not Being Removed

```bash
# Check logs for errors
pm2 logs candle-collector --err

# Restart collector
pm2 restart candle-collector
```

### Disk Space Growing

```bash
# Candle files should be ~83 KB each
du -h data/live/*.json

# If larger, check windowSize in config
# Should be 360 candles max
```

---

## Performance

### Resource Usage

- **CPU:** < 1% (mostly idle, spikes during update)
- **Memory:** ~50 MB (minimal footprint)
- **Disk I/O:** Write every 60s (~83 KB per symbol)
- **Network:** API call every 60s (~5 KB response)

### Scalability

| Symbols | Disk Usage | Update Time | Memory |
| ------- | ---------- | ----------- | ------ |
| 10      | ~830 KB    | ~5 seconds  | ~50 MB |
| 50      | ~4 MB      | ~20 seconds | ~60 MB |
| 100     | ~8 MB      | ~40 seconds | ~70 MB |

---

## Maintenance

### Add New Symbol

1. Edit `scripts/live-candle-collector.js`
2. Add symbol to `CONFIG.symbols` array
3. Restart: `pm2 restart candle-collector`

### Change Window Size

1. Edit `CONFIG.windowHours` (e.g., 12 for 12 hours)
2. Edit `CONFIG.windowSize` (e.g., 720 for 12 hours)
3. Restart: `pm2 restart candle-collector`
4. Data files will auto-adjust on next update

### Clean Data Directory

```bash
# Remove all live data (will re-bootstrap)
rm data/live/*.json

# Restart to re-fetch
pm2 restart candle-collector
```

---

## Comparison: Old vs New

### Old Approach (backtest files)

```
AAVEUSDT_candles_2025-11-25T19-43-56.json  → 228 KB (1000 candles)
- Grows indefinitely
- Manual cleanup needed
- Stale data (16+ hours old)
```

### New Approach (live files)

```
AAVEUSDT_live.json  → 83 KB (360 candles)
- Fixed size (never grows)
- Auto-cleanup (always fresh)
- Fresh data (max 6h old)
```

**Result: 64% less disk space, always fresh data!** 🎉

---

## See Also

- `docs/DISK-SPACE-FIX.md` - Disk space management overview
- `ecosystem.config.js` - PM2 configuration
- `scripts/cleanup-data.sh` - Manual cleanup script
