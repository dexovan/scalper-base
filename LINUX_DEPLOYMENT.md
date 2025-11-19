# 🚀 LINUX SERVER DEPLOYMENT COMMANDS

# 1. Stop existing instance

pm2 stop dashboard
pm2 delete dashboard
pm2 flush

# 2. Pull latest code

cd /home/aiuser/scalper-base
git pull origin master

# 3. Install dependencies if needed

npm install

# 4. Create logs directory

mkdir -p /home/aiuser/scalper-base/logs

# 5. Start with ecosystem config

pm2 start ecosystem.config.json

# 6. Save PM2 configuration

pm2 save

# 7. Check status and logs

pm2 status
pm2 logs dashboard --lines 50

# 8. Monitor in real-time

pm2 monit

# Alternative single command start (without ecosystem):

# pm2 start /home/aiuser/scalper-base/web/server.js --name dashboard --cwd /home/aiuser/scalper-base

# Check health API

# curl http://localhost:8080/api/health
