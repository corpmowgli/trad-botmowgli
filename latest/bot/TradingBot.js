// bot/TradingBot.js
import EventEmitter from 'events';
import { CycleManager } from './CycleManager.js';
import { DataManager } from './DataManager.js';
import { SimulationEngine } from './SimulationEngine.js';
import { StrategyFactory } from '../strategies/StrategyFactory.js';
import { MarketDataService } from '../services/MarketDataService.js';
import { RiskManager } from '../trading/RiskManager.js';
import { PositionManager } from '../trading/PositionManager.js';
import { PortfolioManager } from '../trading/PortfolioManager.js';
import { TradeLogger } from '../trading/TradeLogger.js';
import { NotificationService } from '../services/NotificationService.js';
import { deepClone, delay } from '../utils/helpers.js';

/**
 * Optimized Trading Bot - Main orchestration class
 * Enhanced with better performance, memory management and resilience
 */
export class TradingBot extends EventEmitter {
  /**
   * @param {Object} customConfig - Custom configuration (optional)
   */
  constructor(customConfig = {}) {
    super();
    
    // Configure bot
    this.configureBotComponents(customConfig);
    
    // Initialize state
    this.isRunning = false;
    this.isStopping = false;
    this.isPaused = false;
    this.startTime = null;
    this.lastHealthCheck = Date.now();
    
    // Health monitoring
    this.healthStatus = {
      status: 'idle',
      memoryUsage: process.memoryUsage(),
      lastCycle: null,
      errors: []
    };
    
    // Performance monitoring
    this.performanceMetrics = {
      cycleCount: 0,
      avgCycleTime: 0,
      totalCycleTime: 0,
      maxCycleTime: 0,
      minCycleTime: Infinity,
      lastApiLatency: 0,
      cacheEfficiency: 0,
      memoryLeakChecks: 0
    };
    
    // Initialize logging and event handlers
    this._initializeLogging();
    this._connectComponentEvents();
    this._initializeEventHandlers();
    
    // Set up periodic health check
    this._setupHealthCheck();
  }

  /**
   * Configure and initialize all bot components
   * @private
   * @param {Object} customConfig - Custom configuration
   */
  configureBotComponents(customConfig) {
    // Merge custom configuration with defaults
    this.config = { ...this._getDefaultConfig(), ...customConfig };
    
    // Initialize services and managers
    this.marketData = new MarketDataService(this.config);
    this.dataManager = new DataManager(this.config, this.marketData);
    
    // Core trading components
    this.portfolioManager = new PortfolioManager(this.config.simulation.initialCapital);
    this.riskManager = new RiskManager(this.config);
    this.positionManager = new PositionManager(this.config);
    this.logger = new TradeLogger(this.config);
    this.notificationService = new NotificationService(this.config);
    
    // Initialize strategy using factory pattern
    this.strategy = StrategyFactory.createStrategy(
      this.config.strategy.type || 'ENHANCED_MOMENTUM',
      this.config
    );
    
    // Initialize cycle manager
    this.cycleManager = new CycleManager(
      this.config, 
      this.dataManager, // Use dataManager instead of directly using marketData
      this.strategy,
      this.riskManager,
      this.positionManager,
      this.portfolioManager,
      this.logger
    );
    
    // Initialize simulation engine
    this.simulationEngine = new SimulationEngine(
      this.config,
      this.strategy,
      this.riskManager,
      this.dataManager,
      this.logger
    );
  }

  /**
   * Initialize logging
   * @private
   */
  _initializeLogging() {
    const logLevel = this.config.logging.level;
    
    this.on('trade', (trade) => {
      this.notificationService.notifyTrade(trade);
      console.log(`[Bot] Trade executed: ${trade.token} - Profit: ${trade.profit}`);
    });
    
    this.on('error', (error) => {
      this.healthStatus.errors.push({
        time: Date.now(),
        message: error.message,
        stack: error.stack
      });
      
      // Limiter le tableau d'erreurs à 20
      if (this.healthStatus.errors.length > 20) {
        this.healthStatus.errors.shift();
      }
      
      this.notificationService.notifyError(error);
      console.error(`[Bot] Error: ${error.message}`);
    });
    
    this.on('warning', (message) => {
      console.warn(`[Bot] Warning: ${message}`);
    });
    
    this.on('info', (message) => {
      if (logLevel === 'debug' || logLevel === 'info') {
        console.log(`[Bot] Info: ${message}`);
      }
    });
    
    this.on('debug', (message) => {
      if (logLevel === 'debug') {
        console.debug(`[Bot] Debug: ${message}`);
      }
    });
  }

  /**
   * Connect events from all components
   * @private
   */
  _connectComponentEvents() {
    // Forward essential events
    this.cycleManager.on('error', (error) => this.emit('error', error));
    this.cycleManager.on('warning', (message) => this.emit('warning', message));
    this.cycleManager.on('info', (message) => this.emit('info', message));
    this.cycleManager.on('debug', (message) => this.emit('debug', message));
    
    // Handle trade events
    this.positionManager.on('position_closed', (position) => {
      this.portfolioManager.updatePortfolio(position);
      const tradeLog = this.logger.logTrade(position);
      this.emit('trade', tradeLog);
    });
    
    this.positionManager.on('position_opened', (position) => {
      this.emit('info', `New position opened for ${position.token} at ${position.entryPrice}`);
    });
    
    // Add risk management events
    this.riskManager.on('risk_limit_reached', (data) => {
      this.emit('warning', `Risk limit reached: ${JSON.stringify(data)}`);
      this.notificationService.notifyAlert(`Risk limit reached: ${data.reason}`, 'high', data);
    });
    
    // Track cycle performance
    this.cycleManager.on('cycle_completed', (metrics) => {
      this.healthStatus.lastCycle = Date.now();
      this.performanceMetrics.cycleCount++;
      this.performanceMetrics.lastCycleTime = metrics.duration;
      this.performanceMetrics.totalCycleTime += metrics.duration;
      this.performanceMetrics.avgCycleTime = this.performanceMetrics.totalCycleTime / this.performanceMetrics.cycleCount;
      this.performanceMetrics.maxCycleTime = Math.max(this.performanceMetrics.maxCycleTime, metrics.duration);
      this.performanceMetrics.minCycleTime = Math.min(this.performanceMetrics.minCycleTime, metrics.duration);
    });
  }

  /**
   * Initialize event handlers
   * @private
   */
  _initializeEventHandlers() {
    // Process uncaught errors
    process.on('uncaughtException', (error) => {
      this.emit('error', new Error(`Uncaught exception: ${error.message}`));
      
      // Safely shut down if critical
      if (this.isRunning && !this.isStopping) {
        this.emit('warning', 'Critical error detected, stopping bot safely...');
        this.stop().catch(e => {
          console.error('Error during emergency stop:', e);
        });
      }
    });
    
    // Handle promise rejections
    process.on('unhandledRejection', (reason) => {
      this.emit('error', new Error(`Unhandled rejection: ${reason}`));
    });
  }

  /**
   * Setup periodic health check
   * @private
   */
  _setupHealthCheck() {
    // Vérifier la santé du bot toutes les 5 minutes
    setInterval(() => {
      if (!this.isRunning) return;
      
      this._performHealthCheck();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Perform system health check
   * @private
   */
  async _performHealthCheck() {
    try {
      // Mettre à jour les statistiques de santé
      this.healthStatus.memoryUsage = process.memoryUsage();
      this.healthStatus.lastHealthCheck = Date.now();
      
      // Vérifier si un cycle a été exécuté récemment
      const cycleInterval = this.config.trading.cycleInterval || 60000;
      const lastCycleAge = Date.now() - this.healthStatus.lastCycle;
      
      if (this.healthStatus.lastCycle && lastCycleAge > cycleInterval * 3) {
        this.emit('warning', `No trading cycle in ${Math.floor(lastCycleAge/1000)}s, checking system health...`);
        
        // Essayer de réinitialiser les caches si pas de cycle récent
        this.dataManager.clearCaches();
        this.marketData.clearCaches();
        
        // Forcer un nouveau cycle
        await this.runTradingCycle();
      }
      
      // Vérifier les fuites de mémoire potentielles
      const heapUsed = this.healthStatus.memoryUsage.heapUsed / 1024 / 1024;
      this.performanceMetrics.memoryLeakChecks++;
      
      if (heapUsed > 1024) { // Plus de 1GB de mémoire utilisée
        this.emit('warning', `High memory usage detected: ${heapUsed.toFixed(2)} MB`);
        
        if (heapUsed > 1536) { // Plus de 1.5GB, critique
          this.emit('error', new Error(`Critical memory usage: ${heapUsed.toFixed(2)} MB, restarting...`));
          
          // Sauvegarder l'état et redémarrer le bot
          await this.restart();
        }
      }
      
      // Vérifier l'efficacité du cache
      const dataManagerStats = this.dataManager.getStats();
      const totalRequests = dataManagerStats.cacheHits + dataManagerStats.cacheMisses;
      
      if (totalRequests > 0) {
        this.performanceMetrics.cacheEfficiency = (dataManagerStats.cacheHits / totalRequests) * 100;
      }
      
      // Vérifier la latence API
      const marketStats = this.marketData.getStats();
      this.performanceMetrics.lastApiLatency = marketStats.averageResponseTime || 0;
      
      if (this.performanceMetrics.lastApiLatency > 5000) { // Plus de 5 secondes de latence
        this.emit('warning', `High API latency detected: ${this.performanceMetrics.lastApiLatency}ms`);
      }
    } catch (error) {
      this.emit('error', new Error(`Health check failed: ${error.message}`));
    }
  }

  /**
   * Get default configuration
   * @private
   * @returns {Object} Default configuration
   */
  _getDefaultConfig() {
    return {
      trading: {
        cycleInterval: 60000, // 1 minute
        closePositionsOnStop: true,
        maxOpenPositions: 3,
        tradeSize: 2, // Percentage of portfolio per trade
        stopLoss: 5, // Percentage
        takeProfit: 15, // Percentage
        minConfidenceThreshold: 0.6
      },
      strategy: {
        type: 'ENHANCED_MOMENTUM'
      },
      errorHandling: {
        maxConsecutiveErrors: 3,
        circuitBreakerTimeout: 300000 // 5 minutes
      },
      logging: {
        level: 'info',
        persistentStorage: true,
        filePath: 'logs/trades'
      },
      simulation: {
        initialCapital: 10000,
        backtestDays: 30
      },
      performance: {
        tokenConcurrency: 5, // Traitement parallèle des tokens
        enableAutomaticRestarts: true, // Redémarrage automatique en cas de problème
        memoryThreshold: 1536, // Seuil de mémoire en MB
        memoryCheckInterval: 300000 // 5 minutes
      }
    };
  }

  /**
   * Start the trading bot
   * @returns {Promise<boolean>} True if the start was successful
   */
  async start() {
    if (this.isRunning) {
      this.emit('warning', 'Bot is already running');
      return false;
    }
    
    try {
      this.isRunning = true;
      this.isStopping = false;
      this.isPaused = false;
      this.startTime = Date.now();
      this.healthStatus.status = 'starting';
      
      this.emit('info', `Trading bot started at ${new Date(this.startTime).toISOString()}`);
      
      // Préchauffer le cache avec les données les plus importantes
      await this._preloadCriticalData();
      
      // Start the cycle manager
      await this.cycleManager.start();
      
      this.healthStatus.status = 'running';
      this.healthStatus.lastCycle = Date.now();
      
      // Envoyer une notification de démarrage
      this.notificationService.notify({
        type: 'system',
        title: 'Bot Started',
        message: `Trading bot started successfully at ${new Date().toLocaleString()}`,
        priority: 'medium'
      });
      
      return true;
    } catch (error) {
      this.isRunning = false;
      this.healthStatus.status = 'error';
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Précharge les données critiques au démarrage
   * @private
   */
  async _preloadCriticalData() {
    try {
      this.emit('info', 'Preloading critical market data...');
      
      // Récupérer les top tokens du marché
      const topTokens = await this.marketData.getTopTokens(20);
      
      if (topTokens && topTokens.length > 0) {
        // Extraire les adresses de tokens
        const tokenMints = topTokens.map(token => token.token_mint);
        
        // Précharger les prix en batch
        await this.dataManager.getBatchTokenPrices(tokenMints);
        
        // Précharger les données complètes (en arrière-plan)
        this.dataManager.preloadData(tokenMints);
      }
      
      this.emit('info', 'Critical data preloaded');
    } catch (error) {
      this.emit('warning', `Data preloading failed: ${error.message}`);
      // Continuer malgré l'échec du préchargement
    }
  }

  /**
   * Stop the trading bot
   * @returns {Promise<Object>} Final performance report
   */
  async stop() {
    if (!this.isRunning) {
      this.emit('warning', 'Bot is not running');
      return this.getPerformanceReport();
    }
    
    try {
      this.isStopping = true;
      this.healthStatus.status = 'stopping';
      this.emit('info', 'Stopping trading bot...');
      
      // Stop the cycle manager
      await this.cycleManager.stop();
      
      // Close all positions if configured
      if (this.config.trading.closePositionsOnStop) {
        await this.closeAllPositions();
      }
      
      // Generate final report
      const report = this.generateConsoleReport();
      console.log(report);
      
      // Clean up resources
      this.cleanup();
      
      this.isRunning = false;
      this.isStopping = false;
      this.healthStatus.status = 'stopped';
      
      const uptime = this._calculateRuntime();
      this.emit('info', `Trading bot stopped. Total runtime: ${uptime}`);
      
      // Envoyer une notification d'arrêt
      this.notificationService.notify({
        type: 'system',
        title: 'Bot Stopped',
        message: `Trading bot stopped after ${uptime} of runtime`,
        priority: 'medium'
      });
      
      return this.getPerformanceReport();
    } catch (error) {
      this.emit('error', error);
      this.isRunning = false;
      this.isStopping = false;
      this.healthStatus.status = 'error';
      return this.getPerformanceReport();
    }
  }

  /**
   * Restart the trading bot
   * @returns {Promise<boolean>} Success or failure
   */
  async restart() {
    this.emit('info', 'Restarting trading bot...');
    
    try {
      // Save current state if needed
      const wasRunning = this.isRunning;
      const currentPositions = this.positionManager.getOpenPositions();
      
      // Stop the bot
      await this.stop();
      
      // Clean up and reset
      this.cleanup();
      this.dataManager.clearCaches();
      this.marketData.clearCaches();
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Wait a bit to ensure cleanup is complete
      await delay(1000);
      
      // Restart if it was running
      if (wasRunning) {
        await this.start();
        
        // Notify about restart
        this.notificationService.notify({
          type: 'system',
          title: 'Bot Restarted',
          message: `Trading bot was restarted with ${currentPositions.length} open positions`,
          priority: 'high'
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      this.emit('error', new Error(`Failed to restart: ${error.message}`));
      return false;
    }
  }

  /**
   * Pause trading operations without stopping the bot
   * @returns {Promise<boolean>} Success or failure
   */
  async pause() {
    if (!this.isRunning || this.isPaused) {
      return false;
    }
    
    try {
      this.isPaused = true;
      this.healthStatus.status = 'paused';
      this.emit('info', 'Trading operations paused');
      
      // Notifier de la pause
      this.notificationService.notify({
        type: 'system',
        title: 'Trading Paused',
        message: 'Trading operations have been paused',
        priority: 'medium'
      });
      
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Resume trading operations
   * @returns {Promise<boolean>} Success or failure
   */
  async resume() {
    if (!this.isRunning || !this.isPaused) {
      return false;
    }
    
    try {
      this.isPaused = false;
      this.healthStatus.status = 'running';
      this.emit('info', 'Trading operations resumed');
      
      // Forcer un cycle immédiatement
      await this.runTradingCycle();
      
      // Notifier de la reprise
      this.notificationService.notify({
        type: 'system',
        title: 'Trading Resumed',
        message: 'Trading operations have been resumed',
        priority: 'medium'
      });
      
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Close all open positions
   * @returns {Promise<Array>} Closed positions
   */
  async closeAllPositions() {
    try {
      this.emit('info', 'Closing all positions...');
      return this.positionManager.closeAllPositions(await this.fetchCurrentPrices());
    } catch (error) {
      this.emit('error', new Error(`Failed to close positions: ${error.message}`));
      return [];
    }
  }

  /**
   * Run a trading cycle manually
   * @returns {Promise<boolean>} Success or failure
   */
  async runTradingCycle() {
    if (!this.isRunning) {
      this.emit('warning', 'Bot is not running');
      return false;
    }
    
    if (this.isPaused) {
      this.emit('warning', 'Bot is paused');
      return false;
    }
    
    try {
      return await this.cycleManager.runTradingCycle();
    } catch (error) {
      this.emit('error', new Error(`Failed to run trading cycle: ${error.message}`));
      return false;
    }
  }

  /**
   * Fetch current prices for all tokens in open positions
   * @returns {Promise<Map>} Map of current prices
   */
  async fetchCurrentPrices() {
    const positions = this.positionManager.getOpenPositions();
    const tokenMints = positions.map(position => position.token);
    
    if (tokenMints.length === 0) {
      return new Map();
    }
    
    try {
      // Use batch price fetching for better performance
      const prices = await this.dataManager.getBatchTokenPrices(tokenMints);
      
      // Convert to Map for consistent interface
      const priceMap = new Map();
      for (const [token, price] of Object.entries(prices)) {
        priceMap.set(token, price);
      }
      
      return priceMap;
    } catch (error) {
      this.emit('error', new Error(`Error fetching current prices: ${error.message}`));
      return new Map();
    }
  }

  /**
   * Run a simulation/backtest
   * @param {Date|string|number} startDate - Start date
   * @param {Date|string|number} endDate - End date
   * @returns {Promise<Object>} Simulation results
   */
  async runSimulation(startDate, endDate) {
    if (this.isRunning) {
      this.emit('warning', 'Cannot run simulation while bot is running');
      return { success: false, error: 'Bot is currently running' };
    }
    
    this.emit('info', `Starting simulation from ${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`);
    
    try {
      return await this.simulationEngine.runSimulation(startDate, endDate);
    } catch (error) {
      this.emit('error', new Error(`Error running simulation: ${error.message}`));
      return {
        success: false,
        error: error.message,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString()
      };
    }
  }

  /**
   * Optimize strategy parameters through backtesting
   * @param {Date|string|number} startDate - Start date
   * @param {Date|string|number} endDate - End date
   * @param {Object} parametersToOptimize - Parameters to optimize with ranges
   * @returns {Promise<Object>} Optimization results
   */
  async optimizeStrategy(startDate, endDate, parametersToOptimize) {
    if (this.isRunning) {
      this.emit('warning', 'Cannot optimize while bot is running');
      return { success: false, error: 'Bot is currently running' };
    }
    
    this.emit('info', `Starting strategy optimization...`);
    
    try {
      return await this.simulationEngine.optimizeParameters(
        startDate,
        endDate,
        parametersToOptimize
      );
    } catch (error) {
      this.emit('error', new Error(`Error optimizing strategy: ${error.message}`));
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update bot configuration
   * @param {Object} newConfig - New configuration
   * @returns {boolean} Success or failure
   */
  updateConfig(newConfig) {
    try {
      // Merge with current config
      const originalConfig = deepClone(this.config);
      this.config = { ...this.config, ...newConfig };
      
      // Check if restart needed for critical changes
      const criticalParameters = [
        'trading.cycleInterval',
        'trading.maxOpenPositions',
        'strategy.type'
      ];
      
      let restartNeeded = false;
      
      for (const param of criticalParameters) {
        const path = param.split('.');
        let origValue = originalConfig;
        let newValue = this.config;
        
        // Traverse the path
        for (const key of path) {
          origValue = origValue?.[key];
          newValue = newValue?.[key];
        }
        
        if (origValue !== newValue) {
          restartNeeded = true;
          break;
        }
      }
      
      // Apply non-critical changes immediately
      this.riskManager.updateConfig(this.config);
      this.positionManager.updateConfig(this.config);
      this.logger.updateConfig(this.config);
      
      // Return whether restart is needed
      return {
        success: true,
        restartNeeded
      };
    } catch (error) {
      this.emit('error', new Error(`Error updating config: ${error.message}`));
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get comprehensive performance report
   * @returns {Object} Performance report
   */
  getPerformanceReport() {
    return {
      metrics: this.logger.getPerformanceMetrics(),
      recentTrades: this.logger.getRecentTrades(10),
      dailyPerformance: this.logger.getDailyPerformance(),
      portfolioMetrics: this.portfolioManager.getMetrics(),
      botMetrics: {
        uptime: this._calculateRuntime(),
        isRunning: this.isRunning,
        isPaused: this.isPaused,
        healthStatus: { ...this.healthStatus },
        cyclesRun: this.cycleManager.getMetrics().cycleCount,
        successfulCycles: this.cycleManager.getMetrics().successfulCycles,
        failedCycles: this.cycleManager.getMetrics().failedCycles,
        tokensProcessed: this.cycleManager.getMetrics().tokensProcessed || 0,
        signalsGenerated: this.cycleManager.getMetrics().signalsGenerated || 0,
        lastCycleTime: this.cycleManager.getMetrics().lastCycleTime
          ? new Date(this.cycleManager.getMetrics().lastCycleTime).toISOString()
          : null,
        performanceMetrics: { ...this.performanceMetrics },
        dataManagerStats: this.dataManager.getStats(),
        marketDataStats: this.marketData.getStats()
      }
    };
  }

  /**
   * Generate a formatted console report
   * @returns {string} Formatted report
   */
  generateConsoleReport() {
    const report = this.getPerformanceReport();
    
    let formattedReport = '\n======== TRADING BOT PERFORMANCE REPORT ========\n\n';
    
    // Portfolio metrics
    formattedReport += `Total Profit: ${report.portfolioMetrics.totalProfit.toFixed(2)} (${report.portfolioMetrics.profitPercentage.toFixed(2)}%)\n`;
    formattedReport += `Trades: ${report.metrics.totalTrades} (${report.metrics.winningTrades} wins, ${report.metrics.losingTrades} losses, ${report.metrics.winRate.toFixed(1)}% win rate)\n`;
    formattedReport += `Avg Win: ${report.metrics.averageWin.toFixed(2)} | Avg Loss: ${report.metrics.averageLoss.toFixed(2)} | Profit Factor: ${report.metrics.profitFactor?.toFixed(2) || 'N/A'}\n\n`;
    
    // Recent trades
    formattedReport += '--- RECENT TRADES ---\n';
    report.recentTrades.forEach(trade => {
      formattedReport += `${trade.profit >= 0 ? '✓' : '✗'} ${trade.date} | ${trade.token} | ${trade.profit.toFixed(2)} (${trade.profitPercentage.toFixed(2)}%)\n`;
    });
    
    // Bot metrics
    formattedReport += '\n--- BOT METRICS ---\n';
    formattedReport += `Runtime: ${report.botMetrics.uptime} | Status: ${report.botMetrics.isRunning ? (report.botMetrics.isPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED'}\n`;
    formattedReport += `Cycles: ${report.botMetrics.cyclesRun} (${report.botMetrics.successfulCycles} success, ${report.botMetrics.failedCycles} failures)\n`;
    formattedReport += `Tokens Processed: ${report.botMetrics.tokensProcessed} | Signals Generated: ${report.botMetrics.signalsGenerated}\n`;
    formattedReport += `Cache Efficiency: ${report.botMetrics.performanceMetrics.cacheEfficiency.toFixed(2)}% | Avg Cycle Time: ${report.botMetrics.performanceMetrics.avgCycleTime.toFixed(0)}ms\n\n`;
    
    // Memory usage
    const heapUsed = report.botMetrics.healthStatus.memoryUsage?.heapUsed / 1024 / 1024 || 0;
    formattedReport += `Memory Usage: ${heapUsed.toFixed(2)} MB\n`;
    
    formattedReport += '\n==============================================\n';
    
    return formattedReport;
  }

  /**
   * Export trading logs
   * @param {string} format - Format (json or csv)
   * @returns {string} Exported logs
   */
  exportTradingLogs(format = 'json') {
    return this.logger.exportLogs(format);
  }

  /**
   * Get the health status of the bot
   * @returns {Object} Health status
   */
  getHealthStatus() {
    // Mettre à jour les statistiques de mémoire
    this.healthStatus.memoryUsage = process.memoryUsage();
    
    // Vérifier si le bot est bloqué
    if (this.isRunning && !this.isPaused && this.healthStatus.lastCycle) {
      const cycleAge = Date.now() - this.healthStatus.lastCycle;
      const expectedInterval = this.config.trading.cycleInterval || 60000;
      
      if (cycleAge > expectedInterval * 3) {
        this.healthStatus.status = 'stalled';
      }
    }
    
    return {
      ...this.healthStatus,
      openPositions: this.positionManager.getOpenPositions().length,
      queueSizes: {
        high: this.marketData.getStats().queueSizes?.high || 0,
        medium: this.marketData.getStats().queueSizes?.medium || 0,
        low: this.marketData.getStats().queueSizes?.low || 0
      },
      uptime: this._calculateRuntime(),
      tradeCount: this.logger.getPerformanceMetrics().totalTrades || 0,
      lastErrors: this.healthStatus.errors.slice(-5)
    };
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.logger.cleanup();
    this.dataManager.clearCaches();
    this.marketData.clearCaches();
    this.cycleManager.cleanup();
    this.notificationService.setEnabled(false);
  }

  /**
   * Calculate runtime duration
   * @private
   * @returns {string} Formatted runtime
   */
  _calculateRuntime() {
    if (!this.startTime) return '0s';
    
    const runtime = Date.now() - this.startTime;
    const seconds = Math.floor(runtime / 1000) % 60;
    const minutes = Math.floor(runtime / (1000 * 60)) % 60;
    const hours = Math.floor(runtime / (1000 * 60 * 60)) % 24;
    const days = Math.floor(runtime / (1000 * 60 * 60 * 24));
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

export default TradingBot;