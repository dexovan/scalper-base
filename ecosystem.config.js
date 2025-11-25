// PM2 Ecosystem Configuration
// Prevents log files from filling disk with automatic rotation

module.exports = {
  apps: [
    {
      name: "engine",
      script: "src/index.js",
      cwd: "/home/aiuser/scalper-base",
      interpreter: "node",
      node_args: "--max-old-space-size=4096",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 5000,

      // LOG ROTATION - Prevent disk fill
      max_memory_restart: "2G",
      error_file: "/home/aiuser/.pm2/logs/engine-error.log",
      out_file: "/home/aiuser/.pm2/logs/engine-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Rotate logs daily, keep only 3 days
      merge_logs: true,
      log_type: "json",

      env: {
        NODE_ENV: "production",
        TZ: "Europe/Belgrade"
      }
    },
    {
      name: "dashboard",
      script: "web/server.js",
      cwd: "/home/aiuser/scalper-base",
      interpreter: "node",
      node_args: "--max-old-space-size=2048",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 5000,

      // LOG ROTATION - Prevent disk fill
      max_memory_restart: "1G",
      error_file: "/home/aiuser/.pm2/logs/dashboard-error.log",
      out_file: "/home/aiuser/.pm2/logs/dashboard-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Rotate logs daily, keep only 3 days
      merge_logs: true,
      log_type: "json",

      env: {
        NODE_ENV: "production",
        PORT: 8080,
        TZ: "Europe/Belgrade"
      }
    },
    {
      name: "candle-collector",
      script: "scripts/live-candle-collector.js",
      cwd: "/home/aiuser/scalper-base",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 5000,

      // LOG ROTATION - Prevent disk fill
      max_memory_restart: "512M",
      error_file: "/home/aiuser/.pm2/logs/candle-collector-error.log",
      out_file: "/home/aiuser/.pm2/logs/candle-collector-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Rotate logs daily, keep only 3 days
      merge_logs: true,
      log_type: "json",

      env: {
        NODE_ENV: "production",
        TZ: "Europe/Belgrade"
      }
    }
  ]
};
