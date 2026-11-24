module.exports = {
  apps: [{
    name: 'tmcai-server',
    script: './dist/server.js',
    cwd: '/var/www/tmcai/server',
    instances: 1,
    exec_mode: 'fork',         // NOT cluster — cron jobs + vector store must be singletons
    node_args: '--max-old-space-size=1024',
    max_memory_restart: '1500M', // above the 1 GB V8 heap ceiling so V8 collects first (D-308, 24 Nov)
    kill_timeout: 10000,       // shutdown cleanup needs up to 8 s; pm2 default 1.6 s SIGKILLed it (D-308)
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/tmcai/error.log',
    out_file: '/var/log/tmcai/out.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
