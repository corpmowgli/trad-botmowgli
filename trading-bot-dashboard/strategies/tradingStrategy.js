// tradingStrategy.js
import { technicalAnalysis } from '../utils/indicators.js';

/**
 * Unified Trading Strategy
 * Combines basic and enhanced momentum strategies into a single configurable class
 */
export class TradingStrategy {
  /**
   * Create a new trading strategy instance
   * @param {Object} config - Configuration for the strategy
   * @param {Object} options - Additional options
   */
  constructor(config, options = {}) {
    this.config = config;
    this.enhanced = options.enhanced !== false; // Use enhanced by default
    
    // Cache for previous signals to avoid signal flipping
    this.lastSignals = new Map();
    
    // Track strategy performance
    this.performance = {
      totalSignals: 0,
      correctSignals: 0,
      falsePositives: 0,
      profitableTokens: new Set(),
      signalHistory: []
    };
    
    // Strength thresholds for signal generation
    this.signalThresholds = {
      strong: 0.8,   // Highly confident signal
      medium: 0.6,   // Medium confidence signal
      weak: 0.4      // Low confidence signal
    };
    
    // Configure indicator weights
    this.indicatorWeights = {
      rsi: 0.2,
      macd: 0.25,
      bollingerBands: 0.15,
      priceAction: 0.2,
      volume: 0.1,
      marketTrend: 0.1
    };
  }

  /**
   * Analyze a token and generate trading signals
   * @param {string} token - Token identifier
   * @param {Array<number>} prices - Historical price data
   * @param {Array<number>} volumes - Historical volume data
   * @param {Object} marketData - Additional market data
   * @returns {Object} Trading signal with confidence and reasons
   */
  async analyze(token, prices, volumes, marketData = {}) {
    // Ensure we have enough data
    if (prices.length < 30) {
      return this.createNeutralSignal('INSUFFICIENT_DATA');
    }
    
    // Calculate technical indicators
    const indicators = await this.calculateIndicators(prices, volumes);
    
    // Use appropriate analysis mode based on configuration
    return this.enhanced
      ? this.performEnhancedAnalysis(token, prices, volumes, indicators, marketData)
      : this.performBasicAnalysis(prices, volumes, indicators);
  }
  
  /**
   * Perform basic momentum analysis (simplified strategy)
   * @private
   */
  async performBasicAnalysis(prices, volumes, indicators) {
    let signal = {
      type: 'NONE',
      confidence: 0,
      reasons: []
    };

    // Price Action Analysis using Bollinger Bands
    if (prices[prices.length - 1] < indicators.bb.lower) {
      signal.confidence += 0.4;
      signal.reasons.push('PRICE_BELOW_BB');
    } else if (prices[prices.length - 1] > indicators.bb.upper) {
      signal.confidence += 0.4;
      signal.type = 'SELL';
      signal.reasons.push('PRICE_ABOVE_BB');
    }

    // RSI Analysis
    if (indicators.rsi.last < this.config.indicators.rsi.oversold) {
      signal.confidence += 0.3;
      signal.reasons.push('RSI_OVERSOLD');
    } else if (indicators.rsi.last > this.config.indicators.rsi.overbought) {
      signal.confidence += 0.3;
      signal.type = 'SELL';
      signal.reasons.push('RSI_OVERBOUGHT');
    }

    // MACD Analysis
    const macdSignal = this.analyzeMacd(indicators.macd);
    signal.confidence += macdSignal.weight;
    signal.reasons.push(macdSignal.reason);
    
    // Volume Analysis
    if (this.isVolumeIncreasing(volumes)) {
      signal.confidence += 0.2;
      signal.reasons.push('VOLUME_INCREASING');
    }

    // Determine final signal type
    if (signal.confidence > 0.7) {
      signal.type = signal.reasons.some(r => r.includes('SELL')) ? 'SELL' : 'BUY';
    }

    return signal;
  }
  
  /**
   * Perform enhanced momentum analysis (comprehensive strategy)
   * @private
   */
  async performEnhancedAnalysis(token, prices, volumes, indicators, marketData) {
    // Initial neutral signal
    let signal = {
      type: 'NONE',
      confidence: 0,
      reasons: [],
      indicators: {},
      token
    };
    
    // Analyze trend direction
    const trend = this.analyzeTrend(prices);
    signal.indicators.trend = trend;
    signal.confidence += trend.weight * this.indicatorWeights.marketTrend;
    signal.reasons.push(trend.reason);
    
    // Analyze RSI with divergence detection
    const rsiSignal = this.analyzeRSI(indicators.rsi, prices);
    signal.indicators.rsi = rsiSignal;
    signal.confidence += rsiSignal.weight * this.indicatorWeights.rsi;
    signal.reasons.push(rsiSignal.reason);
    
    // Analyze MACD with confirmation
    const macdSignal = this.analyzeMacd(indicators.macd, trend.direction);
    signal.indicators.macd = macdSignal;
    signal.confidence += macdSignal.weight * this.indicatorWeights.macd;
    signal.reasons.push(macdSignal.reason);
    
    // Analyze Bollinger Bands
    const bbSignal = this.analyzeBollingerBands(prices, indicators.bb);
    signal.indicators.bollingerBands = bbSignal;
    signal.confidence += bbSignal.weight * this.indicatorWeights.bollingerBands;
    signal.reasons.push(bbSignal.reason);
    
    // Analyze price action patterns
    const priceActionSignal = this.analyzePricePatterns(prices);
    signal.indicators.priceAction = priceActionSignal;
    signal.confidence += priceActionSignal.weight * this.indicatorWeights.priceAction;
    signal.reasons.push(priceActionSignal.reason);
    
    // Analyze volume profile
    const volumeSignal = this.analyzeVolumeProfile(volumes, prices);
    signal.indicators.volume = volumeSignal;
    signal.confidence += volumeSignal.weight * this.indicatorWeights.volume;
    signal.reasons.push(volumeSignal.reason);
    
    // Apply trend bias - higher weight for signals aligned with the trend
    if (trend.direction === 'UP' && macdSignal.direction === 'UP' && rsiSignal.direction === 'UP') {
      signal.confidence *= 1.2; // 20% bonus for aligned indicators
    } else if (trend.direction === 'DOWN' && macdSignal.direction === 'DOWN' && rsiSignal.direction === 'DOWN') {
      signal.confidence *= 1.2; // 20% bonus for aligned indicators
    }
    
    // Apply signal persistence filter (avoid frequent signal changes)
    signal = this.applySignalPersistenceFilter(token, signal);
    
    // Determine final signal type based on confidence and direction
    if (signal.confidence >= this.signalThresholds.strong) {
      const direction = this.determineDirection(signal.indicators);
      signal.type = direction === 'UP' ? 'BUY' : 'SELL';
      signal.strength = 'STRONG';
    } else if (signal.confidence >= this.signalThresholds.medium) {
      const direction = this.determineDirection(signal.indicators);
      signal.type = direction === 'UP' ? 'BUY' : 'SELL';
      signal.strength = 'MEDIUM';
    } else if (signal.confidence >= this.signalThresholds.weak) {
      const direction = this.determineDirection(signal.indicators);
      signal.type = direction === 'UP' ? 'BUY' : 'SELL';
      signal.strength = 'WEAK';
    }
    
    // Track the signal for performance analysis
    this.trackSignal(token, signal);
    
    return signal;
  }
  
  /**
   * Helper method implementations - these are shared by both analysis modes
   */
  
  analyzeMacd(macd) {
    if (macd.histogram > 0 && macd.histogram > macd.previousHistogram) {
      return { weight: 0.35, reason: 'MACD_BULLISH_CROSSOVER', direction: 'UP' };
    }
    if (macd.histogram < 0 && macd.histogram < macd.previousHistogram) {
      return { weight: 0.35, reason: 'MACD_BEARISH_CROSSOVER', direction: 'DOWN' };
    }
    return { weight: 0, reason: 'MACD_NEUTRAL', direction: 'NEUTRAL' };
  }

  isVolumeIncreasing(volumes) {
    if (volumes.length < 5) return false;
    
    // Compare average of last 3 periods with average of previous 3 periods
    const recent = volumes.slice(-3).reduce((sum, vol) => sum + vol, 0) / 3;
    const previous = volumes.slice(-6, -3).reduce((sum, vol) => sum + vol, 0) / 3;
    
    return recent > previous * 1.2; // 20% increase threshold
  }
  
  analyzeBollingerBands(prices, bb) {
    const currentPrice = prices[prices.length - 1];
    
    let weight = 0;
    let reason = 'BB_NEUTRAL';
    let direction = 'NEUTRAL';
    
    // Calculate bandwidth and %B
    const bandwidth = (bb.upper - bb.lower) / bb.middle;
    const percentB = (currentPrice - bb.lower) / (bb.upper - bb.lower);
    
    // Check for price near bands
    if (currentPrice <= bb.lower) {
      weight = 0.6;
      reason = 'PRICE_AT_LOWER_BAND';
      direction = 'UP';
    } else if (currentPrice >= bb.upper) {
      weight = 0.6;
      reason = 'PRICE_AT_UPPER_BAND';
      direction = 'DOWN';
    }
    // Look for squeeze (low bandwidth) which often precedes a big move
    else if (bandwidth < 0.1) {
      weight = 0.3;
      reason = 'BOLLINGER_SQUEEZE';
      direction = 'NEUTRAL';
    }
    // Check for position within bands
    else if (percentB < 0.2) {
      weight = 0.4;
      reason = 'PRICE_NEAR_LOWER_BAND';
      direction = 'UP';
    } else if (percentB > 0.8) {
      weight = 0.4;
      reason = 'PRICE_NEAR_UPPER_BAND';
      direction = 'DOWN';
    }
    
    return {
      currentPrice,
      upper: bb.upper,
      middle: bb.middle,
      lower: bb.lower,
      bandwidth,
      percentB,
      weight,
      reason,
      direction
    };
  }
  
  analyzeRSI(rsi, prices) {
    const config = this.config.indicators.rsi;
    const lastRSI = rsi.last;
    let weight = 0;
    let reason = 'RSI_NEUTRAL';
    let direction = 'NEUTRAL';
    
    // Check for oversold/overbought conditions
    if (lastRSI < config.oversold) {
      weight = 0.7;
      reason = 'RSI_OVERSOLD';
      direction = 'UP';
    } else if (lastRSI > config.overbought) {
      weight = 0.7;
      reason = 'RSI_OVERBOUGHT';
      direction = 'DOWN';
    }
    // Check for trending but not extreme RSI
    else if (lastRSI < 40) {
      weight = 0.4;
      reason = 'RSI_TRENDING_LOW';
      direction = 'UP';
    } else if (lastRSI > 60) {
      weight = 0.4;
      reason = 'RSI_TRENDING_HIGH';
      direction = 'DOWN';
    }
    
    // Check for RSI divergence (if we have enough values)
    if (rsi.values && rsi.values.length > 5 && prices.length > 5) {
      const divergence = this.checkDivergence(
        prices.slice(-5),
        rsi.values.slice(-5)
      );
      
      if (divergence.hasDivergence) {
        reason = divergence.type === 'bullish' ? 'BULLISH_RSI_DIVERGENCE' : 'BEARISH_RSI_DIVERGENCE';
        weight = 0.8; // Divergence is a strong signal
        direction = divergence.type === 'bullish' ? 'UP' : 'DOWN';
      }
    }
    
    return {
      value: lastRSI,
      weight,
      reason,
      direction,
      isOversold: lastRSI < config.oversold,
      isOverbought: lastRSI > config.overbought
    };
  }

  /**
   * Additional helper methods for enhanced analysis
   */
  
  // Simple implementation of these methods - you can expand them as needed
  analyzeTrend(prices) {
    // Simple trend calculation based on recent price movement
    const recentPrices = prices.slice(-10);
    const firstPrice = recentPrices[0];
    const lastPrice = recentPrices[recentPrices.length - 1];
    const change = (lastPrice - firstPrice) / firstPrice;
    
    if (change > 0.05) {
      return { direction: 'UP', weight: 0.6, reason: 'UPTREND_DETECTED' };
    } else if (change < -0.05) {
      return { direction: 'DOWN', weight: 0.6, reason: 'DOWNTREND_DETECTED' };
    }
    
    return { direction: 'NEUTRAL', weight: 0.2, reason: 'NO_CLEAR_TREND' };
  }

  analyzePricePatterns(prices) {
    // Simple pattern detection (placeholder)
    return { 
      weight: 0.1, 
      reason: 'BASIC_PRICE_ACTION', 
      direction: prices[prices.length - 1] > prices[prices.length - 2] ? 'UP' : 'DOWN',
      patterns: []
    };
  }

  analyzeVolumeProfile(volumes, prices) {
    // Simple volume analysis
    const volumeIncreasing = this.isVolumeIncreasing(volumes);
    const priceIncreasing = prices[prices.length - 1] > prices[prices.length - 2];
    
    let direction = 'NEUTRAL';
    let weight = 0.1;
    let reason = 'NORMAL_VOLUME';
    
    if (volumeIncreasing && priceIncreasing) {
      direction = 'UP';
      weight = 0.4;
      reason = 'INCREASING_VOLUME_WITH_PRICE';
    } else if (volumeIncreasing && !priceIncreasing) {
      direction = 'DOWN';
      weight = 0.4;
      reason = 'INCREASING_VOLUME_WITH_PRICE_DROP';
    }
    
    return { direction, weight, reason };
  }

  checkDivergence(prices, indicator) {
    // Simple divergence check
    const priceChange = prices[prices.length - 1] - prices[0];
    const indicatorChange = indicator[indicator.length - 1] - indicator[0];
    
    // If price and indicator move in opposite directions, we have divergence
    if (priceChange > 0 && indicatorChange < 0) {
      return { hasDivergence: true, type: 'bearish' };
    } else if (priceChange < 0 && indicatorChange > 0) {
      return { hasDivergence: true, type: 'bullish' };
    }
    
    return { hasDivergence: false };
  }

  applySignalPersistenceFilter(token, signal) {
    const previousSignal = this.lastSignals.get(token);
    
    // If we have a previous signal that's recent, consider it
    if (previousSignal && Date.now() - previousSignal.timestamp < 3600000) {
      // If previous signal was strong, reduce weight of any contrary signal
      if (previousSignal.confidence > 0.7 && 
          previousSignal.type !== 'NONE' && 
          signal.type !== 'NONE' && 
          signal.type !== previousSignal.type) {
        
        signal.confidence *= 0.7; // Reduce confidence of contrary signals
        signal.reasons.push('CONTRARY_TO_RECENT_SIGNAL');
      }
      
      // If previous signal was very similar, boost confidence slightly
      if (previousSignal.type === signal.type && signal.type !== 'NONE') {
        signal.confidence = Math.min(1, signal.confidence * 1.1); // 10% boost up to max 1
        signal.reasons.push('REINFORCED_BY_PREVIOUS_SIGNAL');
      }
    }
    
    // Store the new signal
    if (signal.type !== 'NONE') {
      this.lastSignals.set(token, {
        type: signal.type,
        confidence: signal.confidence,
        timestamp: Date.now()
      });
    }
    
    return signal;
  }

  determineDirection(indicators) {
    // Count how many indicators are pointing in each direction
    let upCount = 0;
    let downCount = 0;
    
    // Check each indicator
    Object.values(indicators).forEach(indicator => {
      if (indicator && indicator.direction === 'UP') {
        upCount++;
      } else if (indicator && indicator.direction === 'DOWN') {
        downCount++;
      }
    });
    
    // Determine overall direction
    if (upCount > downCount) {
      return 'UP';
    } else if (downCount > upCount) {
      return 'DOWN';
    } else {
      // Check trend as tiebreaker
      return indicators.trend?.direction || 'NEUTRAL';
    }
  }

  trackSignal(token, signal) {
    // Only track concrete signals
    if (signal.type === 'NONE') return;
    
    this.performance.totalSignals++;
    
    // Add to signal history
    this.performance.signalHistory.push({
      token,
      timestamp: Date.now(),
      signal: { ...signal },
      outcome: 'PENDING' // To be updated later
    });
    
    // Limit history size
    if (this.performance.signalHistory.length > 100) {
      this.performance.signalHistory = this.performance.signalHistory.slice(-100);
    }
  }

  createNeutralSignal(reason, data = {}) {
    return {
      type: 'NONE',
      confidence: 0,
      reasons: [reason],
      ...data
    };
  }

  // Utility/calculation methods
  async calculateIndicators(prices, volumes) {
    // Get standard indicators
    const { rsi, macd, bb } = await technicalAnalysis.calculateIndicators(prices);
    
    return { rsi, macd, bb };
  }
}

export default TradingStrategy;