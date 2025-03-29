// trading/simulationEngine.js
import { generateUUID } from '../utils/helpers.js';

/**
 * Simulation Engine for backtesting trading strategies
 * Allows running simulations on historical data to evaluate strategy performance
 */
export class SimulationEngine {
  /**
   * Create a new SimulationEngine
   * @param {Object} marketDataService - Service for retrieving market data
   * @param {Object} strategy - Trading strategy to test
   * @param {Object} riskManager - Risk management service
   * @param {Object} [config={}] - Configuration options
   */
  constructor(marketDataService, strategy, riskManager, config = {}) {
    this.marketData = marketDataService;
    this.strategy = strategy;
    this.riskManager = riskManager;
    this.config = config;
    
    // Initial portfolio state
    this.portfolio = {
      initialCapital: config.simulation?.initialCapital || 10000,
      currentCapital: config.simulation?.initialCapital || 10000,
      availableCapital: config.simulation?.initialCapital || 10000,
      peakCapital: config.simulation?.initialCapital || 10000,
      lowestCapital: config.simulation?.initialCapital || 10000
    };
    
    // Tracking metrics
    this.metrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      profits: [],
      drawdowns: [],
      maxDrawdown: 0,
      sharpeRatio: 0,
      volatility: 0
    };
    
    // Storage for simulation results
    this.trades = [];
    this.dailyResults = new Map();
  }

  /**
   * Run a full simulation between date ranges
   * @param {Date|string|number} startDate - Simulation start date
   * @param {Date|string|number} endDate - Simulation end date
   * @param {Object} [options={}] - Simulation options
   * @returns {Object} Simulation results
   */
  async runSimulation(startDate, endDate, options = {}) {
    try {
      // Reset metrics for new simulation
      this.resetSimulation();
      
      // Convert date parameters to Date objects if they aren't already
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      console.log(`Starting simulation from ${start.toISOString()} to ${end.toISOString()}`);
      
      // Get qualified tokens for simulation
      const tokens = await this.marketData.getQualifiedTokens(
        this.config.trading.minLiquidity,
        this.config.trading.minVolume24h
      );
      
      if (!tokens || tokens.length === 0) {
        throw new Error('No qualified tokens found for simulation');
      }
      
      console.log(`Running simulation with ${tokens.length} qualified tokens`);
      
      // Process each token sequentially
      for (const token of tokens) {
        await this.processTokenInSimulation(token, start, end);
      }
      
      // Calculate final performance metrics
      this.calculateFinalMetrics();
      
      return {
        success: true,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        trades: this.trades,
        metrics: this.metrics,
        dailyResults: Array.from(this.dailyResults.values())
      };
    } catch (error) {
      console.error('Error running simulation:', error);
      return {
        success: false,
        error: error.message,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString()
      };
    }
  }
  
  /**
   * Process a token in the simulation
   * @private
   * @param {Object} token - Token to process
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   */
  async processTokenInSimulation(token, startDate, endDate) {
    try {
      // Calculate hour difference between dates
      const hourDiff = (endDate - startDate) / (1000 * 60 * 60);
      
      // Get historical data for the token
      const historicalData = await this.marketData.getHistoricalPrices(
        token.token_mint,
        startDate.getTime(),
        endDate.getTime(),
        '1h' // 1 hour intervals
      );
      
      if (!historicalData || historicalData.length < 50) {
        console.debug(`Insufficient historical data for ${token.token_mint}, skipping`);
        return;
      }
      
      console.debug(`Processing ${token.token_mint} with ${historicalData.length} data points`);
      
      // Analyze historical data with sliding window
      for (let i = 50; i < historicalData.length; i++) {
        // Prepare analysis window
        const windowData = historicalData.slice(i - 50, i);
        const prices = windowData.map(d => d.price);
        const volumes = windowData.map(d => d.volume);
        
        // Get market data for current window
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
        
        // Check if we have a valid signal and can trade
        if (signal.type !== 'NONE' && signal.confidence >= this.config.trading.minConfidenceThreshold) {
          // Mock portfolio object for risk manager
          const mockPortfolio = {
            currentCapital: this.portfolio.currentCapital,
            availableCapital: this.portfolio.availableCapital,
            openPositions: { size: this.trades.filter(t => !t.exitTimestamp).length }
          };
          
          // Check if we can trade according to risk parameters
          if (this.riskManager.canTrade(mockPortfolio)) {
            // Simulate the trade
            const trade = this.simulateTrade(
              token.token_mint,
              historicalData[i],
              historicalData.slice(i),
              signal
            );
            
            if (trade) {
              this.trades.push(trade);
              this.updateMetrics(trade);
              this.updateDailyResults(trade);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error processing token ${token.token_mint} in simulation:`, error);
    }
  }
  
  /**
   * Simulate a trade
   * @private
   * @param {string} tokenMint - Token identifier
   * @param {Object} entryData - Entry point data
   * @param {Array} futureData - Future price data for exit simulation
   * @param {Object} signal - Trading signal
   * @returns {Object|null} Simulated trade or null
   */
  simulateTrade(tokenMint, entryData, futureData, signal) {
    try {
      if (!tokenMint || !entryData || !entryData.price || !futureData || futureData.length < 2) {
        return null;
      }
      
      // Calculate position size
      const positionSize = this.riskManager.calculatePositionSize(
        entryData.price,
        { currentCapital: this.portfolio.currentCapital }
      );
      
      // Set stop loss and take profit levels
      const stopLoss = entryData.price * (1 - (this.config.trading.stopLoss / 100));
      const takeProfit = entryData.price * (1 + (this.config.trading.takeProfit / 100));
      
      // Find exit point in future data
      let exitData = null;
      let holdingTime = 0;
      let exitReason = 'TIMEOUT';
      
      // Maximum holding period (defaults to 48 hours or less if not enough data)
      const maxHoldingPeriods = Math.min(48, futureData.length - 1);
      
      // Scan future data for exit conditions
      for (let i = 1; i <= maxHoldingPeriods; i++) {
        const currentPrice = futureData[i].price;
        holdingTime = futureData[i].timestamp - entryData.timestamp;
        
        // Check for stop loss hit
        if (currentPrice <= stopLoss) {
          exitData = futureData[i];
          exitReason = 'STOP_LOSS';
          break;
        }
        
        // Check for take profit hit
        if (currentPrice >= takeProfit) {
          exitData = futureData[i];
          exitReason = 'TAKE_PROFIT';
          break;
        }
        
        // Check for max holding time
        const maxHoldingHours = this.config.simulation?.maxHoldingPeriodHours || 24;
        if (holdingTime >= maxHoldingHours * 60 * 60 * 1000) {
          exitData = futureData[i];
          exitReason = 'MAX_HOLDING_TIME';
          break;
        }
      }
      
      // If no exit point was found, use the last available data point
      if (!exitData && futureData.length > 1) {
        exitData = futureData[maxHoldingPeriods];
        holdingTime = exitData.timestamp - entryData.timestamp;
        exitReason = 'END_OF_DATA';
      } else if (!exitData) {
        // Not enough future data to simulate exit
        return null;
      }
      
      // Calculate profit/loss
      const entryValue = positionSize * entryData.price;
      const exitValue = positionSize * exitData.price;
      const profit = exitValue - entryValue;
      const profitPercentage = ((exitData.price - entryData.price) / entryData.price) * 100;
      
      // Update portfolio
      this.portfolio.currentCapital += profit;
      this.portfolio.availableCapital += profit;
      
      // Update peak and lowest capital values
      if (this.portfolio.currentCapital > this.portfolio.peakCapital) {
        this.portfolio.peakCapital = this.portfolio.currentCapital;
      }
      
      if (this.portfolio.currentCapital < this.portfolio.lowestCapital) {
        this.portfolio.lowestCapital = this.portfolio.currentCapital;
      }
      
      // Create trade object
      return {
        id: generateUUID(),
        token: tokenMint,
        entryPrice: entryData.price,
        exitPrice: exitData.price,
        amount: positionSize,
        value: entryValue,
        profit,
        profitPercentage,
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
      console.error(`Error simulating trade for ${tokenMint}:`, error);
      return null;
    }
  }
  
  /**
   * Update metrics with a new trade
   * @private
   * @param {Object} trade - Completed trade
   */
  updateMetrics(trade) {
    this.metrics.totalTrades++;
    this.metrics.totalProfit += trade.profit;
    this.metrics.profits.push(trade.profit);
    
    if (trade.profit > 0) {
      this.metrics.winningTrades++;
    } else {
      this.metrics.losingTrades++;
    }
    
    // Calculate current drawdown
    const currentDrawdown = ((this.portfolio.peakCapital - this.portfolio.currentCapital) / this.portfolio.peakCapital) * 100;
    this.metrics.drawdowns.push(currentDrawdown);
    
    if (currentDrawdown > this.metrics.maxDrawdown) {
      this.metrics.maxDrawdown = currentDrawdown;
    }
  }
  
  /**
   * Update daily results with a new trade
   * @private
   * @param {Object} trade - Completed trade
   */
  updateDailyResults(trade) {
    // Get date string (YYYY-MM-DD)
    const date = new Date(trade.timestamp).toISOString().split('T')[0];
    
    if (!this.dailyResults.has(date)) {
      this.dailyResults.set(date, {
        date,
        trades: 0,
        winningTrades: 0,
        losingTrades: 0,
        profit: 0,
        volume: 0
      });
    }
    
    const dayResult = this.dailyResults.get(date);
    dayResult.trades++;
    dayResult.profit += trade.profit;
    dayResult.volume += trade.value;
    
    if (trade.profit > 0) {
      dayResult.winningTrades++;
    } else {
      dayResult.losingTrades++;
    }
  }
  
  /**
   * Calculate final metrics after simulation
   * @private
   */
  calculateFinalMetrics() {
    const { profits } = this.metrics;
    
    // Calculate win rate
    this.metrics.winRate = this.metrics.totalTrades > 0
      ? (this.metrics.winningTrades / this.metrics.totalTrades) * 100
      : 0;
    
    // Calculate Sharpe ratio (simplified)
    if (profits.length > 0) {
      const meanReturn = profits.reduce((sum, p) => sum + p, 0) / profits.length;
      const diffSquared = profits.map(p => Math.pow(p - meanReturn, 2));
      const variance = diffSquared.reduce((sum, d) => sum + d, 0) / profits.length;
      const stdDev = Math.sqrt(variance);
      
      this.metrics.volatility = stdDev;
      this.metrics.sharpeRatio = stdDev !== 0 ? meanReturn / stdDev : 0;
    }
    
    // Calculate profit factor
    const totalGains = profits.filter(p => p > 0).reduce((sum, p) => sum + p, 0);
    const totalLosses = Math.abs(profits.filter(p => p < 0).reduce((sum, p) => sum + p, 0));
    
    this.metrics.profitFactor = totalLosses > 0 ? totalGains / totalLosses : totalGains > 0 ? Infinity : 0;
    
    // Final capital performance
    this.metrics.finalCapital = this.portfolio.currentCapital;
    this.metrics.totalReturn = ((this.portfolio.currentCapital - this.portfolio.initialCapital) / this.portfolio.initialCapital) * 100;
  }
  
  /**
   * Reset simulation state
   * @private
   */
  resetSimulation() {
    // Reset portfolio
    this.portfolio = {
      initialCapital: this.config.simulation?.initialCapital || 10000,
      currentCapital: this.config.simulation?.initialCapital || 10000,
      availableCapital: this.config.simulation?.initialCapital || 10000,
      peakCapital: this.config.simulation?.initialCapital || 10000,
      lowestCapital: this.config.simulation?.initialCapital || 10000
    };
    
    // Reset metrics
    this.metrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      profits: [],
      drawdowns: [],
      maxDrawdown: 0,
      sharpeRatio: 0,
      volatility: 0
    };
    
    // Reset storage
    this.trades = [];
    this.dailyResults = new Map();
  }
}

export default SimulationEngine;