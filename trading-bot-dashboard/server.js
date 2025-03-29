// Optimized server.js
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
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

// Import trading bot classes
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

// Static files middleware
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: ENV === 'production' ? '1d' : 0 // Cache in production
}));

// Trading bot instance
const bot = new TradingBot(tradingConfig);
let isRunning = false;

// Socket.IO with CORS configuration
const io = new SocketIOServer(server, {
  cors: {
    origin: ENV === 'production' ? false : '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Routes
// ------------------------------------------------------------

// Authentication routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/start', authenticateJWT, authorizeRoles('admin'), csrfProtection, async (req, res) => {
  if (!isRunning) {
    try {
      isRunning = true;
      bot.start();
      
      console.info(`Bot started by user: ${req.user.username}`);
      
      res.json({ status: 'Trading bot started' });
      io.emit('bot_status_change', { isRunning: true });
    } catch (error) {
      isRunning = false;
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
      
      console.info(`Bot stopped by user: ${req.user.username}`);
      
      res.json({ status: 'Trading bot stopped', report });
      io.emit('bot_status_change', { isRunning: false });
    } catch (error) {
      console.error('Error stopping trading bot:', error);
      res.status(500).json({ error: 'Failed to stop trading bot' });
    }
  } else {
    res.status(400).json({ error: 'Trading bot is not running' });
  }
});

// Simulation
app.post('/api/simulation', authenticateJWT, csrfProtection, validationRules.simulation, validate, async (req, res) => {
  try {
    const { startDate, endDate, config } = req.body;
    
    // If custom config provided, validate it
    let simulationConfig = tradingConfig;
    if (config) {
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

// Socket.IO real-time updates
// ------------------------------------------------------------
io.on('connection', (socket) => {
  console.log('New client connected', socket.id);
  
  // Check authentication for socket connections
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log('Unauthenticated socket connection attempt');
    socket.emit('auth_error', { message: 'Authentication required' });
    socket.disconnect();
    return;
  }
  
  try {
    // Verify token
    jwt.verify(token, JWT_SECRET);
    
    // Send current bot status
    socket.emit('bot_status', { isRunning });
    
    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('Client disconnected', socket.id);
    });
    
    // Custom event handlers
    socket.on('request_update', () => {
      broadcastUpdates(socket);
    });
    
  } catch (error) {
    console.error('Socket authentication error:', error);
    socket.emit('auth_error', { message: 'Invalid authentication' });
    socket.disconnect();
  }
});

// Regular updates to connected clients
const broadcastUpdates = async (socket = null) => {
  try {
    if (isRunning) {
      const report = bot.getPerformanceReport();
      const recentTrades = bot.logger.getRecentTrades(5);
      const updateData = { 
        report, 
        recentTrades, 
        timestamp: new Date().toISOString() 
      };
      
      if (socket) {
        // Send only to the requesting socket
        socket.emit('bot_update', updateData);
      } else {
        // Broadcast to all connected clients
        io.emit('bot_update', updateData);
      }
    }
  } catch (error) {
    console.error('Error broadcasting updates:', error);
  }
};

// Set interval for regular updates (every 10 seconds)
setInterval(() => broadcastUpdates(), 10000);

// Scheduled log cleanup
// ------------------------------------------------------------
const scheduleLogCleanup = async () => {
  try {
    const logService = new LogService(tradingConfig);
    await logService.cleanupOldLogs(90); // Clean logs older than 90 days
    console.log('Scheduled log cleanup completed');
  } catch (error) {
    console.error('Error during scheduled log cleanup:', error);
  }
};

// Schedule next cleanup at midnight
const scheduleNextCleanup = () => {
  const now = new Date();
  const night = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1, // Tomorrow
    0, 0, 0 // Midnight
  );
  
  const timeToMidnight = night.getTime() - now.getTime();
  
  setTimeout(() => {
    scheduleLogCleanup();
    // Schedule next cleanup
    scheduleNextCleanup();
  }, timeToMidnight);
};

// Start the scheduler
scheduleNextCleanup();

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

export default server;refresh-token', refreshToken);

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
    isRunning: isRunning,
    config: tradingConfig,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
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

// Trades data
app.get('/api/trades', authenticateJWT, validationRules.getTrades, validate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const trades = bot.logger.getRecentTrades(limit, offset);
    
    res.json({
      trades,
      pagination: {
        total: bot.logger.getTotalTradesCount(),
        limit,
        offset,
        hasMore: (offset + trades.length) < bot.logger.getTotalTradesCount()
      }
    });
  } catch (error) {
    console.error('Error getting trades:', error);
    res.status(500).json({ error: 'Failed to get trades' });
  }
});

// Daily performance data
app.get('/api/daily-performance', authenticateJWT, validationRules.getDailyPerformance, validate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;
    const dailyPerformance = bot.logger.getDailyPerformance().slice(offset, offset + limit);
    
    res.json({
      data: dailyPerformance,
      pagination: {
        total: bot.logger.getDailyPerformance().length,
        limit,
        offset
      }
    });
  } catch (error) {
    console.error('Error getting daily performance:', error);
    res.status(500).json({ error: 'Failed to get daily performance' });
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
app.post('/api/login', loginRateLimiter, validationRules.login, validate, login);
app.post('/api/logout', authenticateJWT, logout);
app.post('/api/