// server.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { TradingBot } from './bot/TradingBot.js';
import { securityConfig } from './config/securityConfig.js';
import { tradingConfig } from './config/tradingConfig.js';
import { apiConfig } from './config/apiConfig.js';
import LogService from './services/LogService.js';
import { fileURLToPath } from 'url';
import path from 'path';

// Load environment variables
dotenv.config();

// Initialize the express app
const app = express();
const PORT = process.env.PORT || 3000;

// Create file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logging service
const logService = new LogService({
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    filePath: path.join(__dirname, 'logs')
  }
});

// Initialize the trading bot
const botConfig = {
  ...tradingConfig,
  security: securityConfig,
  api: apiConfig
};

const tradingBot = new TradingBot(botConfig);

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON request body
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(morgan('combined')); // Logging

// Custom middleware for API logging
app.use((req, res, next) => {
  const start = Date.now();
  
  // When response is finished, log the request
  res.on('finish', () => {
    const time = Date.now() - start;
    logService.logApiRequest(req, res, time);
  });
  
  next();
});

// Route for health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Route for bot status
app.get('/api/status', (req, res) => {
  const isRunning = tradingBot.isRunning;
  const metrics = isRunning ? tradingBot.getPerformanceReport() : null;
  
  res.json({
    status: isRunning ? 'running' : 'stopped',
    uptime: isRunning ? tradingBot._calculateRuntime() : 0,
    metrics
  });
});

// API route for starting the bot
app.post('/api/start', async (req, res) => {
  logService.logSecurityEvent('bot_start_attempt', { ip: req.ip });
  
  if (tradingBot.isRunning) {
    return res.status(400).json({ error: 'Bot is already running' });
  }
  
  try {
    const success = await tradingBot.start();
    if (success) {
      logService.logSecurityEvent('bot_start_success', { ip: req.ip });
      res.json({ success: true, message: 'Bot started successfully' });
    } else {
      throw new Error('Failed to start bot');
    }
  } catch (error) {
    logService.error('Error starting bot', error);
    logService.logSecurityEvent('bot_start_failure', { ip: req.ip, error: error.message }, false);
    res.status(500).json({ error: error.message });
  }
});

// API route for stopping the bot
app.post('/api/stop', async (req, res) => {
  logService.logSecurityEvent('bot_stop_attempt', { ip: req.ip });
  
  if (!tradingBot.isRunning) {
    return res.status(400).json({ error: 'Bot is not running' });
  }
  
  try {
    const report = await tradingBot.stop();
    logService.logSecurityEvent('bot_stop_success', { ip: req.ip });
    res.json({ 
      success: true, 
      message: 'Bot stopped successfully',
      report
    });
  } catch (error) {
    logService.error('Error stopping bot', error);
    logService.logSecurityEvent('bot_stop_failure', { ip: req.ip, error: error.message }, false);
    res.status(500).json({ error: error.message });
  }
});

// API route for running a simulation
app.post('/api/simulation', async (req, res) => {
  const { startDate, endDate } = req.body;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Start and end dates are required' });
  }
  
  try {
    const simulationResults = await tradingBot.runSimulation(startDate, endDate);
    res.json(simulationResults);
  } catch (error) {
    logService.error('Error running simulation', error);
    res.status(500).json({ error: error.message });
  }
});

// API route for getting trading logs
app.get('/api/logs', async (req, res) => {
  const { format = 'json', days = 7 } = req.query;
  
  try {
    const logs = tradingBot.exportTradingLogs(format);
    res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=trading-logs.${format}`);
    res.send(logs);
  } catch (error) {
    logService.error('Error exporting logs', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logService.error('Server error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
const server = app.listen(PORT, () => {
  logService.info(`Server started on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logService.info('SIGTERM received, shutting down...');
  
  // Stop the bot if running
  if (tradingBot.isRunning) {
    await tradingBot.stop();
  }
  
  // Close server
  server.close(() => {
    logService.info('Server shut down complete');
    process.exit(0);
  });
});

export default app;