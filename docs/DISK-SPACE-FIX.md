# Disk Space Management - Scalper Base

## Problem: Disk Filling Up (77% Used - 28GB/38GB)

### Root Causes Identified

1. **Universe Snapshot Writes** (FIXED)

   - `universe_v2.js` wrote to disk every 15 seconds
   - 500+ symbols × ~1KB = 500KB+ per write
   - **Rate:** 2MB/min = 120MB/hour = **2.9GB/day**
   - **Fix:** Disabled `saveUniverseSnapshot()` and `refreshUniversePeriodically()`

2. **PM2 Logs Growing Indefinitely** (FIXED)

   - PM2 logs never rotate by default
   - Console logs from both engine and dashboard
   - **Rate:** ~1-5MB/hour = **120MB/day** (can be much higher)
   - **Fix:** Created `ecosystem.config.js` with log rotation

3. **Feature Engine Disk Persistence** (PREVIOUSLY FIXED)

   - Already disabled in commit `9eaec74`
   - Would have been **43GB/day** if active

4. **Ticker/Trade CSV Storage** (ALREADY DISABLED)
   - Already disabled in `index.js`
   - Would have been **15GB+/day** if active

### Solutions Implemented

#### 1. Disable Universe Snapshot Writing

**File:** `src/market/universe_v2.js`

```javascript
async function saveUniverseSnapshot() {
  // DISABLED: Prevent disk fill - universe kept in memory only
  console.log("⚠️ [UNIVERSE] saveUniverseSnapshot() DISABLED");
  return;
}
```

**File:** `src/index.js`

```javascript
// DISABLED: Universe refresh writes to disk every 15s
// refreshUniversePeriodically();
console.log("⚠️ [ENGINE] Universe periodic refresh DISABLED");
```

#### 2. PM2 Ecosystem Config with Log Rotation

**File:** `ecosystem.config.js`

- Max memory restart: 2GB (engine), 1GB (dashboard)
- Log rotation enabled
- JSON log format
- Merge logs
- Date format for easy tracking

**Usage:**

```bash
cd ~/scalper-base
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
```

#### 3. Automated Cleanup Scripts

**File:** `scripts/cleanup-pm2-logs.sh`

- Deletes PM2 logs older than 3 days
- Flushes current logs
- Shows remaining size

**File:** `scripts/cleanup-data.sh`

- Cleans ticker/trade/metric data older than 7 days
- Removes empty directories
- Shows disk usage

**Setup Cron Jobs:**

```bash
crontab -e

# Add these lines:
0 2 * * * /home/aiuser/scalper-base/scripts/cleanup-pm2-logs.sh >> /home/aiuser/cleanup.log 2>&1
0 3 * * * /home/aiuser/scalper-base/scripts/cleanup-data.sh >> /home/aiuser/cleanup.log 2>&1
```

### Deployment Steps

1. **Pull latest changes:**

```bash
cd ~/scalper-base
git pull origin master
```

2. **Make scripts executable:**

```bash
chmod +x scripts/cleanup-pm2-logs.sh
chmod +x scripts/cleanup-data.sh
```

3. **Restart PM2 with ecosystem config:**

```bash
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
```

4. **Setup cron jobs:**

```bash
crontab -e
# Add the two lines mentioned above
```

5. **Manual cleanup (optional):**

```bash
# Clean PM2 logs immediately
pm2 flush
./scripts/cleanup-pm2-logs.sh

# Clean old data immediately
./scripts/cleanup-data.sh

# Check disk usage
df -h
du -sh ~/scalper-base/data/*
du -sh ~/.pm2/logs
```

### Monitoring Disk Usage

**Check current usage:**

```bash
df -h /
```

**Check specific directories:**

```bash
du -sh ~/scalper-base/data
du -sh ~/.pm2/logs
du -sh ~/scalper-base/data/*
```

**Watch disk usage in real-time:**

```bash
watch -n 5 'df -h / && echo "---" && du -sh ~/.pm2/logs && du -sh ~/scalper-base/data'
```

### Expected Results

After fixes:

- **No more universe writes** - Universe stays in RAM only
- **PM2 logs auto-rotate** - Kept for 3 days max
- **Old data auto-cleanup** - Cleaned after 7 days
- **Disk growth rate:** ~0MB/day (steady state)

### Disk Space Breakdown (Expected After Cleanup)

```
/dev/sda1        38G   Used   Avail  Use%
Before:          38G   28G    8.5G   77%
After cleanup:   38G   <15G   >20G   <40%
```

### Future Monitoring

- Set up disk space alerts (when > 70% used)
- Review PM2 logs weekly
- Check data directory size weekly
- Consider moving to larger disk if needed (current: 38GB)

---

**Commit:** TBD
**Date:** 2025-11-23
**Status:** Ready for deployment
