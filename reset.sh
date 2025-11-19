#!/bin/bash

echo "======================================="
echo "🔄 RESETUJEM PM2 + CACHE + LOGOVE"
echo "======================================="

echo "📌 Zaustavljam PM2..."
pm2 delete all || true
pm2 kill || true

echo "🧹 Brišem PM2 cache i dump..."
rm -rf ~/.pm2

echo "🧹 Brišem local logs..."
rm -rf /home/aiuser/scalper-base/logs/*
mkdir -p /home/aiuser/scalper-base/logs

echo "🧹 Brišem data/tmp i data/sessions..."
rm -rf /home/aiuser/scalper-base/data/tmp/*
rm -rf /home/aiuser/scalper-base/data/sessions/*

echo "🔄 Restartujem engine + dashboard..."
pm2 start /home/aiuser/scalper-base/ecosystem.config.cjs

pm2 save

echo "======================================="
echo "   ✅ RESET GOTOV – SISTEM JE CLEAN"
echo "======================================="
