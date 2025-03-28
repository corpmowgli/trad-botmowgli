// strategies/enhancedMomentumStrategy.js
import { technicalAnalysis } from '../utils/indicators.js';

/**
 * Enhanced Momentum Trading Strategy
 * 
 * A comprehensive strategy that combines multiple technical indicators
 * and market conditions to generate high-confidence trading signals.
 */
export class EnhancedMomentumStrategy {
  /**
   * Create a new enhanced momentum strategy instance
   * @param {Object} config - Strategy configuration
   */
  constructor(config) {
    this.config = config;
    
    // Cache for previous signals to avoid signal flipping
    this.lastSignals = new Map();
    
    // Track strategy performance for self-optimization
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
    
    // Market condition filters
    this.marketFilters = {
      minLiquidity: config.trading.minLiquidity || 100000,
      minVolume24h: config.trading.minVolume24h || 50000,
      maxPriceVolatility: config.trading.maxPriceVolatility || 30,
      minMarketCap: config.trading.minMarketCap || 1000000
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
  async analyze(token, prices, volumes, marketData) {
    // Ensure we have enough data
    if (prices.length < 30 || volumes.length < 30) {
      return this.createNeutralSignal('INSUFFICIENT_DATA');
    }
    
    try {
      // Calculate technical indicators
      const indicators = await this.calculateIndicators(prices, volumes);
      
      // Analyze market metrics
      const marketMetrics = await this.analyzeMarketMetrics(token, marketData);
      
      // Initial neutral signal
      let signal = {
        type: 'NONE',
        confidence: 0,
        reasons: [],
        indicators: {},
        token
      };
      
      // Check if market conditions are suitable for trading
      if (!this.validateMarketConditions(marketMetrics)) {
        return this.createNeutralSignal('MARKET_CONDITIONS_UNFAVORABLE', {
          marketMetrics
        });
      }
      
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
      const macdSignal = this.analyzeMACD(indicators.macd, trend.direction);
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
        // Strong buy/sell signal
        const direction = this.determineDirection(signal.indicators);
        signal.type = direction === 'UP' ? 'BUY' : 'SELL';
        signal.strength = 'STRONG';
      } else if (signal.confidence >= this.signalThresholds.medium) {
        // Medium buy/sell signal
        const direction = this.determineDirection(signal.indicators);
        signal.type = direction === 'UP' ? 'BUY' : 'SELL';
        signal.strength = 'MEDIUM';
      } else if (signal.confidence >= this.signalThresholds.weak) {
        // Weak buy/sell signal
        const direction = this.determineDirection(signal.indicators);
        signal.type = direction === 'UP' ? 'BUY' : 'SELL';
        signal.strength = 'WEAK';
      }
      
      // Track the signal for performance analysis
      this.trackSignal(token, signal);
      
      return signal;
    } catch (error) {
      console.error(`Error analyzing ${token}:`, error);
      return this.createNeutralSignal('ANALYSIS_ERROR');
    }
  }

  /**
   * Calculate all technical indicators for analysis
   * @private
   * @param {Array<number>} prices - Price history data
   * @param {Array<number>} volumes - Volume history data
   * @returns {Object} Calculated indicators
   */
  async calculateIndicators(prices, volumes) {
    // Calculate standard indicators using the indicators utility
    const { rsi, macd, bb } = await technicalAnalysis.calculateIndicators(prices);
    
    // Calculate additional custom indicators
    const ema50 = await technicalAnalysis.calculateEMA(prices, 50);
    const ema200 = await technicalAnalysis.calculateEMA(prices, 200);
    
    // Calculate volume profile
    const volumeProfile = this.calculateVolumeProfile(volumes);
    
    return {
      rsi,
      macd,
      bb,
      ema50: ema50[ema50.length - 1],
      ema200: ema200[ema200.length - 1],
      volumeProfile
    };
  }

  /**
   * Analyze the overall trend based on price data
   * @private
   * @param {Array<number>} prices - Price history
   * @returns {Object} Trend analysis result
   */
  analyzeTrend(prices) {
    if (prices.length < 10) {
      return { 
        direction: 'NEUTRAL', 
        weight: 0, 
        reason: 'INSUFFICIENT_DATA_FOR_TREND' 
      };
    }
    
    // Calculate short, medium and long-term trends
    const shortTerm = this.calculateTrend(prices.slice(-10));
    const mediumTerm = this.calculateTrend(prices.slice(-30));
    const longTerm = this.calculateTrend(prices.slice(-50));
    
    // Get the most recent price
    const currentPrice = prices[prices.length - 1];
    
    // Calculate EMA50 and EMA200 for trend confirmation
    const ema50 = technicalAnalysis.calculateEMA(prices, 50);
    const ema200 = technicalAnalysis.calculateEMA(prices, 200);
    
    const lastEma50 = ema50[ema50.length - 1];
    const lastEma200 = ema200[ema200.length - 1];
    
    // Check for golden cross (EMA50 crosses above EMA200)
    const isGoldenCross = ema50[ema50.length - 2] <= ema200[ema200.length - 2] && 
                          lastEma50 > lastEma200;
                          
    // Check for death cross (EMA50 crosses below EMA200)
    const isDeathCross = ema50[ema50.length - 2] >= ema200[ema200.length - 2] && 
                         lastEma50 < lastEma200;
    
    // Determine overall trend based on multiple factors
    let direction = 'NEUTRAL';
    let weight = 0;
    let reason = 'NEUTRAL_TREND';
    
    if (shortTerm > 0 && mediumTerm > 0 && longTerm > 0) {
      // Strong uptrend
      direction = 'UP';
      weight = 0.8;
      reason = 'STRONG_UPTREND';
    } else if (shortTerm < 0 && mediumTerm < 0 && longTerm < 0) {
      // Strong downtrend
      direction = 'DOWN';
      weight = 0.8;
      reason = 'STRONG_DOWNTREND';
    } else if (shortTerm > 0 && mediumTerm > 0) {
      // Moderate uptrend
      direction = 'UP';
      weight = 0.6;
      reason = 'MODERATE_UPTREND';
    } else if (shortTerm < 0 && mediumTerm < 0) {
      // Moderate downtrend
      direction = 'DOWN';
      weight = 0.6;
      reason = 'MODERATE_DOWNTREND';
    } else if (shortTerm > 0 && (mediumTerm < 0 || longTerm < 0)) {
      // Potential trend reversal up
      direction = 'UP';
      weight = 0.4;
      reason = 'POTENTIAL_TREND_REVERSAL_UP';
    } else if (shortTerm < 0 && (mediumTerm > 0 || longTerm > 0)) {
      // Potential trend reversal down
      direction = 'DOWN';
      weight = 0.4;
      reason = 'POTENTIAL_TREND_REVERSAL_DOWN';
    }
    
    // Adjust for golden/death cross
    if (isGoldenCross) {
      direction = 'UP';
      weight = Math.max(weight, 0.7);
      reason = 'GOLDEN_CROSS';
    } else if (isDeathCross) {
      direction = 'DOWN';
      weight = Math.max(weight, 0.7);
      reason = 'DEATH_CROSS';
    }
    
    // Price above/below EMAs
    if (currentPrice > lastEma50 && currentPrice > lastEma200) {
      direction = 'UP';
      weight = Math.max(weight, 0.5);
      reason = direction === 'UP' ? reason : 'PRICE_ABOVE_EMAS';
    } else if (currentPrice < lastEma50 && currentPrice < lastEma200) {
      direction = 'DOWN';
      weight = Math.max(weight, 0.5);
      reason = direction === 'DOWN' ? reason : 'PRICE_BELOW_EMAS';
    }
    
    return {
      direction,
      weight,
      reason,
      shortTerm,
      mediumTerm,
      longTerm,
      ema50: lastEma50,
      ema200: lastEma200
    };
  }

  /**
   * Calculate the trend strength for a series of prices
   * @private
   * @param {Array<number>} prices - Price series
   * @returns {number} Trend strength (positive = up, negative = down)
   */
  calculateTrend(prices) {
    if (prices.length < 2) return 0;
    
    // Calculate linear regression slope
    const n = prices.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += prices[i];
      sumXY += i * prices[i];
      sumX2 += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // Normalize the slope relative to the average price
    const avgPrice = sumY / n;
    const normalizedSlope = (slope / avgPrice) * 100;
    
    return normalizedSlope;
  }

  /**
   * Analyze RSI indicator with divergence detection
   * @private
   * @param {Object} rsi - RSI indicator data
   * @param {Array<number>} prices - Price history data
   * @returns {Object} RSI signal analysis
   */
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
    if (rsi.values.length > 5 && prices.length > 5) {
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
   * Analyze MACD indicator
   * @private
   * @param {Object} macd - MACD indicator data
   * @param {string} trendDirection - Current price trend direction
   * @returns {Object} MACD signal analysis
   */
  analyzeMACD(macd, trendDirection) {
    const { macdLine, signalLine, histogram, lastHistogram, previousHistogram } = macd;
    
    let weight = 0;
    let reason = 'MACD_NEUTRAL';
    let direction = 'NEUTRAL';
    
    // Check for crossovers
    const currentCross = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];
    const previousCross = macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2];
    
    // Bullish crossover (MACD line crosses above signal line)
    if (previousCross < 0 && currentCross > 0) {
      weight = 0.7;
      reason = 'MACD_BULLISH_CROSSOVER';
      direction = 'UP';
    }
    // Bearish crossover (MACD line crosses below signal line)
    else if (previousCross > 0 && currentCross < 0) {
      weight = 0.7;
      reason = 'MACD_BEARISH_CROSSOVER';
      direction = 'DOWN';
    }
    // Strong bullish momentum (histogram increasing while positive)
    else if (histogram > 0 && histogram > previousHistogram) {
      weight = 0.5;
      reason = 'MACD_BULLISH_MOMENTUM';
      direction = 'UP';
    }
    // Strong bearish momentum (histogram decreasing while negative)
    else if (histogram < 0 && histogram < previousHistogram) {
      weight = 0.5;
      reason = 'MACD_BEARISH_MOMENTUM';
      direction = 'DOWN';
    }
    // Potential bullish reversal (histogram increasing but still negative)
    else if (histogram < 0 && histogram > previousHistogram) {
      weight = 0.3;
      reason = 'MACD_POTENTIAL_BULLISH_REVERSAL';
      direction = 'UP';
    }
    // Potential bearish reversal (histogram decreasing but still positive)
    else if (histogram > 0 && histogram < previousHistogram) {
      weight = 0.3;
      reason = 'MACD_POTENTIAL_BEARISH_REVERSAL';
      direction = 'DOWN';
    }
    
    // Increase weight if MACD aligns with the trend
    if (direction === 'UP' && trendDirection === 'UP') {
      weight *= 1.2; // 20% increase
    } else if (direction === 'DOWN' && trendDirection === 'DOWN') {
      weight *= 1.2; // 20% increase
    }
    
    return {
      currentValue: histogram,
      previousValue: previousHistogram,
      weight,
      reason,
      direction,
      isBullish: histogram > 0 && histogram > previousHistogram,
      isBearish: histogram < 0 && histogram < previousHistogram
    };
  }

  /**
   * Analyze Bollinger Bands
   * @private
   * @param {Array<number>} prices - Price history
   * @param {Object} bb - Bollinger Bands data
   * @returns {Object} Bollinger Bands signal analysis
   */
  analyzeBollingerBands(prices, bb) {
    const currentPrice = prices[prices.length - 1];
    const { upper, middle, lower } = bb;
    
    let weight = 0;
    let reason = 'BB_NEUTRAL';
    let direction = 'NEUTRAL';
    
    // Calculate bandwidth and %B
    const bandwidth = (upper - lower) / middle;
    const percentB = (currentPrice - lower) / (upper - lower);
    
    // Check for price near bands
    if (currentPrice <= lower) {
      // Price at or below lower band (potential buy)
      weight = 0.6;
      reason = 'PRICE_AT_LOWER_BAND';
      direction = 'UP';
    } else if (currentPrice >= upper) {
      // Price at or above upper band (potential sell)
      weight = 0.6;
      reason = 'PRICE_AT_UPPER_BAND';
      direction = 'DOWN';
    }
    // Look for squeeze (low bandwidth) which often precedes a big move
    else if (bandwidth < 0.1) {
      weight = 0.3;
      reason = 'BOLLINGER_SQUEEZE';
      // Direction is uncertain in a squeeze
      direction = 'NEUTRAL';
    }
    // Check for position within bands
    else if (percentB < 0.2) {
      // Price in lower 20% of band
      weight = 0.4;
      reason = 'PRICE_NEAR_LOWER_BAND';
      direction = 'UP';
    } else if (percentB > 0.8) {
      // Price in upper 20% of band
      weight = 0.4;
      reason = 'PRICE_NEAR_UPPER_BAND';
      direction = 'DOWN';
    } else if (percentB > 0.4 && percentB < 0.6) {
      // Price near middle band (often a period of indecision)
      weight = 0.2;
      reason = 'PRICE_NEAR_MIDDLE_BAND';
      direction = 'NEUTRAL';
    }
    
    return {
      currentPrice,
      upper,
      middle,
      lower,
      bandwidth,
      percentB,
      weight,
      reason,
      direction
    };
  }

  /**
   * Analyze price action patterns
   * @private
   * @param {Array<number>} prices - Price history
   * @returns {Object} Price action analysis
   */
  analyzePricePatterns(prices) {
    if (prices.length < 10) {
      return {
        weight: 0,
        reason: 'INSUFFICIENT_DATA_FOR_PATTERNS',
        direction: 'NEUTRAL',
        patterns: []
      };
    }
    
    const patterns = [];
    let weight = 0;
    let primaryReason = 'NO_PATTERN_DETECTED';
    let direction = 'NEUTRAL';
    
    // Get recent prices for pattern recognition
    const recentPrices = prices.slice(-10);
    
    // Check for double bottom pattern (W shape)
    if (this.isDoubleBottom(recentPrices)) {
      patterns.push('DOUBLE_BOTTOM');
      weight = Math.max(weight, 0.7);
      primaryReason = 'DOUBLE_BOTTOM_PATTERN';
      direction = 'UP';
    }
    
    // Check for double top pattern (M shape)
    if (this.isDoubleTop(recentPrices)) {
      patterns.push('DOUBLE_TOP');
      weight = Math.max(weight, 0.7);
      primaryReason = 'DOUBLE_TOP_PATTERN';
      direction = 'DOWN';
    }
    
    // Check for bullish engulfing pattern
    if (this.isBullishEngulfing(prices.slice(-2))) {
      patterns.push('BULLISH_ENGULFING');
      weight = Math.max(weight, 0.6);
      primaryReason = 'BULLISH_ENGULFING_PATTERN';
      direction = 'UP';
    }
    
    // Check for bearish engulfing pattern
    if (this.isBearishEngulfing(prices.slice(-2))) {
      patterns.push('BEARISH_ENGULFING');
      weight = Math.max(weight, 0.6);
      primaryReason = 'BEARISH_ENGULFING_PATTERN';
      direction = 'DOWN';
    }
    
    // Check for breakouts from consolidation periods
    const breakout = this.detectBreakout(prices);
    if (breakout.detected) {
      patterns.push(breakout.type);
      weight = Math.max(weight, 0.65);
      primaryReason = breakout.type;
      direction = breakout.type === 'BULLISH_BREAKOUT' ? 'UP' : 'DOWN';
    }
    
    return {
      weight,
      reason: primaryReason,
      direction,
      patterns
    };
  }

  /**
   * Analyze volume profile
   * @private
   * @param {Array<number>} volumes - Volume history
   * @param {Array<number>} prices - Price history
   * @returns {Object} Volume analysis
   */
  analyzeVolumeProfile(volumes, prices) {
    if (volumes.length < 10 || prices.length < 10) {
      return {
        weight: 0,
        reason: 'INSUFFICIENT_VOLUME_DATA',
        direction: 'NEUTRAL'
      };
    }
    
    const recentVolumes = volumes.slice(-this.config.indicators.volumeProfile.lookback);
    const recentPrices = prices.slice(-this.config.indicators.volumeProfile.lookback);
    
    // Calculate average volume
    const avgVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
    
    // Get most recent volume and price changes
    const currentVolume = recentVolumes[recentVolumes.length - 1];
    const volumeChange = currentVolume / avgVolume;
    
    // Calculate price direction
    const priceChange = (recentPrices[recentPrices.length - 1] - recentPrices[recentPrices.length - 2]) / 
                       recentPrices[recentPrices.length - 2];
    
    let weight = 0;
    let reason = 'NORMAL_VOLUME';
    let direction = 'NEUTRAL';
    
    // High volume with price increase = strong bullish signal
    if (volumeChange > this.config.indicators.volumeProfile.threshold && priceChange > 0) {
      weight = 0.7;
      reason = 'STRONG_VOLUME_WITH_PRICE_INCREASE';
      direction = 'UP';
    } 
    // High volume with price decrease = strong bearish signal
    else if (volumeChange > this.config.indicators.volumeProfile.threshold && priceChange < 0) {
      weight = 0.7;
      reason = 'STRONG_VOLUME_WITH_PRICE_DECREASE';
      direction = 'DOWN';
    }
    // Increasing volume trend
    else if (this.isVolumeIncreasing(recentVolumes)) {
      weight = 0.4;
      reason = 'INCREASING_VOLUME_TREND';
      // Direction depends on price action
      direction = priceChange > 0 ? 'UP' : 'DOWN';
    }
    // Low volume pullback (often a good entry in an uptrend)
    else if (volumeChange < 0.7 && priceChange < 0 && this.isUptrend(recentPrices)) {
      weight = 0.5;
      reason = 'LOW_VOLUME_PULLBACK_IN_UPTREND';
      direction = 'UP';
    }
    // Low volume bounce (often a good exit in a downtrend)
    else if (volumeChange < 0.7 && priceChange > 0 && this.isDowntrend(recentPrices)) {
      weight = 0.5;
      reason = 'LOW_VOLUME_BOUNCE_IN_DOWNTREND';
      direction = 'DOWN';
    }
    
    return {
      currentVolume,
      avgVolume,
      volumeChange,
      priceChange,
      weight,
      reason,
      direction
    };
  }

  /**
   * Check if volume is in an increasing trend
   * @private
   * @param {Array<number>} volumes - Volume history
   * @returns {boolean} True if volume is increasing
   */
  isVolumeIncreasing(volumes) {
    if (volumes.length < 5) return false;
    
    // Compare average of last 3 days with average of previous 3 days
    const recent = volumes.slice(-3).reduce((sum, vol) => sum + vol, 0) / 3;
    const previous = volumes.slice(-6, -3).reduce((sum, vol) => sum + vol, 0) / 3;
    
    return recent > previous * 1.2; // 20% increase
  }

  /**
   * Check for divergence between price and indicator
   * @private
   * @param {Array<number>} prices - Price history
   * @param {Array<number>} indicator - Indicator values
   * @returns {Object} Divergence analysis
   */
  checkDivergence(prices, indicator) {
    // Need at least a few points to detect divergence
    if (prices.length < 4 || indicator.length < 4) {
      return { hasDivergence: false };
    }
    
    // Find local extrema in prices
    const priceExtrema = this.findLocalExtrema(prices);
    
    // Find local extrema in indicator
    const indicatorExtrema = this.findLocalExtrema(indicator);
    
    // Check for bullish divergence: lower lows in price, but higher lows in indicator
    if (priceExtrema.minIndex > 0 && indicatorExtrema.minIndex > 0) {
      const priceDecreasing = prices[priceExtrema.minIndex] < prices[0];
      const indicatorIncreasing = indicator[indicatorExtrema.minIndex] > indicator[0];
      
      if (priceDecreasing && indicatorIncreasing) {
        return {
          hasDivergence: true,
          type: 'bullish',
          priceExtrema,
          indicatorExtrema
        };
      }
    }
    
    // Check for bearish divergence: higher highs in price, but lower highs in indicator
    if (priceExtrema.maxIndex > 0 && indicatorExtrema.maxIndex > 0) {
      const priceIncreasing = prices[priceExtrema.maxIndex] > prices[0];
      const indicatorDecreasing = indicator[indicatorExtrema.maxIndex] < indicator[0];
      
      if (priceIncreasing && indicatorDecreasing) {
        return {
          hasDivergence: true,
          type: 'bearish',
          priceExtrema,
          indicatorExtrema
        };
      }
    }
    
    return { hasDivergence: false };
  }

  /**
   * Find local minimum and maximum in a data series
   * @private
   * @param {Array<number>} data - Data series
   * @returns {Object} Indices and values of min/max
   */
  findLocalExtrema(data) {
    if (data.length < 3) {
      return {
        minIndex: data.indexOf(Math.min(...data)),
        maxIndex: data.indexOf(Math.max(...data)),
        minValue: Math.min(...data),
        maxValue: Math.max(...data)
      };
    }
    
    let minIndex = 0;
    let maxIndex = 0;
    let minValue = data[0];
    let maxValue = data[0];
    
    // Skip the endpoints to find true local extrema
    for (let i = 1; i < data.length - 1; i++) {
      // Local minimum: less than both neighbors
      if (data[i] < data[i-1] && data[i] < data[i+1] && data[i] < minValue) {
        minIndex = i;
        minValue = data[i];
      }
      
      // Local maximum: greater than both neighbors
      if (data[i] > data[i-1] && data[i] > data[i+1] && data[i] > maxValue) {
        maxIndex = i;
        maxValue = data[i];
      }
    }
    
    // If no local extrema found, just find global min/max
    if (minIndex === 0 && maxIndex === 0) {
      minIndex = data.indexOf(Math.min(...data));
      maxIndex = data.indexOf(Math.max(...data));
      minValue = data[minIndex];
      maxValue = data[maxIndex];
    }
    
    return {
      minIndex,
      maxIndex,
      minValue,
      maxValue
    };
  }

  /**
   * Check if prices are in an uptrend
   * @private
   * @param {Array<number>} prices - Price history
   * @returns {boolean} True if in uptrend
   */
  isUptrend(prices) {
    if (prices.length < 5) return false;
    
    // Simple check if closing price is above moving average
    const sum = prices.reduce((total, price) => total + price, 0);
    const avg = sum / prices.length;
    
    return prices[prices.length - 1] > avg;
  }

  /**
   * Check if prices are in a downtrend
   * @private
   * @param {Array<number>} prices - Price history
   * @returns {boolean} True if in downtrend
   */
  isDowntrend(prices) {
    if (prices.length < 5) return false;
    
    // Simple check if closing price is below moving average
    const sum = prices.reduce((total, price) => total + price, 0);
    const avg = sum / prices.length;
    
    return prices[prices.length - 1] < avg;
  }

  /**
   * Check for double bottom pattern
   * @private
   * @param {Array<number>} prices - Price history
   * @returns {boolean} True if double bottom detected
   */
  isDoubleBottom(prices) {
    if (prices.length < 7) return false;
    
    // Find local minima in the sequence
    const minima = [];
    for (let i = 1; i < prices.length - 1; i++) {
      if (prices[i] < prices[i-1] && prices[i] < prices[i+1]) {
        minima.push({ index: i, value: prices[i] });
      }
    }
    
    // Need at least 2 minima for a double bottom
    if (minima.length < 2) return false;
    
    // For simplicity, check the last 2 minima
    const last = minima[minima.length - 1];
    const prev = minima[minima.length - 2];
    
    // Check if they're at similar levels (within 2%) and spaced apart
    const similarLevel = Math.abs(last.value - prev.value) / prev.value < 0.02;
    const sufficientSpacing = last.index - prev.index >= 3;
    
    // Check if price rebounded after the second bottom
    const rebound = prices[prices.length - 1] > last.value * 1.03; // 3% rebound
    
    return similarLevel && sufficientSpacing && rebound;
  }

  /**
   * Check for double top pattern
   * @private
   * @param {Array<number>} prices - Price history
   * @returns {boolean} True if double top detected
   */
  isDoubleTop(prices) {
    if (prices.length < 7) return false;
    
    // Find local maxima in the sequence
    const maxima = [];
    for (let i = 1; i < prices.length - 1; i++) {
      if (prices[i] > prices[i-1] && prices[i] > prices[i+1]) {
        maxima.push({ index: i, value: prices[i] });
      }
    }
    
    // Need at least 2 maxima for a double top
    if (maxima.length < 2) return false;
    
    // For simplicity, check the last 2 maxima
    const last = maxima[maxima.length - 1];
    const prev = maxima[maxima.length - 2];
    
    // Check if they're at similar levels (within 2%) and spaced apart
    const similarLevel = Math.abs(last.value - prev.value) / prev.value < 0.02;
    const sufficientSpacing = last.index - prev.index >= 3;
    
    // Check if price dropped after the second top
    const drop = prices[prices.length - 1] < last.value * 0.97; // 3% drop
    
    return similarLevel && sufficientSpacing && drop;
  }

  /**
   * Check for bullish engulfing pattern
   * @private
   * @param {Array<number>} prices - Two day price history [previous, current]
   * @returns {boolean} True if bullish engulfing detected
   */
  isBullishEngulfing(prices) {
    if (prices.length !== 2) return false;
    
    // For this simplified example, we're just using close prices
    // A real implementation would use OHLC data
    const [prev, current] = prices;
    
    // Simplified check: current day has a much larger positive move than previous negative move
    return prev < current && (current - prev) > Math.abs(prev - prices[0]) * 1.5;
  }

  /**
   * Check for bearish engulfing pattern
   * @private
   * @param {Array<number>} prices - Two day price history [previous, current]
   * @returns {boolean} True if bearish engulfing detected
   */
  isBearishEngulfing(prices) {
    if (prices.length !== 2) return false;
    
    // For this simplified example, we're just using close prices
    // A real implementation would use OHLC data
    const [prev, current] = prices;
    
    // Simplified check: current day has a much larger negative move than previous positive move
    return prev > current && (prev - current) > Math.abs(prev - prices[0]) * 1.5;
  }

  /**
   * Detect price breakouts from consolidation periods
   * @private
   * @param {Array<number>} prices - Price history
   * @returns {Object} Breakout information
   */
  detectBreakout(prices) {
    if (prices.length < 10) return { detected: false };
    
    // Look for a tight price range followed by a breakout
    const recentPrices = prices.slice(-10);
    
    // Calculate average price and standard deviation for the first 7 candles
    const consolidationPrices = recentPrices.slice(0, 7);
    const avg = consolidationPrices.reduce((sum, price) => sum + price, 0) / consolidationPrices.length;
    
    const variance = consolidationPrices.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / consolidationPrices.length;
    const stdDev = Math.sqrt(variance);
    
    // Check if the range was tight (low volatility)
    const isConsolidation = stdDev / avg < 0.02; // Less than 2% standard deviation relative to price
    
    if (!isConsolidation) return { detected: false };
    
    // Check for breakout in the last 3 candles
    const breakoutPrices = recentPrices.slice(-3);
    const latestPrice = breakoutPrices[breakoutPrices.length - 1];
    
    // Breakout thresholds
    const upperThreshold = avg + 2 * stdDev;
    const lowerThreshold = avg - 2 * stdDev;
    
    if (latestPrice > upperThreshold) {
      return {
        detected: true,
        type: 'BULLISH_BREAKOUT',
        threshold: upperThreshold,
        price: latestPrice,
        percentage: (latestPrice - upperThreshold) / upperThreshold * 100
      };
    } else if (latestPrice < lowerThreshold) {
      return {
        detected: true,
        type: 'BEARISH_BREAKOUT',
        threshold: lowerThreshold,
        price: latestPrice,
        percentage: (lowerThreshold - latestPrice) / lowerThreshold * 100
      };
    }
    
    return { detected: false };
  }

  /**
   * Analyze market metrics to ensure they meet trading criteria
   * @private
   * @param {string} token - Token identifier
   * @param {Object} marketData - Market data
   * @returns {Object} Market metrics analysis
   */
  async analyzeMarketMetrics(token, marketData) {
    const metrics = {
      token,
      timestamp: Date.now(),
      liquidity: marketData?.liquidity || 0,
      volume24h: marketData?.volume24h || 0,
      priceChange24h: marketData?.priceChange24h || 0,
      marketCap: marketData?.marketCap || 0,
      meetsMinimumRequirements: false
    };
    
    // Check if metrics meet minimum requirements
    metrics.meetsMinimumRequirements = this.validateMarketConditions(metrics);
    
    return metrics;
  }

  /**
   * Validate that market conditions meet minimum requirements
   * @private
   * @param {Object} metrics - Market metrics
   * @returns {boolean} True if conditions are valid for trading
   */
  validateMarketConditions(metrics) {
    return metrics.liquidity >= this.marketFilters.minLiquidity &&
           metrics.volume24h >= this.marketFilters.minVolume24h &&
           Math.abs(metrics.priceChange24h) <= this.marketFilters.maxPriceVolatility &&
           metrics.marketCap >= this.marketFilters.minMarketCap;
  }

  /**
   * Apply signal persistence filter to avoid frequent signal changes
   * @private
   * @param {string} token - Token identifier
   * @param {Object} signal - Current signal
   * @returns {Object} Filtered signal
   */
  applySignalPersistenceFilter(token, signal) {
    const previousSignal = this.lastSignals.get(token);
    
    // If we have a previous signal that's recent (<1 hour old)
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

  /**
   * Determine overall signal direction based on indicators
   * @private
   * @param {Object} indicators - Analyzed indicators
   * @returns {string} Signal direction ('UP', 'DOWN', or 'NEUTRAL')
   */
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

  /**
   * Create a neutral signal
   * @private
   * @param {string} reason - Reason for neutral signal
   * @param {Object} [data={}] - Additional data
   * @returns {Object} Neutral signal
   */
  createNeutralSignal(reason, data = {}) {
    return {
      type: 'NONE',
      confidence: 0,
      reasons: [reason],
      ...data
    };
  }

  /**
   * Track signal for performance analysis
   * @private
   * @param {string} token - Token identifier
   * @param {Object} signal - Generated signal
   */
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

  /**
   * Update signal outcome
   * @param {string} token - Token identifier
   * @param {string} outcome - Signal outcome ('CORRECT', 'INCORRECT')
   * @param {number} profit - Realized profit/loss
   */
  updateSignalOutcome(token, outcome, profit) {
    // Find the most recent signal for this token
    const signalIndex = this.performance.signalHistory.findIndex(
      item => item.token === token && item.outcome === 'PENDING'
    );
    
    if (signalIndex === -1) return;
    
    // Update the signal outcome
    this.performance.signalHistory[signalIndex].outcome = outcome;
    this.performance.signalHistory[signalIndex].profit = profit;
    this.performance.signalHistory[signalIndex].closedAt = Date.now();
    
    // Update performance metrics
    if (outcome === 'CORRECT') {
      this.performance.correctSignals++;
      if (profit > 0) {
        this.performance.profitableTokens.add(token);
      }
    } else if (outcome === 'INCORRECT') {
      this.performance.falsePositives++;
    }
  }

  /**
   * Get strategy performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    const accuracy = this.performance.totalSignals > 0
      ? (this.performance.correctSignals / this.performance.totalSignals) * 100
      : 0;
    
    return {
      totalSignals: this.performance.totalSignals,
      correctSignals: this.performance.correctSignals,
      falsePositives: this.performance.falsePositives,
      accuracy,
      profitableTokens: Array.from(this.performance.profitableTokens),
      recentSignals: this.performance.signalHistory.slice(-10)
    };
  }

  /**
   * Calculate volume profile
   * @private
   * @param {Array<number>} volumes - Volume history
   * @returns {Object} Volume profile metrics
   */
  calculateVolumeProfile(volumes) {
    const lookback = this.config.indicators.volumeProfile.lookback || 24;
    const recentVolumes = volumes.slice(-lookback);
    
    // Calculate average volume
    const avgVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
    
    // Calculate volume variance
    const variance = recentVolumes.reduce((sum, vol) => sum + Math.pow(vol - avgVolume, 2), 0) / recentVolumes.length;
    const stdDev = Math.sqrt(variance);
    const varianceRatio = stdDev / avgVolume;
    
    // Detect volume spikes (more than 2 standard deviations from mean)
    const spikes = recentVolumes.filter(vol => vol > avgVolume + 2 * stdDev).length;
    
    // Check for volume trend
    const firstHalf = recentVolumes.slice(0, Math.floor(recentVolumes.length / 2));
    const secondHalf = recentVolumes.slice(Math.floor(recentVolumes.length / 2));
    
    const firstHalfAvg = firstHalf.reduce((sum, vol) => sum + vol, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, vol) => sum + vol, 0) / secondHalf.length;
    
    const volumeTrend = secondHalfAvg / firstHalfAvg;
    
    return {
      averageVolume: avgVolume,
      volumeVariance: varianceRatio,
      volumeSpikes: spikes,
      volumeTrend: volumeTrend,
      increasing: volumeTrend > 1.1, // 10% increase
      decreasing: volumeTrend < 0.9, // 10% decrease
      stable: volumeTrend >= 0.9 && volumeTrend <= 1.1,
      volatility: varianceRatio
    };
  }
}

export default EnhancedMomentumStrategy;