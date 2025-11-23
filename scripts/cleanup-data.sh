#!/bin/bash

# =============================================================================
# Data Directory Cleanup Script
# =============================================================================
# Purpose: Clean old data files to prevent disk filling
# Schedule: Run daily via cron
# Example: 0 3 * * * /home/aiuser/scalper-base/scripts/cleanup-data.sh

echo "🧹 [$(date)] Data Cleanup Started"

BASE_DIR="/home/aiuser/scalper-base/data"
DAYS_TO_KEEP=7  # Keep data for 7 days

# Clean old ticker files
if [ -d "$BASE_DIR/tickers" ]; then
  echo "📊 Cleaning old ticker data..."
  find "$BASE_DIR/tickers" -type f -mtime +$DAYS_TO_KEEP -delete
  find "$BASE_DIR/tickers" -type d -empty -delete
  TICKER_SIZE=$(du -sh "$BASE_DIR/tickers" 2>/dev/null | cut -f1)
  echo "   Tickers dir size: $TICKER_SIZE"
fi

# Clean old trade files
if [ -d "$BASE_DIR/trades" ]; then
  echo "📈 Cleaning old trade data..."
  find "$BASE_DIR/trades" -type f -mtime +$DAYS_TO_KEEP -delete
  find "$BASE_DIR/trades" -type d -empty -delete
  TRADE_SIZE=$(du -sh "$BASE_DIR/trades" 2>/dev/null | cut -f1)
  echo "   Trades dir size: $TRADE_SIZE"
fi

# Clean old metric files
if [ -d "$BASE_DIR/metrics" ]; then
  echo "📉 Cleaning old metric data..."
  find "$BASE_DIR/metrics" -type f -mtime +$DAYS_TO_KEEP -delete
  find "$BASE_DIR/metrics" -type d -empty -delete
  METRIC_SIZE=$(du -sh "$BASE_DIR/metrics" 2>/dev/null | cut -f1)
  echo "   Metrics dir size: $METRIC_SIZE"
fi

# Total data directory size
TOTAL_SIZE=$(du -sh "$BASE_DIR" 2>/dev/null | cut -f1)
echo "✅ Cleanup complete - Total data size: $TOTAL_SIZE"

# Show disk usage
echo ""
echo "💾 Current disk usage:"
df -h / | grep -E "Filesystem|/dev"

echo ""
echo "✅ [$(date)] Data Cleanup Finished"
