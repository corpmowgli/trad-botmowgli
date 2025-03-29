// server.js - Optimized version
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';

// Load environment variables
dotenv.config();

// Imports for security and validation
import { 
  authenticateJWT, 
  authorizeRoles, 
  login, 
  logout,
  refreshToken,
  loginRateLimiter, 
  apiRateLimiter,
  csrfProtection, 
  securityMiddleware 
} from './middleware/auth.js';
import { validate, validationRules, sanitizeAllInputs } from './middleware/validation.js';
import LogService from './services/logService.js';
import { SocketService } from './services/socketService.js';

// Import trading bot class
import { TradingBot } from './bot.js';
import { tradingConfig } from './config/tradingConfig.js';

// Server configuration
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';

// Get directory paths using ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Core middleware
app.use(compression()); // gzip compression
app.use(express.json({ limit: '1mb' })); // Limit JSON payload size
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan(ENV === 'production' ? 'combined' : 'dev')); // Logging

// Security middleware
app.use(securityMiddleware);
app.use(cors({
  origin: ENV === 'production' ? false : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Input sanitization middleware
app.use(sanitizeAllInputs);

// API rate limiting
app.use('/api/', apiRateLimiter);

// Static files middleware with caching for production
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: ENV === 'production' ? '1d' : 0 // Cache in production
}));

// Trading bot instance
const bot = new TradingBot(tradingConfig);
let isRunning = false;

// Store bot globally for easier access
global.bot = bot;
global.botStatus = { isRunning };

// Initialize Socket.IO service
const socketService = new SocketService(server, { env: ENV });

// Routes
// ------------------------------------------------------------

// Authentication routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/login', loginRateLimiter, validationRules.login, validate, login);
app.post('/api/logout', authenticateJWT, logout);
app.post('/api/refresh-token', refreshToken);

app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

app.get('/api/verify-auth', authenticateJWT, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      username: req.user.username,
      role: req.user.role
    }
  });
});

// Protected API Routes
// ------------------------------------------------------------

// Bot status
app.get('/api/status', authenticateJWT, (req, res) => {
  res.json({
    isRunning,
    config: tradingConfig,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    botUptime: isRunning ? bot._calculateRuntime() : null,
    systemInfo: {
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    }
  });
});

// Performance data
app.get('/api/performance', authenticateJWT, async (req, res) => {
  try {
    const report = bot.getPerformanceReport();
    res.json(report);
  } catch (error) {
    console.error('Error getting performance data:', error);
    res.status(500).json({ error: 'Failed to get performance data' });
  }
});

// Trades data with pagination and filtering
app.get('/api/trades', authenticateJWT, validationRules.getTrades, validate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const token = req.query.token;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    
    // Apply filters if provided
    let trades;
    if (token) {
      trades = bot.logger.getTradesByToken(token);
    } else if (startDate && endDate) {
      trades = bot.logger.getTradesByDateRange(startDate, endDate);
    } else {
      trades = bot.logger.getRecentTrades(limit, offset);
    }
    
    // Apply pagination if not using token filter
    const paginatedTrades = token ? trades.slice(offset, offset + limit) : trades;
    
    res.json({
      trades: paginatedTrades,
      pagination: {
        total: token ? trades.length : bot.logger.getTotalTradesCount(),
        limit,
        offset,
        hasMore: (offset + paginatedTrades.length) < (token ? trades.length : bot.logger.getTotalTradesCount())
      }
    });
  } catch (error) {
    console.error('Error getting trades:', error);
    res.status(500).json({ error: 'Failed to get trades' });
  }
});

// Daily performance data with pagination
app.get('/api/daily-performance', authenticateJWT, validationRules.getDailyPerformance, validate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;
    
    // Get all daily performance and sort chronologically if requested
    const sortByDate = req.query.sort === 'asc';
    const allPerformance = bot.logger.getDailyPerformance(sortByDate);
    
    // Apply pagination
    const dailyPerformance = allPerformance.slice(offset, offset + limit);
    
    res.json({
      data: dailyPerformance,
      pagination: {
        total: allPerformance.length,
        limit,
        offset
      }
    });
  } catch (error) {
    console.error('Error getting daily performance:', error);
    res.status(500).json({ error: 'Failed to get daily performance' });
  }
});

// Monthly performance data
app.get('/api/monthly-performance', authenticateJWT, async (req, res) => {
  try {
    const monthlyPerformance = bot.logger.getMonthlyPerformance();
    res.json({ data: monthlyPerformance });
  } catch (error) {
    console.error('Error getting monthly performance:', error);
    res.status(500).json({ error: 'Failed to get monthly performance' });
  }
});

// Token performance data
app.get('/api/token-performance', authenticateJWT, async (req, res) => {
  try {
    const minTrades = parseInt(req.query.minTrades) || 0;
    const tokenPerformance = bot.logger.getTokenPerformance(minTrades);
    res.json({ data: tokenPerformance });
  } catch (error) {
    console.error('Error getting token performance:', error);
    res.status(500).json({ error: 'Failed to get token performance' });
  }
});

// Portfolio data
app.get('/api/portfolio', authenticateJWT, async (req, res) => {
  try {
    const metrics = bot.portfolioManager.getMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('Error getting portfolio data:', error);
    res.status(500).json({ error: 'Failed to get portfolio data' });
  }
});

// Bot control
app.post('/api/start', authenticateJWT, authorizeRoles('admin'), csrfProtection, async (req, res) => {
  if (!isRunning) {
    try {
      const success = await bot.start();
      
      if (success) {
        isRunning = true;
        global.botStatus.isRunning = true;
        
        // Log the event
        console.info(`Bot started by user: ${req.user.username}`);
        
        // Broadcast status change using socket service
        socketService.broadcastStatusChange(true);
        
        res.json({ status: 'Trading bot started' });
      } else {
        res.status(500).json({ error: 'Bot failed to start' });
      }
    } catch (error) {
      console.error('Error starting trading bot:', error);
      res.status(500).json({ error: 'Failed to start trading bot' });
    }
  } else {
    res.status(400).json({ error: 'Trading bot is already running' });
  }
});

app.post('/api/stop', authenticateJWT, authorizeRoles('admin'), csrfProtection, async (req, res) => {
  if (isRunning) {
    try {
      const report = await bot.stop();
      isRunning = false;
      global.botStatus.isRunning = false;
      
      // Log the event
      console.info(`Bot stopped by user: ${req.user.username}`);
      
      // Broadcast status change using socket service
      socketService.broadcastStatusChange(false);
      
      res.json({ status: 'Trading bot stopped', report });
    } catch (error) {
      console.error('Error stopping trading bot:', error);
      res.status(500).json({ error: 'Failed to stop trading bot' });
    }
  } else {
    res.status(400).json({ error: 'Trading bot is not running' });
  }
});

// Simulation with custom configuration
app.post('/api/simulation', authenticateJWT, csrfProtection, validationRules.simulation, validate, async (req, res) => {
  try {
    const { startDate, endDate, config } = req.body;
    
    // If custom config provided, validate it
    let simulationConfig = tradingConfig;
    if (config) {
      // Deep validate config structure
      // This would need additional validation logic
      simulationConfig = { ...tradingConfig, ...config };
    }
    
    const result = await bot.runSimulation(
      new Date(startDate), 
      new Date(endDate),
      simulationConfig
    );
    
    res.json(result);
  } catch (error) {
    console.error('Error running simulation:', error);
    res.status(500).json({ error: 'Failed to run simulation', details: error.message });
  }
});

// Export logs
app.get('/api/export-logs', authenticateJWT, validationRules.exportLogs, validate, async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const compress = req.query.compress === 'true';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    
    const logService = new LogService(tradingConfig);
    
    await logService.streamLogs(res, format, {
      startDate,
      endDate,
      page,
      limit,
      compress
    });
  } catch (error) {
    console.error('Error exporting logs:', error);
    res.status(500).json({ error: 'Failed to export logs', details: error.message });
  }
});

// Get HTML reports
app.get('/api/reports/html', authenticateJWT, async (req, res) => {
  try {
    const htmlReport = bot.generateHtmlReport();
    res.send(htmlReport);
  } catch (error) {
    console.error('Error generating HTML report:', error);
    res.status(500).json({ error: 'Failed to generate HTML report' });
  }
});

app.get('/api/reports/interactive', authenticateJWT, async (req, res) => {
  try {
    const interactiveReport = bot.generateInteractiveReport();
    res.send(interactiveReport);
  } catch (error) {
    console.error('Error generating interactive report:', error);
    res.status(500).json({ error: 'Failed to generate interactive report' });
  }
});

// System health endpoint
app.get('/api/health', async (req, res) => {
  try {
    const memory = process.memoryUsage();
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        rss: Math.round(memory.rss / 1024 / 1024), // Convert to MB
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        external: Math.round(memory.external / 1024 / 1024)
      },
      services: {
        bot: isRunning ? 'running' : 'stopped',
        socket: socketService.getClientCount()
      }
    };
    
    res.json(health);
  } catch (error) {
    console.error('Error in health check:', error);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Subscribe to bot events for real-time updates
bot.on('trade', (trade) => {
  // Broadcast trade via socket
  socketService.broadcastTrade(trade);
});

bot.on('status', (statusUpdate) => {
  // Broadcast status update
  socketService.broadcastUpdate({ statusUpdate });
});

// Regularly broadcast updates to connected clients (every 10 seconds if bot is running)
setInterval(() => {
  if (isRunning) {
    const report = bot.getPerformanceReport();
    socketService.broadcastUpdate({ report });
  }
}, 10000);

// Error handling middleware
// ------------------------------------------------------------
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found', message: 'The requested resource was not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  
  // CSRF error handling
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      error: 'Session invalide ou expirée',
      message: 'Veuillez rafraîchir la page et réessayer',
      code: 'CSRF_ERROR'
    });
  }
  
  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      details: err.errors
    });
  }
  
  // General error response
  res.status(500).json({
    error: 'Server error',
    message: ENV === 'production' ? 'Une erreur inattendue est survenue' : err.message,
    code: err.code || 'INTERNAL_ERROR'
  });
});

// Start the server
// ------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`Environment: ${ENV}`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard available at http://localhost:${PORT}`);
});

// Graceful shutdown handling
// ------------------------------------------------------------
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

async function gracefulShutdown() {
  console.log('Shutting down server...');
  
  // Stop the trading bot if running
  if (isRunning) {
    try {
      await bot.stop();
      console.log('Trading bot stopped');
    } catch (error) {
      console.error('Error stopping trading bot:', error);
    }
  }
  
  // Clean up socket service
  if (socketService && socketService.cleanup) {
    socketService.cleanup();
  }
  
  // Close server connections
  server.close(() => {
    console.log('Server connections closed');
    
    // Cleanup other resources
    if (bot.cleanup) {
      bot.cleanup();
    }
    
    console.log('Server shut down successfully');
    process.exit(0);
  });
  
  // Force exit after timeout
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

export default server;