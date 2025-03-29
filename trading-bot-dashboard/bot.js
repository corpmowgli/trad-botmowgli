//bot.js
// bot.js - Optimized Trading Bot
import { tradingConfig } from './config/tradingConfig.js';
import { TradingStrategy } from './strategies/tradingStrategy.js';
import { MarketDataService } from './services/marketDataService.js';
import { RiskManager } from './trading/riskManager.js';
import { PositionManager } from './trading/positionManager.js';
import { PortfolioManager } from './trading/portfolioManager.js';
import { TradeLogger } from './trading/tradeLogger.js';
import { retry, delay, generateUUID } from './utils/helpers.js';
import EventEmitter from 'events';

/**
 * Trading Bot Core Class
 * Orchestrates all trading system components
 */
export class TradingBot extends EventEmitter {
  /**
   * Create a new TradingBot instance
   * @param {Object} customConfig - Custom configuration (optional)
   */
  constructor(customConfig = {}) {
    super();
    
    // Configuration
    this.config = { ...tradingConfig, ...customConfig };
    
    // System components
    this.strategy = new TradingStrategy(this.config);
    this.marketData = new MarketDataService(this.config);
    this.riskManager = new RiskManager(this.config);
    this.positionManager = new PositionManager(this.config);
    this.portfolioManager = new PortfolioManager(this.config.simulation.initialCapital);
    this.logger = new TradeLogger(this.config);
    
    // Consolidated state
    this.state = {
      isRunning: false,
      isStopping: false,
      consecutiveErrors: 0,
      startTime: null,
      lastCycleTime: null,
      cycleCount: 0,
      successfulCycles: 0,
      failedCycles: 0,
      isProcessingCycle: false
    };
    
    // Interval IDs for cleanup
    this.intervals = {
      mainLoop: null,
      statusUpdate: null,
      cleanupTask: null
    };
    
    // Initialize logging
    this._initializeLogging();
  }

  /**
   * Initialize event logging
   * @private
   */
  _initializeLogging() {
    // Configure event listeners for logging
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
      if (this.config.logging.level === 'debug' || this.config.logging.level === 'info') {
        console.log(`[Bot] Info: ${message}`);
      }
    });
    
    this.on('debug', (message) => {
      if (this.config.logging.level === 'debug') {
        console.debug(`[Bot] Debug: ${message}`);
      }
    });
  }

  /**
   * Start the trading bot
   * @returns {Promise<boolean>} True if startup succeeds
   */
  async start() {
    if (this.state.isRunning) {
      this.emit('warning', 'Bot is already running');
      return false;
    }
    
    try {
      this.state.isRunning = true;
      this.state.isStopping = false;
      this.state.startTime = Date.now();
      this.state.consecutiveErrors = 0;
      this.emit('info', `Trading bot started at ${new Date(this.state.startTime).toISOString()}`);
      
      // Set up the main trading cycle interval
      const cycleInterval = this.config.trading.cycleInterval || 60000; // Default: 1 minute
      this.intervals.mainLoop = setInterval(() => this.runTradingCycle(), cycleInterval);
      
      // Set up status update interval
      this.intervals.statusUpdate = setInterval(() => this.emitStatusUpdate(), 30000);
      
      // Set up cleanup task interval (once a day)
      this.intervals.cleanupTask = setInterval(() => this.performCleanupTasks(), 24 * 60 * 60 * 1000);
      
      // Run the first cycle immediately
      this.runTradingCycle();
      
      return true;
    } catch (error) {
      this.state.isRunning = false;
      this.emit('error', error);
      return false;
    }
  }
  
  /**
   * Stop the trading bot
   * @returns {Promise<Object>} Final performance report
   */
  async stop() {
    if (!this.state.isRunning) {
      this.emit('warning', 'Bot is not running');
      return this.getPerformanceReport();
    }
    
    try {
      this.state.isStopping = true;
      this.emit('info', 'Stopping trading bot...');
      
      // Clear all intervals
      Object.values(this.intervals).forEach(interval => {
        if (interval) clearInterval(interval);
      });
      
      // Close all open positions if configured
      if (this.config.trading.closePositionsOnStop) {
        await this.closeAllPositions();
      }
      
      // Generate final report
      const report = this.generateConsoleReport();
      console.log(report);
      
      // Cleanup resources
      this.logger.cleanup();
      
      this.state.isRunning = false;
      this.state.isStopping = false;
      this.emit('info', `Trading bot stopped. Total runtime: ${this._calculateRuntime()}`);
      
      return this.getPerformanceReport();
    } catch (error) {
      this.emit('error', error);
      this.state.isRunning = false;
      this.state.isStopping = false;
      return this.getPerformanceReport();
    }
  }
  
  /**
   * Run a complete trading cycle
   * @returns {Promise<boolean>} True if cycle succeeds
   */
  async runTradingCycle() {
    // Avoid running multiple cycles simultaneously
    if (this.state.isProcessingCycle) {
      this.emit('debug', 'Trading cycle already in progress, skipping');
      return false;
    }
    
    // Mark cycle start
    this.state.isProcessingCycle = true;
    this.state.lastCycleTime = Date.now();
    this.state.cycleCount++;
    
    try {
      this.emit('debug', `Starting trading cycle #${this.state.cycleCount}`);
      
      // Step 1: Get qualified tokens
      const tokens = await retry(
        () => this.getQualifiedTokens(),
        3,
        1000,
        (retry, delay, error) => this.emit('debug', `Retrying getQualifiedTokens (${retry}/3): ${error.message}`)
      );
      
      if (!tokens || tokens.length === 0) {
        this.emit('info', 'No qualified tokens found in this cycle');
      } else {
        this.emit('debug', `Found ${tokens.length} qualified tokens`);
        
        // Step 2: Process each token sequentially
        for (const token of tokens) {
          if (this.state.isStopping) break;
          
          await this.processToken(token);
          await delay(500); // Small pause between tokens
        }
      }
      
      // Step 3: Check and close positions that have reached their targets
      await this.checkAndClosePositions();
      
      this.state.successfulCycles++;
      this.state.consecutiveErrors = 0;
      this.emit('debug', `Completed trading cycle #${this.state.cycleCount}`);
      
      return true;
    } catch (error) {
      this.state.failedCycles++;
      this.state.consecutiveErrors++;
      this.emit('error', error);
      
      // Check for too many consecutive errors
      if (this.state.consecutiveErrors >= this.config.errorHandling.maxConsecutiveErrors) {
        this.emit('warning', `Too many consecutive errors (${this.state.consecutiveErrors}), activating circuit breaker`);
        this._activateCircuitBreaker();
      }
      
      return false;
    } finally {
      // Mark cycle end
      this.state.isProcessingCycle = false;
    }
  }
  
  /**
   * Process a specific token for analysis and potential trading
   * @param {Object} token - Token information
   * @returns {Promise<Object|null>} Opened position or null
   */
  async processToken(token) {
    try {
      // Check if we already have a position for this token
      const openPositions = this.positionManager.getOpenPositions();
      if (openPositions.some(p => p.token === token.token_mint)) {
        this.emit('debug', `Already have a position for ${token.token_mint}, skipping`);
        return null;
      }
      
      // Get aggregated market data
      const marketData = await this.marketData.aggregateTokenData(token.token_mint);
      
      // Get historical data
      const historicalData = await this.getHistoricalData(token.token_mint);
      
      // Check if we have enough data
      if (!historicalData || historicalData.length < this.config.indicators.minimumDataPoints) {
        this.emit('debug', `Insufficient historical data for ${token.token_mint}`);
        return null;
      }
      
      // Prepare data for analysis
      const prices = historicalData.map(data => data.price);
      const volumes = historicalData.map(data => data.volume);
      
      // Analyze with trading strategy
      const signal = await this.strategy.analyze(
        token.token_mint,
        prices, 
        volumes, 
        marketData
      );
      
      // Check if signal is valid and if we can trade based on risk management
      if (signal.type === 'NONE' || signal.confidence < this.config.trading.minConfidenceThreshold) {
        this.emit('debug', `No valid signal for ${token.token_mint} (Confidence: ${signal.confidence})`);
        return null;
      }
      
      // Check if we can trade according to risk management
      if (!this.riskManager.canTrade(this.portfolioManager)) {
        this.emit('info', `Risk management prevents trading for ${token.token_mint}`);
        return null;
      }
      
      // Calculate position size
      const price = prices[prices.length - 1];
      const amount = this.riskManager.calculatePositionSize(price, this.portfolioManager);
      
      // Open a new position with signal information
      const position = await this.openNewPosition(token.token_mint, price, amount, signal);
      
      return position;
    } catch (error) {
      this.emit('error', new Error(`Error processing token ${token.token_mint}: ${error.message}`));
      return null;
    }
  }

  /**
   * Check and close positions that have reached their targets
   * @returns {Promise<Array>} Closed positions
   */
  async checkAndClosePositions() {
    try {
      // Get current prices for all positions
      const currentPrices = await this.fetchCurrentPrices();
      
      // Check positions with current prices
      const closedPositions = await this.positionManager.checkPositions(currentPrices);
      
      // Process closed positions
      for (const position of closedPositions) {
        // Update portfolio
        this.portfolioManager.updatePortfolio(position);
        
        // Log the trade with additional signal information
        const tradeLog = this.logger.logTrade({
          ...position,
          signalConfidence: position.signalConfidence || 0,
          signalReasons: position.signalReasons || []
        });
        
        // Emit trade event
        this.emit('trade', tradeLog);
      }
      
      if (closedPositions.length > 0) {
        this.emit('info', `Closed ${closedPositions.length} positions`);
      }
      
      return closedPositions;
    } catch (error) {
      this.emit('error', new Error(`Error checking positions: ${error.message}`));
      return [];
    }
  }

  /**
   * Open a new position
   * @param {string} token - Token to trade
   * @param {number} price - Entry price
   * @param {number} amount - Amount to trade
   * @param {Object} signal - Trading signal
   * @returns {Promise<Object|null>} Opened position or null
   */
  async openNewPosition(token, price, amount, signal) {
    try {
      // Validate input parameters
      if (!token || !price || !amount || price <= 0 || amount <= 0) {
        this.emit('warning', `Invalid parameters for opening position: token=${token}, price=${price}, amount=${amount}`);
        return null;
      }
      
      // Check if maximum number of positions is reached
      const openPositions = this.positionManager.getOpenPositions();
      if (openPositions.length >= this.config.trading.maxOpenPositions) {
        this.emit('info', `Maximum number of open positions (${this.config.trading.maxOpenPositions}) reached`);
        return null;
      }
      
      // Open the position
      const position = await this.positionManager.openPosition(token, price, amount);
      
      if (position) {
        // Store signal information in the position for logging
        position.signalConfidence = signal.confidence;
        position.signalReasons = signal.reasons;
        position.signal = signal.type;
        position.openTime = Date.now();
        position.id = generateUUID();
        
        this.emit('info', `Opened new position for ${token} at price ${price}, amount: ${amount}, signal: ${signal.type}`);
        return position;
      }
      
      return null;
    } catch (error) {
      this.emit('error', new Error(`Error opening position for ${token}: ${error.message}`));
      return null;
    }
  }

  /**
   * Close all open positions
   * @returns {Promise<Array>} Closed positions
   */
  async closeAllPositions() {
    try {
      const positions = this.positionManager.getOpenPositions();
      
      if (positions.length === 0) {
        this.emit('info', 'No open positions to close');
        return [];
      }
      
      this.emit('info', `Closing all ${positions.length} open positions`);
      
      // Get current prices
      const currentPrices = await this.fetchCurrentPrices();
      
      const closedPositions = [];
      
      // Manually close each position
      for (const position of positions) {
        const price = currentPrices.get(position.token) || position.entryPrice;
        
        try {
          const closedPosition = {
            ...position,
            exitPrice: price,
            profit: (price - position.entryPrice) * position.amount,
            profitPercentage: ((price - position.entryPrice) / position.entryPrice) * 100,
            holdingTime: Date.now() - position.openTime,
            closedAt: Date.now(),
            closeReason: 'MANUAL_CLOSE'
          };
          
          // Update portfolio
          this.portfolioManager.updatePortfolio(closedPosition);
          
          // Log the trade
          this.logger.logTrade(closedPosition);
          
          // Emit trade event
          this.emit('trade', closedPosition);
          
          closedPositions.push(closedPosition);
        } catch (error) {
          this.emit('error', new Error(`Error closing position for ${position.token}: ${error.message}`));
        }
      }
      
      // Clear all positions
      this.positionManager.clearPositions();
      
      return closedPositions;
    } catch (error) {
      this.emit('error', new Error(`Error closing all positions: ${error.message}`));
      return [];
    }
  }

  /**
   * Get current prices for all tokens in positions
   * @returns {Promise<Map>} Map of current prices (token -> price)
   */
  async fetchCurrentPrices() {
    const positions = this.positionManager.getOpenPositions();
    const prices = new Map();
    
    for (const position of positions) {
      try {
        const price = await retry(
          () => this.marketData.getTokenPrice(position.token),
          3,
          1000
        );
        
        if (price) {
          prices.set(position.token, price);
        } else {
          // If price is unavailable, use entry price as fallback
          prices.set(position.token, position.entryPrice);
          this.emit('warning', `Could not fetch current price for ${position.token}, using entry price`);
        }
      } catch (error) {
        this.emit('error', new Error(`Error fetching price for ${position.token}: ${error.message}`));
        // Use entry price as fallback
        prices.set(position.token, position.entryPrice);
      }
    }
    
    return prices;
  }

  /**
   * Get qualified tokens according to configured criteria
   * @returns {Promise<Array>} List of qualified tokens
   */
  async getQualifiedTokens() {
    try {
      const response = await this.marketData.getQualifiedTokens(
        this.config.trading.minLiquidity,
        this.config.trading.minVolume24h
      );
      
      // Validate and filter response
      if (!response || !Array.isArray(response)) {
        this.emit('warning', 'Invalid response from getQualifiedTokens');
        return [];
      }
      
      // Filter out invalid tokens
      return response.filter(token => 
        token && token.token_mint && typeof token.token_mint === 'string'
      );
    } catch (error) {
      this.emit('error', new Error(`Error getting qualified tokens: ${error.message}`));
      return [];
    }
  }
  
  /**
   * Get historical data for a specific token
   * @param {string} tokenMint - Token address
   * @param {number} lookbackPeriod - Lookback period in hours (default: 50)
   * @returns {Promise<Array>} Historical data
   */
  async getHistoricalData(tokenMint, lookbackPeriod = 50) {
    try {
      // Validate parameters
      if (!tokenMint || typeof tokenMint !== 'string') {
        this.emit('warning', `Invalid tokenMint parameter: ${tokenMint}`);
        return [];
      }
      
      if (lookbackPeriod <= 0) {
        lookbackPeriod = 50; // Default value
      }
      
      // Calculate timestamps
      const endTime = Date.now();
      const startTime = endTime - (lookbackPeriod * 3600 * 1000); // lookbackPeriod in hours
      
      const response = await retry(
        () => this.marketData.getHistoricalPrices(
          tokenMint,
          startTime,
          endTime,
          '1h' // 1-hour intervals
        ),
        3,
        1000
      );
      
      // Validate response
      if (!response || !Array.isArray(response)) {
        this.emit('warning', `Invalid historical data response for ${tokenMint}`);
        return [];
      }
      
      // Filter and validate data
      return response.filter(item => 
        item && 
        typeof item.price === 'number' && 
        typeof item.volume === 'number' && 
        typeof item.timestamp === 'number'
      );
    } catch (error) {
      this.emit('error', new Error(`Error getting historical data for ${tokenMint}: ${error.message}`));
      return [];
    }
  }
  
  /**
   * Run a backtest simulation
   * @param {Date|string|number} startDate - Start date
   * @param {Date|string|number} endDate - End date
   * @returns {Promise<Object>} Simulation results
   */
  async runSimulation(startDate, endDate) {
    if (this.state.isRunning) {
      this.emit('warning', 'Cannot run simulation while bot is running');
      return {
        success: false,
        error: 'Bot is currently running'
      };
    }
    
    this.emit('info', `Starting simulation from ${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`);
    
    const simulationResult = {
      success: true,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      trades: [],
      metrics: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalProfit: 0,
        winRate: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        sharpeRatio: 0
      }
    };
    
    try {
      // Reset portfolio for simulation
      const initialCapital = this.config.simulation.initialCapital;
      const simulationPortfolio = new PortfolioManager(initialCapital);
      
      // Get qualified tokens for simulation
      const tokens = await this.getQualifiedTokens();
      
      if (!tokens || tokens.length === 0) {
        throw new Error('No qualified tokens found for simulation');
      }
      
      this.emit('info', `Running simulation on ${tokens.length} qualified tokens`);
      
      // Variables for drawdown and Sharpe ratio
      let peakCapital = initialCapital;
      let maxDrawdown = 0;
      let dailyReturns = [];
      let currentCapital = initialCapital;
      
      // Process each token
      for (const token of tokens) {
        // Get complete historical data for the backtest period
        const historicalData = await this.getHistoricalData(
          token.token_mint,
          this._calculateHoursBetween(startDate, endDate)
        );
        
        // Ensure we have sufficient data for analysis
        if (!historicalData || historicalData.length < 50) {
          this.emit('debug', `Insufficient historical data for ${token.token_mint}, skipping`);
          continue;
        }
        
        this.emit('debug', `Processing token ${token.token_mint} with ${historicalData.length} data points`);
        
        // Simulate trading for each trading window
        for (let i = 50; i < historicalData.length; i++) {
          // Get window data for analysis
          const windowData = historicalData.slice(i - 50, i);
          const prices = windowData.map(d => d.price);
          const volumes = windowData.map(d => d.volume);
          
          // Get market metrics for current window
          const marketData = {
            liquidity: token.liquidity || 0,
            volume24h: token.volume24h || 0,
            priceChange24h: ((prices[prices.length - 1] - prices[prices.length - 25]) / prices[prices.length - 25]) * 100,
            marketCap: token.marketCap || 0,
            fullyDilutedValuation: token.fdv || 0
          };
          
          // Analyze with strategy
          const signal = await this.strategy.analyze(
            token.token_mint,
            prices,
            volumes,
            marketData
          );
          
          // If we have a valid signal, simulate a trade
          if (signal.type !== 'NONE' && signal.confidence >= this.config.trading.minConfidenceThreshold) {
            const trade = this.simulateTrade(
              token.token_mint,
              historicalData[i],
              historicalData.slice(i),
              signal,
              simulationPortfolio
            );
            
            if (trade) {
              simulationResult.trades.push(trade);
              
              // Update metrics
              this.updateSimulationMetrics(simulationResult.metrics, trade);
              
              // Update capital for drawdown calculation
              currentCapital += trade.profit;
              
              // Update peak capital if necessary
              if (currentCapital > peakCapital) {
                peakCapital = currentCapital;
              }
              
              // Calculate current drawdown
              const currentDrawdown = ((peakCapital - currentCapital) / peakCapital) * 100;
              maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
              
              // Record daily return for Sharpe ratio
              const dateKey = new Date(trade.timestamp).toISOString().split('T')[0];
              dailyReturns.push({
                date: dateKey,
                return: (trade.profit / initialCapital) * 100
              });
            }
          }
        }
      }
      
      // Calculate final metrics
      if (simulationResult.metrics.totalTrades > 0) {
        // Win rate
        simulationResult.metrics.winRate = 
          (simulationResult.metrics.winningTrades / simulationResult.metrics.totalTrades) * 100;
        
        // Max drawdown
        simulationResult.metrics.maxDrawdown = maxDrawdown;
        
        // Profit factor
        const totalGain = simulationResult.trades
          .filter(t => t.profit > 0)
          .reduce((sum, t) => sum + t.profit, 0);
        
        const totalLoss = Math.abs(simulationResult.trades
          .filter(t => t.profit < 0)
          .reduce((sum, t) => sum + t.profit, 0));
        
        simulationResult.metrics.profitFactor = totalLoss > 0 ? totalGain / totalLoss : totalGain > 0 ? Infinity : 0;
        
        // Sharpe ratio (simplified)
        if (dailyReturns.length > 1) {
          const returns = dailyReturns.map(d => d.return);
          const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
          const stdDev = Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
          );
          
          simulationResult.metrics.sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
        }
      }
      
      this.emit('info', `Simulation completed with ${simulationResult.metrics.totalTrades} trades`);
      
      return simulationResult;
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
   * Simulate a trade based on historical data
   * @param {string} tokenMint - Token address
   * @param {Object} entryData - Entry data
   * @param {Array} futureData - Future data for simulation
   * @param {Object} signal - Trading signal
   * @param {Object} portfolio - Simulated portfolio
   * @returns {Object|null} Simulated trade or null
   */
  simulateTrade(tokenMint, entryData, futureData, signal, portfolio) {
    try {
      // Validate inputs
      if (!tokenMint || !entryData || !entryData.price || !futureData || futureData.length < 2) {
        return null;
      }
      
      // Calculate position size based on portfolio and risk management
      const positionSize = this.riskManager.calculatePositionSize(
        entryData.price,
        portfolio
      );
      
      // Define exit conditions (stop loss and take profit)
      const stopLoss = entryData.price * (1 - (this.config.trading.stopLoss / 100));
      const takeProfit = entryData.price * (1 + (this.config.trading.takeProfit / 100));
      
      // Find exit point in future data
      let exitData = null;
      let holdingTime = 0;
      let exitReason = 'TIMEOUT';
      
      // Loop through future data (limited to 48 hours max)
      for (let i = 1; i < futureData.length && i < 48; i++) {
        const currentPrice = futureData[i].price;
        holdingTime = futureData[i].timestamp - entryData.timestamp;
        
        // Check if stop loss or take profit is reached
        if (currentPrice <= stopLoss) {
          exitData = futureData[i];
          exitReason = 'STOP_LOSS';
          break;
        }
        
        if (currentPrice >= takeProfit) {
          exitData = futureData[i];
          exitReason = 'TAKE_PROFIT';
          break;
        }
        
        // Maximum holding period (24 hours by default)
        const maxHoldingHours = this.config.simulation.maxHoldingPeriodHours || 24;
        if (holdingTime >= maxHoldingHours * 60 * 60 * 1000) {
          exitData = futureData[i];
          exitReason = 'MAX_HOLDING_TIME';
          break;
        }
      }
      
      // If no exit point found, use the last available data point
      if (!exitData && futureData.length > 1) {
        exitData = futureData[Math.min(24, futureData.length - 1)];
        holdingTime = exitData.timestamp - entryData.timestamp;
        exitReason = 'END_OF_DATA';
      } else if (!exitData) {
        // Not enough future data to simulate exit
        return null;
      }
      
      // Calculate profit
      const profit = (exitData.price - entryData.price) * positionSize;
      
      // Update simulated portfolio
      portfolio.updatePortfolio({
        token: tokenMint,
        entryPrice: entryData.price,
        exitPrice: exitData.price,
        amount: positionSize,
        profit,
        timestamp: entryData.timestamp,
        holdingTime,
        signal: signal.type
      });
      
      // Return the simulated trade
      return {
        id: generateUUID(),
        token: tokenMint,
        entryPrice: entryData.price,
        exitPrice: exitData.price,
        amount: positionSize,
        profit,
        profitPercentage: ((exitData.price - entryData.price) / entryData.price) * 100,
        timestamp: entryData.timestamp,
        exitTimestamp: exitData.timestamp,
        holdingTime,
        signal: signal.type,
        signalConfidence: signal.confidence,
        signalReasons: signal.reasons,
        stopLoss,
        takeProfit,
        exitReason
      };
    } catch (error) {
      this.emit('error', new Error(`Error simulating trade for ${tokenMint}: ${error.message}`));
      return null;
    }
  }
  
  /**
   * Update simulation metrics with trade data
   * @param {Object} metrics - Metrics to update
   * @param {Object} trade - Trade data
   */
  updateSimulationMetrics(metrics, trade) {
    if (!metrics || !trade) return;
    
    metrics.totalTrades++;
    metrics.totalProfit += trade.profit;
    
    if (trade.profit > 0) {
      metrics.winningTrades++;
    } else {
      metrics.losingTrades++;
    }
  }
  
  /**
   * Get a complete performance report
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
        isRunning: this.state.isRunning,
        cyclesRun: this.state.cycleCount,
        successfulCycles: this.state.successfulCycles,
        failedCycles: this.state.failedCycles,
        lastCycleTime: this.state.lastCycleTime 
          ? new Date(this.state.lastCycleTime).toISOString() 
          : null
      }
    };
  }
  
  /**
   * Export trading logs
   * @param {string} format - Export format (json or csv)
   * @returns {string} Exported logs
   */
  exportTradingLogs(format = 'json') {
    return this.logger.exportLogs(format);
  }
  
  /**
   * Generate console report
   * @returns {string} Formatted console report
   */
  generateConsoleReport() {
    return this.logger.getFormattedReport();
  }
  
  /**
   * Emit status update to connected clients
   */
  emitStatusUpdate() {
    if (!this.state.isRunning) return;
    
    const statusUpdate = {
      timestamp: new Date().toISOString(),
      botStatus: {
        isRunning: this.state.isRunning,
        uptime: this._calculateRuntime(),
        cyclesRun: this.state.cycleCount,
        successfulCycles: this.state.successfulCycles,
        failedCycles: this.state.failedCycles
      },
      portfolioStatus: this.portfolioManager.getMetrics(),
      openPositions: this.positionManager.getOpenPositions().length
    };
    
    this.emit('status', statusUpdate);
  }
  
  /**
   * Perform periodic cleanup tasks
   */
  async performCleanupTasks() {
    try {
      this.emit('info', 'Performing scheduled cleanup tasks');
      
      // Clean up old logs
      const deletedFiles = await this.logger.cleanupOldLogs(90); // 90 days
      
      if (deletedFiles > 0) {
        this.emit('info', `Cleaned up ${deletedFiles} old log files`);
      }
      
      // Automatic log export
      const exported = await this.logger.exportAndSaveLogs('json');
      
      if (exported) {
        this.emit('info', 'Successfully exported trading logs');
      }
      
      return true;
    } catch (error) {
      this.emit('error', new Error(`Error during cleanup tasks: ${error.message}`));
      return false;
    }
  }
  
  /**
   * Activate circuit breaker after consecutive errors
   * @private
   */
  _activateCircuitBreaker() {
    // Temporarily stop the bot
    this.state.isRunning = false;
    
    // Clear intervals
    Object.values(this.intervals).forEach(interval => {
      if (interval) clearInterval(interval);
    });
    
    this.emit('warning', `Circuit breaker activated, pausing for ${this.config.errorHandling.circuitBreakerTimeout / 1000} seconds`);
    
    // Restart after configured timeout
    setTimeout(() => {
      this.emit('info', 'Circuit breaker timeout expired, restarting bot');
      this.start().catch(error => {
        this.emit('error', new Error(`Failed to restart after circuit breaker: ${error.message}`));
      });
    }, this.config.errorHandling.circuitBreakerTimeout);
  }
  
  /**
   * Calculate bot runtime
   * @returns {string} Formatted runtime
   * @private
   */
  _calculateRuntime() {
    if (!this.state.startTime) return '0s';
    
    const runtime = Date.now() - this.state.startTime;
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
  
  /**
   * Calculate hours between two dates
   * @param {Date|string|number} start - Start date
   * @param {Date|string|number} end - End date
   * @returns {number} Number of hours
   * @private
   */
  _calculateHoursBetween(start, end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    const diffMs = Math.abs(endDate - startDate);
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }
}

export default TradingBot;