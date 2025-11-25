module.exports = {
  apps: [
    {
      name: "dashboard",
      script: "/home/aiuser/scalper-base/web/server.js",
      cwd: "/home/aiuser/scalper-base",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      ignore_watch: ["node_modules", "logs", "data"],
      env: {
        NODE_ENV: "production",
        PORT: "8080"
      },
      log_file: "/home/aiuser/scalper-base/logs/pm2-dashboard.log",
      out_file: "/home/aiuser/scalper-base/logs/pm2-dashboard-out.log",
      error_file: "/home/aiuser/scalper-base/logs/pm2-dashboard-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      max_memory_restart: "500M",
      node_args: "--max-old-space-size=512"
    },
    {
      name: "engine",
      script: "/home/aiuser/scalper-base/src/index.js",
      cwd: "/home/aiuser/scalper-base",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      ignore_watch: ["node_modules", "logs", "data"],
      env: {
        NODE_ENV: "production"
      },
      log_file: "/home/aiuser/scalper-base/logs/pm2-engine.log",
      out_file: "/home/aiuser/scalper-base/logs/pm2-engine-out.log",
      error_file: "/home/aiuser/scalper-base/logs/pm2-engine-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      max_memory_restart: "700M",
      node_args: "--max-old-space-size=768"
    },
    {
      name: "candle-collector",
      script: "/home/aiuser/scalper-base/scripts/live-candle-collector.js",
      cwd: "/home/aiuser/scalper-base",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      ignore_watch: ["node_modules", "logs", "data"],
      env: {
        NODE_ENV: "production"
      },
      log_file: "/home/aiuser/scalper-base/logs/pm2-candle-collector.log",
      out_file: "/home/aiuser/scalper-base/logs/pm2-candle-collector-out.log",
      error_file: "/home/aiuser/scalper-base/logs/pm2-candle-collector-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=512"
    },
    {
      name: "signal-scanner",
      script: "/home/aiuser/scalper-base/scripts/scalp-signal-scanner.js",
      cwd: "/home/aiuser/scalper-base",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      ignore_watch: ["node_modules", "logs", "data"],
      env: {
        NODE_ENV: "production"
      },
      log_file: "/home/aiuser/scalper-base/logs/pm2-signal-scanner.log",
      out_file: "/home/aiuser/scalper-base/logs/pm2-signal-scanner-out.log",
      error_file: "/home/aiuser/scalper-base/logs/pm2-signal-scanner-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      max_memory_restart: "256M",
      node_args: "--max-old-space-size=256"
    }
  ]
};
