// server.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { LRUCache } from './utils/lruCache.js';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
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

// Cache pour les réponses d'API
const apiCache = new LRUCache(100);
const healthCheckCache = new LRUCache(1);

// Initialize logging service
const logService = new LogService({
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    filePath: path.join(__dirname, 'logs')
  }
});

// Initialize the trading bot with merged configuration
const botConfig = {
  ...tradingConfig,
  security: securityConfig,
  api: apiConfig,
  performance: {
    tokenConcurrency: 5,
    enableAutomaticRestarts: true,
    memoryThreshold: 1536,
    memoryCheckInterval: 300000
  }
};

const tradingBot = new TradingBot(botConfig);

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(compression()); // Compression pour réduire la taille des réponses
app.use(express.json({ limit: '1mb' })); // Parse JSON request body with size limit
app.use(express.urlencoded({ extended: true, limit: '1mb' })); // Parse URL-encoded bodies with size limit

// Logging middleware
morgan.token('body-size', (req) => {
  if (req.body) {
    return JSON.stringify(req.body).length;
  }
  return 0;
});

app.use(morgan(':method :url :status :response-time ms - :body-size bytes', {
  stream: {
    write: (message) => logService.info(message.trim(), {}, 'api')
  }
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  message: { error: 'Too many requests, please try again later' }
});

// Apply rate limiting to all API routes
app.use('/api/', apiLimiter);

// Speed limiter
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // Allow 50 requests per 15 minutes without delay
  delayMs: 500 // Add 500ms delay per request after limit
});

// Apply speed limiter to heavy routes
app.use('/api/simulation', speedLimiter);
app.use('/api/logs', speedLimiter);

// Custom middleware for API logging
app.use((req, res, next) => {
  const start = Date.now();
  
  // Stocke la méthode originale de res.json
  const originalJson = res.json;
  
  // Remplace la méthode res.json pour intercepter les réponses
  res.json = function(body) {
    res.jsonBody = body;
    return originalJson.call(this, body);
  };
  
  // When response is finished, log the request
  res.on('finish', () => {
    const time = Date.now() - start;
    
    // Limiter la taille des journaux pour les grandes réponses
    let responseBody = res.jsonBody;
    if (responseBody && JSON.stringify(responseBody).length > 1000) {
      responseBody = { 
        type: typeof responseBody, 
        size: JSON.stringify(responseBody).length,
        sample: '(truncated for logging)'
      };
    }
    
    logService.logApiRequest(req, res, time, responseBody);
  });
  
  next();
});

// Middleware de cache pour les endpoints statiques
const cacheMiddleware = (duration) => {
  return (req, res, next) => {
    const key = req.originalUrl || req.url;
    const cachedResponse = apiCache.get(key);
    
    if (cachedResponse) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedResponse);
    }
    
    // Remplace la méthode originale pour stocker en cache
    const originalJson = res.json;
    res.json = function(body) {
      if (res.statusCode === 200) {
        apiCache.set(key, body);
        setTimeout(() => apiCache.delete(key), duration);
      }
      res.set('X-Cache', 'MISS');
      return originalJson.call(this, body);
    };
    
    next();
  };
};

// Middleware de vérification d'authentification (à implémenter)
const authMiddleware = (req, res, next) => {
  // Implémentation simplifiée, à remplacer par une vérification réelle
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== process.env.API_KEY) {
    logService.logSecurityEvent('auth_failure', { ip: req.ip, path: req.path }, false);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

// Route for health check (no auth required, cached)
app.get('/api/health', cacheMiddleware(30000), (req, res) => {
  // Vérifier si une réponse en cache est disponible
  const cachedHealth = healthCheckCache.get('health');
  if (cachedHealth && Date.now() - cachedHealth.timestamp < 5000) {
    return res.json(cachedHealth.data);
  }
  
  // Générer une nouvelle réponse
  const healthData = {
    status: tradingBot.isRunning ? 'running' : 'stopped',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: Date.now()
  };
  
  // Mettre en cache
  healthCheckCache.set('health', {
    data: healthData,
    timestamp: Date.now()
  });
  
  res.json(healthData);
});

// Route for bot status
app.get('/api/status', authMiddleware, (req, res) => {
  const isRunning = tradingBot.isRunning;
  let metrics = null;
  
  if (isRunning) {
    // Limiter la taille des métriques renvoyées
    const fullMetrics = tradingBot.getPerformanceReport();
    metrics = {
      portfolio: fullMetrics.portfolioMetrics,
      trades: {
        total: fullMetrics.metrics.totalTrades,
        winning: fullMetrics.metrics.winningTrades,
        losing: fullMetrics.metrics.losingTrades,
        winRate: fullMetrics.metrics.winRate
      },
      bot: {
        uptime: fullMetrics.botMetrics.uptime,
        cycles: fullMetrics.botMetrics.cyclesRun,
        lastCycle: fullMetrics.botMetrics.lastCycleTime
      }
    };
  }
  
  res.json({
    status: isRunning ? 'running' : 'stopped',
    isPaused: tradingBot.isPaused,
    uptime: isRunning ? tradingBot._calculateRuntime() : 0,
    metrics
  });
});

// Detailed status with resource usage
app.get('/api/status/detailed', authMiddleware, (req, res) => {
  const healthStatus = tradingBot.getHealthStatus();
  
  res.json({
    health: healthStatus,
    performance: tradingBot.performanceMetrics,
    dataCacheStats: tradingBot.dataManager.getStats(),
    apiStats: tradingBot.marketData.getStats()
  });
});

// API route for starting the bot
app.post('/api/start', authMiddleware, async (req, res) => {
  logService.logSecurityEvent('bot_start_attempt', { ip: req.ip });
  
  if (tradingBot.isRunning) {
    return res.status(400).json({ error: 'Bot is already running' });
  }
  
  try {
    const success = await tradingBot.start();
    if (success) {
      // Invalider les caches pertinents
      apiCache.delete('/api/status');
      
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
app.post('/api/stop', authMiddleware, async (req, res) => {
  logService.logSecurityEvent('bot_stop_attempt', { ip: req.ip });
  
  if (!tradingBot.isRunning) {
    return res.status(400).json({ error: 'Bot is not running' });
  }
  
  try {
    const report = await tradingBot.stop();
    
    // Invalider les caches pertinents
    apiCache.delete('/api/status');
    
    logService.logSecurityEvent('bot_stop_success', { ip: req.ip });
    res.json({ 
      success: true, 
      message: 'Bot stopped successfully',
      report: {
        profitLoss: report.metrics.totalProfit,
        winRate: report.metrics.winRate,
        trades: report.metrics.totalTrades
      }
    });
  } catch (error) {
    logService.error('Error stopping bot', error);
    logService.logSecurityEvent('bot_stop_failure', { ip: req.ip, error: error.message }, false);
    res.status(500).json({ error: error.message });
  }
});

// API route for pausing the bot
app.post('/api/pause', authMiddleware, async (req, res) => {
  logService.logSecurityEvent('bot_pause_attempt', { ip: req.ip });
  
  if (!tradingBot.isRunning || tradingBot.isPaused) {
    return res.status(400).json({ error: 'Bot is not running or already paused' });
  }
  
  try {
    const success = await tradingBot.pause();
    if (success) {
      // Invalider les caches pertinents
      apiCache.delete('/api/status');
      
      logService.logSecurityEvent('bot_pause_success', { ip: req.ip });
      res.json({ success: true, message: 'Bot paused successfully' });
    } else {
      throw new Error('Failed to pause bot');
    }
  } catch (error) {
    logService.error('Error pausing bot', error);
    res.status(500).json({ error: error.message });
  }
});

// API route for resuming the bot
app.post('/api/resume', authMiddleware, async (req, res) => {
  logService.logSecurityEvent('bot_resume_attempt', { ip: req.ip });
  
  if (!tradingBot.isRunning || !tradingBot.isPaused) {
    return res.status(400).json({ error: 'Bot is not running or not paused' });
  }
  
  try {
    const success = await tradingBot.resume();
    if (success) {
      // Invalider les caches pertinents
      apiCache.delete('/api/status');
      
      logService.logSecurityEvent('bot_resume_success', { ip: req.ip });
      res.json({ success: true, message: 'Bot resumed successfully' });
    } else {
      throw new Error('Failed to resume bot');
    }
  } catch (error) {
    logService.error('Error resuming bot', error);
    res.status(500).json({ error: error.message });
  }
});

// API route for running a simulation
app.post('/api/simulation', authMiddleware, async (req, res) => {
  const { startDate, endDate, parameters } = req.body;
  
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

// API route for optimizing strategy parameters
app.post('/api/optimize', authMiddleware, async (req, res) => {
  const { startDate, endDate, parameters } = req.body;
  
  if (!startDate || !endDate || !parameters) {
    return res.status(400).json({ error: 'Start date, end date, and parameters are required' });
  }
  
  try {
    const optimizationResults = await tradingBot.optimizeStrategy(startDate, endDate, parameters);
    res.json(optimizationResults);
  } catch (error) {
    logService.error('Error optimizing strategy', error);
    res.status(500).json({ error: error.message });
  }
});

// API route for getting trading logs
app.get('/api/logs', authMiddleware, async (req, res) => {
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

// API route for updating configuration
app.post('/api/config', authMiddleware, async (req, res) => {
  const { config } = req.body;
  
  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'Valid configuration object is required' });
  }
  
  try {
    const result = tradingBot.updateConfig(config);
    
    // Invalider tous les caches après mise à jour de la config
    apiCache.clear();
    
    if (result.success) {
      res.json({
        success: true,
        restartNeeded: result.restartNeeded,
        message: result.restartNeeded 
          ? 'Configuration updated, restart recommended for all changes to take effect'
          : 'Configuration updated successfully'
      });
    } else {
      throw new Error(result.error || 'Failed to update configuration');
    }
  } catch (error) {
    logService.error('Error updating configuration', error);
    res.status(500).json({ error: error.message });
  }
});

// API route for force-restarting the bot
app.post('/api/restart', authMiddleware, async (req, res) => {
  logService.logSecurityEvent('bot_restart_attempt', { ip: req.ip });
  
  try {
    const success = await tradingBot.restart();
    
    // Invalider tous les caches
    apiCache.clear();
    
    if (success) {
      logService.logSecurityEvent('bot_restart_success', { ip: req.ip });
      res.json({ success: true, message: 'Bot restarted successfully' });
    } else {
      res.json({ success: false, message: 'Bot was not running, no restart needed' });
    }
  } catch (error) {
    logService.error('Error restarting bot', error);
    logService.logSecurityEvent('bot_restart_failure', { ip: req.ip, error: error.message }, false);
    res.status(500).json({ error: error.message });
  }
});

// API route for clearing caches
app.post('/api/clear-cache', authMiddleware, async (req, res) => {
  try {
    // Nettoyer les caches
    tradingBot.dataManager.clearCaches();
    tradingBot.marketData.clearCaches();
    apiCache.clear();
    
    res.json({ success: true, message: 'Caches cleared successfully' });
  } catch (error) {
    logService.error('Error clearing caches', error);
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

// Graceful error handling
process.on('uncaughtException', async (error) => {
  logService.error('Uncaught exception', error);
  
  // Attempt safe shutdown
  try {
    if (tradingBot.isRunning) {
      await tradingBot.stop();
    }
    
    server.close(() => {
      logService.info('Server shut down after uncaught exception');
      process.exit(1);
    });
  } catch (shutdownError) {
    logService.error('Error during emergency shutdown', shutdownError);
    process.exit(1);
  }
});

export default app;