#!/bin/bash

# =============================================================================
# MANUAL PM2 Log Cleanup - IMMEDIATE ACTION
# =============================================================================
# Purpose: Emergency cleanup of massive PM2 logs (18GB!)
# This is CRITICAL - run this NOW before setting up automated cleanup

echo "🚨 EMERGENCY: Cleaning massive PM2 logs (18GB)..."
echo ""

PM2_LOGS_DIR="$HOME/.pm2/logs"

# 1. Check current size
echo "📊 Current PM2 logs size:"
du -sh "$PM2_LOGS_DIR"
echo ""

# 2. List largest files
echo "📁 Largest log files:"
du -h "$PM2_LOGS_DIR"/*.log 2>/dev/null | sort -hr | head -20
echo ""

# 3. Flush all PM2 logs (truncate current logs)
echo "🔄 Flushing all PM2 logs..."
pm2 flush
echo ""

# 4. Delete old rotated log files
echo "🗑️ Deleting old log files..."
find "$PM2_LOGS_DIR" -name "*.log" -type f -mtime +0 -exec rm -f {} \;
echo ""

# 5. Delete all .log files except the most recent ones
echo "🧹 Keeping only most recent logs..."
cd "$PM2_LOGS_DIR"
for pattern in engine-out engine-error dashboard-out dashboard-error; do
  # Keep only the main log file, delete numbered backups
  ls -1 ${pattern}*.log 2>/dev/null | grep -E '\.[0-9]+\.log$' | xargs rm -f 2>/dev/null || true
done

# 6. Final cleanup - if still too large, truncate everything
CURRENT_SIZE=$(du -sm "$PM2_LOGS_DIR" | cut -f1)
if [ "$CURRENT_SIZE" -gt 500 ]; then
  echo "⚠️ Still too large (${CURRENT_SIZE}MB), truncating all logs..."
  find "$PM2_LOGS_DIR" -name "*.log" -type f -exec truncate -s 0 {} \;
fi

echo ""
echo "✅ Cleanup complete!"
echo ""

# 7. Show final size
echo "📊 Final PM2 logs size:"
du -sh "$PM2_LOGS_DIR"
echo ""

# 8. Show disk usage
echo "💾 Disk usage after cleanup:"
df -h / | grep -E "Filesystem|/dev"
echo ""

# 9. Restart PM2 processes to start with fresh logs
echo "🔄 Restarting PM2 processes..."
pm2 restart all
echo ""

pm2 list

echo ""
echo "✅ DONE! PM2 logs cleaned."
echo ""
echo "⏰ Next: Setup automated log rotation with ecosystem.config.js"
echo "   pm2 delete all"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
