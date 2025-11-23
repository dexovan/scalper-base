#!/bin/bash

# =============================================================================
# HITNO: Deploy Disk Space Fix
# =============================================================================
# This script fixes critical disk filling issue (77% → <40%)
# Root causes: Universe writes 500KB/15s + PM2 logs never rotate

echo "🚨 HITNO: Deploying disk space fix..."
echo ""

# 1. Pull latest changes
echo "1️⃣ Pulling latest changes..."
cd ~/scalper-base
git pull origin master

# 2. Make cleanup scripts executable
echo ""
echo "2️⃣ Making cleanup scripts executable..."
chmod +x scripts/cleanup-pm2-logs.sh
chmod +x scripts/cleanup-data.sh

# 3. Run immediate cleanup
echo ""
echo "3️⃣ Running EMERGENCY cleanup of 18GB PM2 logs..."
./scripts/cleanup-pm2-logs-manual.sh

# 4. Restart PM2 with new ecosystem config
echo ""
echo "4️⃣ Restarting PM2 with log rotation..."
pm2 delete all
pm2 start ecosystem.config.js
pm2 save

# 5. Setup cron jobs
echo ""
echo "5️⃣ Setting up cron jobs..."
echo "⚠️ Note: Cron needs manual setup due to permissions"
echo ""
echo "Run these commands manually:"
echo "  crontab -e"
echo "  # Add these lines:"
echo "  0 2 * * * /home/aiuser/scalper-base/scripts/cleanup-pm2-logs.sh >> /home/aiuser/cleanup.log 2>&1"
echo "  0 3 * * * /home/aiuser/scalper-base/scripts/cleanup-data.sh >> /home/aiuser/cleanup.log 2>&1"
echo ""

# 6. Show current disk usage
echo ""
echo "6️⃣ Current disk usage:"
df -h / | grep -E "Filesystem|/dev"
echo ""
du -sh ~/.pm2/logs
du -sh ~/scalper-base/data

# 7. Verify PM2 processes
echo ""
echo "7️⃣ PM2 processes:"
pm2 list

echo ""
echo "✅ DEPLOYMENT COMPLETE!"
echo ""
echo "📊 Monitoring commands:"
echo "   watch -n 5 'df -h /'"
echo "   pm2 logs engine --lines 50"
echo "   pm2 logs dashboard --lines 50"
echo ""
echo "🎯 Expected results:"
echo "   - No more '[UNIVERSE] Snapshot updated' messages every 15s"
echo "   - PM2 logs stay under 100MB"
echo "   - Disk usage stays stable (no growth)"
echo ""
