#!/bin/bash

echo "======================================"
echo "🔄 AI SCALPER — FULL CLEAN RESET"
echo "======================================"

# Stop all PM2 apps
pm2 stop all >/dev/null 2>&1

# Delete all apps
pm2 delete all >/dev/null 2>&1

# Flush logs
pm2 flush >/dev/null 2>&1

# Remove old logs entirely (to avoid historical errors)
rm -f /home/aiuser/scalper-base/logs/*.log

# Recreate empty logs
touch /home/aiuser/scalper-base/logs/pm2-engine-out.log
touch /home/aiuser/scalper-base/logs/pm2-engine-error.log
touch /home/aiuser/scalper-base/logs/pm2-dashboard-out.log
touch /home/aiuser/scalper-base/logs/pm2-dashboard-error.log

echo "🧹 Logs cleared and recreated."

# Remove PM2 dump (so old configuration is not restored)
rm -f /home/aiuser/.pm2/dump.pm2

echo "🧽 PM2 dump cleaned."

# Start fresh ecosystem
pm2 start /home/aiuser/scalper-base/ecosystem.config.cjs

echo "🚀 Started fresh PM2 processes."

# Save new PM2 state
pm2 save >/dev/null 2>&1

echo "💾 Saved PM2 state."

# Print engine logs
sleep 1
echo "======================================"
echo "📜 LAST 50 LINES OF ENGINE LOGS"
echo "======================================"
pm2 logs engine --lines 50
