#!/bin/bash

# =============================================================================
# PM2 Log Cleanup Script
# =============================================================================
# Purpose: Automatically clean old PM2 logs to prevent disk filling
# Schedule: Run daily via cron (crontab -e)
# Example: 0 2 * * * /home/aiuser/scalper-base/scripts/cleanup-pm2-logs.sh

echo "🧹 [$(date)] PM2 Log Cleanup Started"

# PM2 log directory
PM2_LOGS="/home/aiuser/.pm2/logs"

# Keep only logs from last 3 days
DAYS_TO_KEEP=3

if [ -d "$PM2_LOGS" ]; then
  echo "📁 Cleaning logs older than $DAYS_TO_KEEP days in: $PM2_LOGS"

  # Find and delete old log files
  find "$PM2_LOGS" -name "*.log" -type f -mtime +$DAYS_TO_KEEP -delete

  # Count remaining files
  LOG_COUNT=$(find "$PM2_LOGS" -name "*.log" -type f | wc -l)
  TOTAL_SIZE=$(du -sh "$PM2_LOGS" | cut -f1)

  echo "✅ Cleanup complete"
  echo "   Remaining log files: $LOG_COUNT"
  echo "   Total size: $TOTAL_SIZE"
else
  echo "⚠️ PM2 logs directory not found: $PM2_LOGS"
fi

# Optional: Flush PM2 logs (truncates current log files)
echo "🔄 Flushing current PM2 logs..."
pm2 flush

echo "✅ [$(date)] PM2 Log Cleanup Finished"
