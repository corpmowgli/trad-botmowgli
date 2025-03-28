// trading/riskManager.js

/**
 * Risk Manager
 * 
 * Handles all aspects of risk management including:
 * - Position sizing
 * - Stop loss and take profit levels
 * - Max drawdown protection
 * - Exposure limits
 * - Volatility-based adjustments
 */
export class RiskManager {
  /**
   * Create a new RiskManager instance
   * @param {Object} config - Trading configuration
   */
  constructor(config) {
    this.config = config;
    
    // Default risk limits
    this.limits = {
      maxDrawdown: config.simulation?.maxDrawdown || -15, // Maximum drawdown percentage allowed
      maxDailyLoss: config.trading?.maxDailyLoss || -5,   // Maximum daily loss percentage
      consecutiveLosses: config.trading?.maxConsecutiveLosses || 3, // Max consecutive losses before reducing size
      maxPositions: config.trading?.maxOpenPositions || 3, // Maximum number of concurrent positions
      maxLeverageMultiplier: config.trading?.maxLeverage || 1, // Maximum leverage (default: no leverage)
      maxRiskPerTrade: config.trading?.maxRiskPerTrade || 2, // Maximum percentage of portfolio to risk per trade
      maxExposure: config.trading?.maxExposure || 50, // Maximum total exposure percentage
      volatilityScaling: true, // Whether to scale position size based on volatility
      marketTrendAdjustment: true, // Whether to adjust risk based on market trend
      requiredConfidence: config.trading?.minSignalConfidence || 0.6 // Minimum signal confidence to trade
    };
    
    // Risk metrics - reset daily
    this.dailyStats = {
      trades: 0,
      wins: 0,
      losses: 0,
      profit: 0,
      loss: 0,
      largestLoss: 0,
      riskTaken: 0,
      date: new Date().toISOString().split('T')[0]
    };
    
    // Track consecutive losses
    this.consecutiveLosses = 0;
    
    // Risk adjustment factors
    this.adjustmentFactors = {
      current: 1.0, // Current risk adjustment (1.0 = 100% of configured risk)
      min: 0.25,    // Minimum risk level (25% of configured risk)
      max: 1.5,     // Maximum risk level (150% of configured risk)
      step: 0.1     // Risk adjustment step size
    };
    
    // Volatility tracking
    this.marketVolatility = {
      current: 'MEDIUM', // Current volatility level: LOW, MEDIUM, HIGH
      scalingFactors: {
        LOW: 1.2,    // Increase position size in low volatility
        MEDIUM: 1.0, // Normal position size
        HIGH: 0.8    // Reduce position size in high volatility
      }
    };
    
    // Track market trend
    this.marketTrend = {
      direction: 'NEUTRAL', // Current market trend: UP, DOWN, NEUTRAL
      strength: 0.5,        // Trend strength from 0-1
      adjustmentFactors: {
        UP: 1.1,       // Slightly increase long position size in uptrend
        NEUTRAL: 1.0,  // Normal position size
        DOWN: 0.9      // Slightly reduce long position size in downtrend
      }
    };
    
    // Historical performance tracking
    this.performance = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      averageWin: 0,
      averageLoss: 0,
      expectancy: 0,
      recentTrades: []
    };
    
    // Track active trades
    this.activeTrades = new Map();
    
    // Initialize event listeners
    this.listeners = [];
  }

  /**
   * Check if a new trade can be opened
   * @param {Object} portfolio - Current portfolio state
   * @param {Object} signal - Trading signal
   * @returns {boolean} Whether a trade can be opened
   */
  canTrade(portfolio, signal = {}) {
    // Update daily stats if we're on a new day
    this.checkDailyReset();
    
    // Check signal confidence
    if (signal.confidence && signal.confidence < this.limits.requiredConfidence) {
      return this.notifyRiskEvent('SIGNAL_CONFIDENCE_TOO_LOW', {
        confidence: signal.confidence,
        required: this.limits.requiredConfidence
      });
    }
    
    // Check for too many consecutive losses
    if (this.consecutiveLosses >= this.limits.consecutiveLosses) {
      return this.notifyRiskEvent('TOO_MANY_CONSECUTIVE_LOSSES', {
        count: this.consecutiveLosses,
        limit: this.limits.consecutiveLosses
      });
    }
    
    // Check for max open positions
    if (portfolio.openPositions && portfolio.openPositions.size >= this.limits.maxPositions) {
      return this.notifyRiskEvent('MAX_POSITIONS_REACHED', {
        current: portfolio.openPositions.size,
        max: this.limits.maxPositions
      });
    }
    
    // Check for maximum drawdown
    if (portfolio.currentCapital && portfolio.peakCapital) {
      const drawdown = ((portfolio.currentCapital - portfolio.peakCapital) / portfolio.peakCapital) * 100;
      if (drawdown <= this.limits.maxDrawdown) {
        return this.notifyRiskEvent('MAX_DRAWDOWN_EXCEEDED', {
          drawdown,
          limit: this.limits.maxDrawdown
        });
      }
    }
    
    // Check for maximum daily loss
    if (this.dailyStats.profit + this.dailyStats.loss < this.limits.maxDailyLoss) {
      return this.notifyRiskEvent('MAX_DAILY_LOSS_EXCEEDED', {
        dailyPnL: this.dailyStats.profit + this.dailyStats.loss,
        limit: this.limits.maxDailyLoss
      });
    }
    
    // Check total exposure
    if (portfolio.currentCapital) {
      // Calculate current total exposure
      let currentExposure = 0;
      if (portfolio.openPositions) {
        for (const [, position] of portfolio.openPositions) {
          currentExposure += position.value;
        }
      }
      
      const exposurePercentage = (currentExposure / portfolio.currentCapital) * 100;
      if (exposurePercentage >= this.limits.maxExposure) {
        return this.notifyRiskEvent('MAX_EXPOSURE_EXCEEDED', {
          exposure: exposurePercentage,
          limit: this.limits.maxExposure
        });
      }
    }
    
    // All risk checks passed
    return true;
  }

  /**
   * Calculate appropriate position size
   * @param {number} price - Current price of the asset
   * @param {Object} portfolio - Current portfolio state
   * @param {Object} options - Additional options
   * @returns {Object} Position sizing details
   */
  calculatePositionSize(price, portfolio, options = {}) {
    // Update daily stats if we're on a new day
    this.checkDailyReset();
    
    // Extract options with defaults
    const {
      signal = {},
      volatility = this.marketVolatility.current,
      trend = this.marketTrend.direction,
      riskMultiplier = 1.0
    } = options;
    
    // Base position size calculation using risk percentage
    const baseRiskPercentage = this.config.trading.tradeSize;
    
    // Apply risk adjustment factor
    let adjustedRiskPercentage = baseRiskPercentage * this.adjustmentFactors.current;
    
    // Apply any additional risk multiplier
    adjustedRiskPercentage *= riskMultiplier;
    
    // Apply signal confidence adjustment
    if (signal.confidence) {
      // Scale between 80% and 120% based on confidence
      const confidenceAdjustment = 0.8 + (signal.confidence * 0.4);
      adjustedRiskPercentage *= confidenceAdjustment;
    }
    
    // Apply volatility scaling if enabled
    if (this.limits.volatilityScaling) {
      adjustedRiskPercentage *= this.marketVolatility.scalingFactors[volatility];
    }
    
    // Apply market trend adjustment if enabled
    if (this.limits.marketTrendAdjustment) {
      adjustedRiskPercentage *= this.marketTrend.adjustmentFactors[trend];
    }
    
    // Cap the risk at the maximum allowed per trade
    adjustedRiskPercentage = Math.min(adjustedRiskPercentage, this.limits.maxRiskPerTrade);
    
    // Calculate risk amount
    const riskAmount = portfolio.currentCapital * (adjustedRiskPercentage / 100);
    
    // Calculate position size
    const positionSize = riskAmount / price;
    
    // Record risk taken
    this.dailyStats.riskTaken += adjustedRiskPercentage;
    
    return {
      amount: positionSize,
      value: positionSize * price,
      price,
      riskPercentage: adjustedRiskPercentage,
      riskAmount,
      stopLossPercentage: this.config.trading.stopLoss,
      takeProfitPercentage: this.config.trading.takeProfit,
      stopLossPrice: price * (1 - this.config.trading.stopLoss / 100),
      takeProfitPrice: price * (1 + this.config.trading.takeProfit / 100)
    };
  }

  /**
   * Calculate dynamic stop loss and take profit levels based on volatility
   * @param {number} entryPrice - Entry price of the position
   * @param {number} volatility - Current volatility (ATR or standard deviation)
   * @param {string} direction - Trade direction ('BUY' or 'SELL')
   * @returns {Object} Stop loss and take profit levels
   */
  calculateStopLevels(entryPrice, volatility, direction = 'BUY') {
    // Base stop loss and take profit percentages
    const baseStopLoss = this.config.trading.stopLoss;
    const baseTakeProfit = this.config.trading.takeProfit;
    
    // Adjust based on volatility (higher volatility = wider stops)
    const volatilityFactor = Math.max(0.5, Math.min(2.0, volatility * 10));
    
    let stopLossPercentage = baseStopLoss * volatilityFactor;
    let takeProfitPercentage = baseTakeProfit * volatilityFactor;
    
    // Calculate actual price levels based on direction
    let stopLossPrice, takeProfitPrice;
    
    if (direction === 'BUY') {
      stopLossPrice = entryPrice * (1 - stopLossPercentage / 100);
      takeProfitPrice = entryPrice * (1 + takeProfitPercentage / 100);
    } else {
      // For short positions, reverse the calculations
      stopLossPrice = entryPrice * (1 + stopLossPercentage / 100);
      takeProfitPrice = entryPrice * (1 - takeProfitPercentage / 100);
    }
    
    return {
      stopLossPercentage,
      takeProfitPercentage,
      stopLossPrice,
      takeProfitPrice,
      riskRewardRatio: takeProfitPercentage / stopLossPercentage
    };
  }

  /**
   * Register a new trade for tracking
   * @param {Object} trade - Trade details
   */
  registerTrade(trade) {
    if (!trade.id || !trade.entryPrice) {
      console.error('Invalid trade data for registration:', trade);
      return;
    }
    
    // Store in active trades map
    this.activeTrades.set(trade.id, { 
      ...trade, 
      status: 'ACTIVE',
      registeredAt: Date.now()
    });
    
    // Update daily stats
    this.dailyStats.trades++;
    
    this.notifyRiskEvent('TRADE_REGISTERED', { trade });
  }

  /**
   * Update the outcome of a completed trade
   * @param {Object} trade - Completed trade with profit/loss
   */
  updateTradeOutcome(trade) {
    if (!trade.id || trade.profit === undefined) {
      console.error('Invalid trade data for outcome update:', trade);
      return;
    }
    
    // Check if we have this trade registered
    if (!this.activeTrades.has(trade.id)) {
      console.warn(`Unregistered trade received for outcome update: ${trade.id}`);
    }
    
    // Update active trades map
    this.activeTrades.delete(trade.id);
    
    // Update daily stats
    if (trade.profit > 0) {
      this.dailyStats.wins++;
      this.dailyStats.profit += trade.profit;
      this.consecutiveLosses = 0; // Reset consecutive losses
    } else {
      this.dailyStats.losses++;
      this.dailyStats.loss += trade.profit; // This will be negative
      this.consecutiveLosses++;
      
      // Track largest loss
      if (trade.profit < this.dailyStats.largestLoss) {
        this.dailyStats.largestLoss = trade.profit;
      }
      
      // Decrease risk if consecutive losses threshold is crossed
      if (this.consecutiveLosses >= this.limits.consecutiveLosses) {
        this.decreaseRiskExposure('TOO_MANY_CONSECUTIVE_LOSSES');
      }
    }
    
    // Update performance metrics
    this.updatePerformanceMetrics(trade);
    
    // Notify listeners
    this.notifyRiskEvent('TRADE_COMPLETED', { 
      trade,
      dailyStats: { ...this.dailyStats },
      consecutiveLosses: this.consecutiveLosses
    });
  }

  /**
   * Update market volatility assessment
   * @param {Object} volatilityData - Volatility metrics
   */
  updateMarketVolatility(volatilityData) {
    const { value, indicator = 'ATR' } = volatilityData;
    
    // Update volatility category based on the value
    let volatilityCategory;
    
    if (indicator === 'ATR_PERCENTAGE') {
      // ATR as percentage of price
      if (value < 1.5) volatilityCategory = 'LOW';
      else if (value < 3.0) volatilityCategory = 'MEDIUM';
      else volatilityCategory = 'HIGH';
    } else {
      // Default assessment
      if (value < 0.5) volatilityCategory = 'LOW';
      else if (value < 1.5) volatilityCategory = 'MEDIUM';
      else volatilityCategory = 'HIGH';
    }
    
    // Only notify if volatility category changed
    if (volatilityCategory !== this.marketVolatility.current) {
      const oldCategory = this.marketVolatility.current;
      this.marketVolatility.current = volatilityCategory;
      
      this.notifyRiskEvent('VOLATILITY_CHANGED', {
        from: oldCategory,
        to: volatilityCategory,
        value
      });
    }
  }

  /**
   * Update market trend assessment
   * @param {Object} trendData - Trend analysis data
   */
  updateMarketTrend(trendData) {
    const { direction, strength = 0.5 } = trendData;
    
    // Only notify if trend direction changed
    if (direction !== this.marketTrend.direction) {
      const oldDirection = this.marketTrend.direction;
      
      this.marketTrend.direction = direction;
      this.marketTrend.strength = strength;
      
      this.notifyRiskEvent('TREND_CHANGED', {
        from: oldDirection,
        to: direction,
        strength
      });
    } else {
      // Still update the strength value
      this.marketTrend.strength = strength;
    }
  }

  /**
   * Decrease risk exposure after losses or drawdown
   * @param {string} reason - Reason for decreasing risk
   */
  decreaseRiskExposure(reason) {
    // Don't decrease below minimum
    if (this.adjustmentFactors.current <= this.adjustmentFactors.min) {
      return;
    }
    
    const oldFactor = this.adjustmentFactors.current;
    this.adjustmentFactors.current = Math.max(
      this.adjustmentFactors.min,
      this.adjustmentFactors.current - this.adjustmentFactors.step
    );
    
    this.notifyRiskEvent('RISK_DECREASED', {
      reason,
      from: oldFactor,
      to: this.adjustmentFactors.current,
      percentChange: ((this.adjustmentFactors.current - oldFactor) / oldFactor) * 100
    });
  }

  /**
   * Increase risk exposure after successful trading
   * @param {string} reason - Reason for increasing risk
   */
  increaseRiskExposure(reason) {
    // Don't increase above maximum
    if (this.adjustmentFactors.current >= this.adjustmentFactors.max) {
      return;
    }
    
    const oldFactor = this.adjustmentFactors.current;
    this.adjustmentFactors.current = Math.min(
      this.adjustmentFactors.max,
      this.adjustmentFactors.current + this.adjustmentFactors.step
    );
    
    this.notifyRiskEvent('RISK_INCREASED', {
      reason,
      from: oldFactor,
      to: this.adjustmentFactors.current,
      percentChange: ((this.adjustmentFactors.current - oldFactor) / oldFactor) * 100
    });
  }

  /**
   * Reset risk adjustment to default level
   */
  resetRiskAdjustment() {
    const oldFactor = this.adjustmentFactors.current;
    this.adjustmentFactors.current = 1.0;
    
    this.notifyRiskEvent('RISK_RESET', {
      from: oldFactor,
      to: this.adjustmentFactors.current
    });
  }

  /**
   * Check if the daily stats need to be reset (new day)
   * @private
   */
  checkDailyReset() {
    const today = new Date().toISOString().split('T')[0];
    
    if (today !== this.dailyStats.date) {
      const oldStats = { ...this.dailyStats };
      
      // Reset daily stats
      this.dailyStats = {
        trades: 0,
        wins: 0,
        losses: 0,
        profit: 0,
        loss: 0,
        largestLoss: 0,
        riskTaken: 0,
        date: today
      };
      
      this.notifyRiskEvent('DAILY_STATS_RESET', {
        oldStats,
        newDate: today
      });
      
      // If yesterday was profitable, consider increasing risk
      if (oldStats.profit + oldStats.loss > 0 && this.consecutiveLosses === 0) {
        this.increaseRiskExposure('PROFITABLE_DAY');
      }
    }
  }

  /**
   * Update the overall performance metrics
   * @private
   * @param {Object} trade - Completed trade
   */
  updatePerformanceMetrics(trade) {
    this.performance.totalTrades++;
    
    if (trade.profit > 0) {
      this.performance.winningTrades++;
    } else {
      this.performance.losingTrades++;
    }
    
    // Calculate win rate
    this.performance.winRate = this.performance.totalTrades > 0
      ? (this.performance.winningTrades / this.performance.totalTrades) * 100
      : 0;
    
    // Store recent trades
    this.performance.recentTrades.unshift({
      id: trade.id,
      token: trade.token,
      profit: trade.profit,
      profitPercentage: trade.profitPercentage,
      time: Date.now()
    });
    
    // Keep only the last 100 trades
    if (this.performance.recentTrades.length > 100) {
      this.performance.recentTrades = this.performance.recentTrades.slice(0, 100);
    }
    
    // Calculate average win and loss
    const winningTrades = this.performance.recentTrades.filter(t => t.profit > 0);
    const losingTrades = this.performance.recentTrades.filter(t => t.profit < 0);
    
    this.performance.averageWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.profit, 0) / winningTrades.length
      : 0;
    
    this.performance.averageLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + t.profit, 0) / losingTrades.length
      : 0;
    
    // Calculate expectancy
    this.performance.expectancy = (this.performance.winRate / 100) * this.performance.averageWin +
                                  (1 - this.performance.winRate / 100) * this.performance.averageLoss;
  }

  /**
   * Notify listeners of risk events
   * @private
   * @param {string} event - Event type
   * @param {Object} data - Event data
   * @returns {boolean} Should continue with trade
   */
  notifyRiskEvent(event, data) {
    // Log the event
    console.log(`[RiskManager] ${event}:`, data);
    
    // Notify all listeners
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (error) {
        console.error('Error in risk event listener:', error);
      }
    });
    
    // For risk check events, return whether the trade should proceed
    switch (event) {
      case 'SIGNAL_CONFIDENCE_TOO_LOW':
      case 'TOO_MANY_CONSECUTIVE_LOSSES':
      case 'MAX_POSITIONS_REACHED':
      case 'MAX_DRAWDOWN_EXCEEDED':
      case 'MAX_DAILY_LOSS_EXCEEDED':
      case 'MAX_EXPOSURE_EXCEEDED':
        return false;
      default:
        return true;
    }
  }

  /**
   * Add a listener for risk events
   * @param {Function} callback - Callback function for risk events
   * @returns {Function} Function to remove the listener
   */
  addListener(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Listener must be a function');
    }
    
    this.listeners.push(callback);
    
    // Return function to remove the listener
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Get current risk metrics
   * @returns {Object} Current risk metrics
   */
  getRiskMetrics() {
    return {
      adjustmentFactor: this.adjustmentFactors.current,
      volatility: this.marketVolatility.current,
      trend: this.marketTrend,
      dailyStats: { ...this.dailyStats },
      consecutiveLosses: this.consecutiveLosses,
      activeTrades: this.activeTrades.size,
      performance: { ...this.performance },
      limits: { ...this.limits }
    };
  }
  
  /**
   * Validate a potential trade against risk parameters
   * @param {Object} trade - Trade to validate
   * @param {Object} portfolio - Current portfolio state
   * @returns {Object} Validation result
   */
  validateTrade(trade, portfolio) {
    const issues = [];
    
    // Check position size against risk limits
    if (trade.value > portfolio.currentCapital * (this.limits.maxRiskPerTrade / 100)) {
      issues.push({
        type: 'POSITION_SIZE_TOO_LARGE',
        message: 'Position size exceeds maximum risk per trade',
        severity: 'HIGH'
      });
    }
    
    // Check stop loss distance
    if (trade.stopLossPrice) {
      const stopLossPercent = Math.abs((trade.stopLossPrice - trade.entryPrice) / trade.entryPrice) * 100;
      
      if (stopLossPercent > this.config.trading.stopLoss * 1.5) {
        issues.push({
          type: 'STOP_LOSS_TOO_FAR',
          message: 'Stop loss is placed too far from entry price',
          severity: 'MEDIUM',
          data: { percent: stopLossPercent }
        });
      } else if (stopLossPercent < this.config.trading.stopLoss * 0.5) {
        issues.push({
          type: 'STOP_LOSS_TOO_CLOSE',
          message: 'Stop loss is placed too close to entry price',
          severity: 'LOW',
          data: { percent: stopLossPercent }
        });
      }
    }
    
    // Check risk/reward ratio
    if (trade.takeProfitPrice && trade.stopLossPrice) {
      const potential = Math.abs(trade.takeProfitPrice - trade.entryPrice);
      const risk = Math.abs(trade.stopLossPrice - trade.entryPrice);
      const riskRewardRatio = potential / risk;
      
      if (riskRewardRatio < 1.5) {
        issues.push({
          type: 'POOR_RISK_REWARD_RATIO',
          message: 'Risk/reward ratio is below recommended level',
          severity: 'MEDIUM',
          data: { ratio: riskRewardRatio }
        });
      }
    }
    
    // Check if this would exceed max exposure
    let currentExposure = 0;
    if (portfolio.openPositions) {
      for (const [, position] of portfolio.openPositions) {
        currentExposure += position.value;
      }
    }
    
    const newExposure = ((currentExposure + trade.value) / portfolio.currentCapital) * 100;
    if (newExposure > this.limits.maxExposure) {
      issues.push({
        type: 'EXPOSURE_LIMIT_EXCEEDED',
        message: 'This trade would exceed maximum portfolio exposure',
        severity: 'HIGH',
        data: { exposure: newExposure, limit: this.limits.maxExposure }
      });
    }
    
    return {
      valid: issues.length === 0,
      issues,
      trade
    };
  }
}

export default RiskManager;