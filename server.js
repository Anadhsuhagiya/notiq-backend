require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const { initSockets } = require('./src/sockets');
const logger = require('./src/utils/logger');
const { startScheduledJobs } = require('./src/services/scheduler.service');

const PORT = process.env.PORT || 5000;

// Connect DB then start server
connectDB().then(() => {
  const server = http.createServer(app);

  // Initialize Socket.io
  initSockets(server);

  // Start cron jobs
  startScheduledJobs();

  server.listen(PORT, () => {
    logger.info(`NotiQ Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      logger.info('Process terminated.');
      process.exit(0);
    });
  });
}).catch((err) => {
  logger.error('DB connection failed:', err.message);
  process.exit(1);
});
