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

/**
 * Optimized Trading Bot - Main orchestration class
 * Improved with better separation of concerns and performance enhancements
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
    this.startTime = null;
    
    // Initialize logging and event handlers
    this._initializeLogging();
    this._initializeEventHandlers();
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
    
    // Initialize managers
    this.cycleManager = new CycleManager(
      this.config, 
      this.marketData,
      this.strategy,
      this.riskManager,
      this.positionManager,
      this.portfolioManager,
      this.logger
    );
    
    this.dataManager = new DataManager(
      this.config,
      this.marketData
    );
    
    this.simulationEngine = new SimulationEngine(
      this.config,
      this.strategy,
      this.riskManager,
      this.marketData,
      this.logger
    );
    
    // Connect events
    this._connectComponentEvents();
  }

  /**
   * Initialize logging
   * @private
   */
  _initializeLogging() {
    const logLevel = this.config.logging.level;
    
    this.on('trade', (trade) => {
      console.log(`[Bot] Trade executed: ${trade.token} - Profit: ${trade.profit}`);
    });
    
    this.on('error', (error) => {
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
    
    // Add risk management events
    this.riskManager.addListener((event, data) => {
      if (event.startsWith('RISK_')) {
        this.emit('info', `Risk event: ${event} - ${JSON.stringify(data)}`);
      }
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
      this.startTime = Date.now();
      
      this.emit('info', `Trading bot started at ${new Date(this.startTime).toISOString()}`);
      
      // Start the cycle manager
      await this.cycleManager.start();
      
      return true;
    } catch (error) {
      this.isRunning = false;
      this.emit('error', error);
      return false;
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
      
      const uptime = this._calculateRuntime();
      this.emit('info', `Trading bot stopped. Total runtime: ${uptime}`);
      
      return this.getPerformanceReport();
    } catch (error) {
      this.emit('error', error);
      this.isRunning = false;
      this.isStopping = false;
      return this.getPerformanceReport();
    }
  }

  /**
   * Close all open positions
   * @returns {Promise<Array>} Closed positions
   */
  async closeAllPositions() {
    return this.positionManager.closeAllPositions(await this.fetchCurrentPrices());
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
    
    return this.cycleManager.runTradingCycle();
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
      const prices = await this.marketData.getBatchTokenPrices(tokenMints);
      
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
        cyclesRun: this.cycleManager.getMetrics().cycleCount,
        successfulCycles: this.cycleManager.getMetrics().successfulCycles,
        failedCycles: this.cycleManager.getMetrics().failedCycles,
        lastCycleTime: this.cycleManager.getMetrics().lastCycleTime
          ? new Date(this.cycleManager.getMetrics().lastCycleTime).toISOString()
          : null
      }
    };
  }

  /**
   * Generate a formatted console report
   * @returns {string} Formatted report
   */
  generateConsoleReport() {
    return this.logger.generateConsoleReport();
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
   * Clean up resources
   */
  cleanup() {
    this.logger.cleanup();
    this.marketData.clearCaches();
    this.cycleManager.cleanup();
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