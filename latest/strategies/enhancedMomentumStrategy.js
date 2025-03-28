// strategies/enhancedMomentumStrategy.js
import { BaseStrategy } from './BaseStrategy.js';
import { technicalAnalysis } from '../utils/indicators.js';
import { isValidTechnicalData, isValidMarketData } from '../utils/validation.js';

/**
 * Enhanced Momentum Strategy
 * Improved version of the basic momentum strategy with additional
 * technical indicators and advanced signal filtering
 */
export class EnhancedMomentumStrategy extends BaseStrategy {
  /**
   * Creates a new instance of EnhancedMomentumStrategy
   * @param {Object} config - Configuration for the strategy
   */
  constructor(config) {
    super(config);
    
    // Additional configuration specific to Enhanced Momentum
    this.volumeThreshold = config.indicators?.volumeProfile?.threshold || 1.2;
    this.priceTrendWeight = 0.3;  // Weight for price trend signals
    this.volumeTrendWeight = 0.2; // Weight for volume trend signals
    this.indicatorWeight = 0.5;   // Weight for technical indicators
    
    // Store previous signals for divergence detection
    this.previousSignals = new Map();
  }

  /**
   * Main analyze method - generates trading signals
   * @override
   * @param {string} token - Token identifier
   * @param {Array<number>} prices - Historical price data
   * @param {Array<number>} volumes - Historical volume data
   * @param {Object} marketData - Additional market data
   * @returns {Promise<Object>} Trading signal
   */
  async analyze(token, prices, volumes, marketData) {
    // Validate input data
    if (!this.validateInputData(token, prices, volumes)) {
      return this.createSignal(
        'NONE',
        0,
        ['INVALID_INPUT_DATA'],
        { error: 'Insufficient or invalid data for analysis' }
      );
    }
    
    // Validate market conditions
    if (!this.validateMarketConditions(marketData)) {
      return this.createSignal(
        'NONE',
        0,
        ['MARKET_CONDITIONS_NOT_MET'],
        { marketData }
      );
    }
    
    try {
      // Calculate technical indicators
      const indicators = await this.calculateIndicators(prices);
      
      // Analyze price trend
      const trend = this.analyzeTrend(prices);
      
      // Analyze volume profile
      const volumeProfile = this.analyzeVolumeProfile(volumes, prices);
      
      // Generate composite signal
      const signal = await this.generateSignal(token, prices, indicators, trend, volumeProfile, marketData);
      
      // Apply persistence filter to reduce signal noise
      const filteredSignal = this.applySignalPersistenceFilter(token, signal);
      
      // Track signal for performance metrics
      this.trackSignal(token, filteredSignal);
      
      return filteredSignal;
    } catch (error) {
      console.error(`Error analyzing token ${token}:`, error);
      return this.createSignal(
        'NONE',
        0,
        ['ANALYSIS_ERROR'],
        { error: error.message }
      );
    }
  }

  /**
   * Validates market conditions for trading
   * @private
   * @param {Object} marketData - Market data to validate
   * @returns {boolean} Whether market conditions are acceptable
   */
  validateMarketConditions(marketData) {
    if (!isValidMarketData(marketData)) {
      return false;
    }
    
    // Check for minimum liquidity and volume requirements
    const minLiquidity = this.config.trading?.minLiquidity || 100000;
    const minVolume = this.config.trading?.minVolume24h || 50000;
    
    if (marketData.liquidity < minLiquidity || marketData.volume24h < minVolume) {
      return false;
    }
    
    // Avoid extreme price movements (potential pump & dump)
    if (Math.abs(marketData.priceChange24h) > 30) {
      return false;
    }
    
    return true;
  }

  /**
   * Generates a trading signal based on all available indicators
   * @private
   * @param {string} token - Token identifier
   * @param {Array<number>} prices - Historical price data
   * @param {Object} indicators - Technical indicators
   * @param {Object} trend - Trend analysis results
   * @param {Object} volumeProfile - Volume profile analysis
   * @param {Object} marketData - Additional market data
   * @returns {Object} Trading signal
   */
  async generateSignal(token, prices, indicators, trend, volumeProfile, marketData) {
    // Store components of signal confidence
    let buySignals = [];
    let sellSignals = [];
    let neutralSignals = [];
    
    // Analyze RSI conditions
    const rsiSignal = this.analyzeRSI(indicators.rsi, prices);
    if (rsiSignal.type === 'BUY') buySignals.push({ weight: rsiSignal.weight, reason: rsiSignal.reason });
    else if (rsiSignal.type === 'SELL') sellSignals.push({ weight: rsiSignal.weight, reason: rsiSignal.reason });
    else neutralSignals.push({ weight: 0.1, reason: rsiSignal.reason });
    
    // Analyze MACD conditions
    const macdSignal = this.analyzeMACD(indicators.macd, trend.direction);
    if (macdSignal.type === 'BUY') buySignals.push({ weight: macdSignal.weight, reason: macdSignal.reason });
    else if (macdSignal.type === 'SELL') sellSignals.push({ weight: macdSignal.weight, reason: macdSignal.reason });
    else neutralSignals.push({ weight: 0.1, reason: macdSignal.reason });
    
    // Analyze Bollinger Bands
    const bbSignal = this.analyzeBollingerBands(indicators.bb, prices);
    if (bbSignal.type === 'BUY') buySignals.push({ weight: bbSignal.weight, reason: bbSignal.reason });
    else if (bbSignal.type === 'SELL') sellSignals.push({ weight: bbSignal.weight, reason: bbSignal.reason });
    else neutralSignals.push({ weight: 0.1, reason: bbSignal.reason });
    
    // Analyze trend strength
    if (trend.direction === 'UP' && trend.strength > 0.3) {
      buySignals.push({ weight: trend.strength * this.priceTrendWeight, reason: `STRONG_UPTREND: ${trend.description}` });
    } else if (trend.direction === 'DOWN' && trend.strength > 0.3) {
      sellSignals.push({ weight: trend.strength * this.priceTrendWeight, reason: `STRONG_DOWNTREND: ${trend.description}` });
    } else {
      neutralSignals.push({ weight: 0.2, reason: 'NO_CLEAR_TREND_DIRECTION' });
    }
    
    // Analyze volume profile
    if (volumeProfile.increasing && volumeProfile.volumeRatio > this.volumeThreshold) {
      // Rising volume is bullish if price is also rising
      if (trend.direction === 'UP') {
        buySignals.push({ 
          weight: volumeProfile.strength * this.volumeTrendWeight, 
          reason: 'INCREASING_VOLUME_WITH_PRICE' 
        });
      } else if (trend.direction === 'DOWN') {
        // Rising volume with falling price can indicate capitulation
        sellSignals.push({ 
          weight: volumeProfile.strength * this.volumeTrendWeight, 
          reason: 'INCREASING_VOLUME_WITH_PRICE_DROP' 
        });
      }
    } else if (volumeProfile.volumeRatio < 0.7) {
      // Low volume generally indicates less conviction
      neutralSignals.push({ weight: 0.1, reason: 'LOW_TRADING_VOLUME' });
    }
    
    // Analyze support & resistance levels
    const srSignal = this.analyzeSupportResistance(indicators.supportResistance, prices[prices.length - 1]);
    if (srSignal.type === 'BUY') buySignals.push({ weight: srSignal.weight, reason: srSignal.reason });
    else if (srSignal.type === 'SELL') sellSignals.push({ weight: srSignal.weight, reason: srSignal.reason });
    
    // Check market metrics for additional confirmation
    if (marketData.priceChange24h > 5) {
      buySignals.push({ weight: 0.1, reason: 'POSITIVE_24H_PRICE_CHANGE' });
    } else if (marketData.priceChange24h < -5) {
      sellSignals.push({ weight: 0.1, reason: 'NEGATIVE_24H_PRICE_CHANGE' });
    }
    
    // Check for indicator divergences (price moving opposite to indicator)
    const divergenceSignal = this.checkForDivergences(prices, indicators);
    if (divergenceSignal.type === 'BUY') buySignals.push({ weight: divergenceSignal.weight, reason: divergenceSignal.reason });
    else if (divergenceSignal.type === 'SELL') sellSignals.push({ weight: divergenceSignal.weight, reason: divergenceSignal.reason });
    
    // Calculate final confidence scores
    const buyConfidence = buySignals.reduce((sum, signal) => sum + signal.weight, 0);
    const sellConfidence = sellSignals.reduce((sum, signal) => sum + signal.weight, 0);
    
    // Determine signal type based on confidence scores
    let signalType = 'NONE';
    let confidence = 0;
    let reasons = [];
    
    const minConfidenceThreshold = this.config.trading?.minConfidenceThreshold || 0.6;
    
    if (buyConfidence > sellConfidence && buyConfidence >= minConfidenceThreshold) {
      signalType = 'BUY';
      confidence = buyConfidence;
      reasons = buySignals.map(s => s.reason);
    } else if (sellConfidence > buyConfidence && sellConfidence >= minConfidenceThreshold) {
      signalType = 'SELL';
      confidence = sellConfidence;
      reasons = sellSignals.map(s => s.reason);
    } else {
      reasons = neutralSignals.map(s => s.reason);
      // If there are more buy signals but below threshold, mark as weak buy
      if (buyConfidence > sellConfidence) {
        reasons.unshift('WEAK_BUY_SIGNAL');
        confidence = buyConfidence;
      } 
      // If there are more sell signals but below threshold, mark as weak sell
      else if (sellConfidence > buyConfidence) {
        reasons.unshift('WEAK_SELL_SIGNAL');
        confidence = sellConfidence;
      }
      // Otherwise truly neutral
      else {
        reasons.unshift('NO_CLEAR_SIGNAL');
        confidence = Math.max(buyConfidence, sellConfidence);
      }
    }
    
    // Store the signal data for future reference (for divergence detection)
    this.storePreviousSignal(token, {
      price: prices[prices.length - 1],
      rsi: indicators.rsi,
      macd: indicators.macd.lastHistogram,
      timestamp: Date.now()
    });
    
    return this.createSignal(signalType, confidence, reasons, {
      trend,
      volumeProfile,
      rsi: indicators.rsi,
      macd: indicators.macd,
      bb: indicators.bb
    });
  }

  /**
   * Analyzes RSI for trading signals
   * @private
   * @param {Object} rsi - RSI indicator data
   * @param {Array<number>} prices - Historical price data
   * @returns {Object} RSI signal
   */
  analyzeRSI(rsi, prices) {
    const rsiValue = rsi;
    const oversold = this.indicatorConfig.rsi.oversold;
    const overbought = this.indicatorConfig.rsi.overbought;
    
    // Check for oversold condition (bullish)
    if (rsiValue <= oversold) {
      return {
        type: 'BUY',
        weight: 0.7,
        reason: `OVERSOLD_RSI: ${rsiValue.toFixed(2)}`
      };
    }
    // Check for overbought condition (bearish)
    else if (rsiValue >= overbought) {
      return {
        type: 'SELL',
        weight: 0.7,
        reason: `OVERBOUGHT_RSI: ${rsiValue.toFixed(2)}`
      };
    }
    
    // No strong signal
    return {
      type: 'NONE',
      weight: 0,
      reason: `NEUTRAL_RSI: ${rsiValue.toFixed(2)}`
    };
  }

  /**
   * Analyzes Bollinger Bands for trading signals
   * @private
   * @param {Object} bb - Bollinger Bands data
   * @param {Array<number>} prices - Historical price data
   * @returns {Object} Bollinger Bands signal
   */
  analyzeBollingerBands(bb, prices) {
    const currentPrice = prices[prices.length - 1];
    
    // Price below lower band (potential buy)
    if (currentPrice < bb.lower) {
      return {
        type: 'BUY',
        weight: 0.6,
        reason: 'PRICE_BELOW_LOWER_BAND'
      };
    }
    // Price above upper band (potential sell)
    else if (currentPrice > bb.upper) {
      return {
        type: 'SELL',
        weight: 0.6,
        reason: 'PRICE_ABOVE_UPPER_BAND'
      };
    }
    // Price approaching upper band with momentum
    else if (currentPrice > bb.middle && 
            (bb.upper - currentPrice) / (bb.upper - bb.middle) < 0.2) {
      return {
        type: 'SELL',
        weight: 0.3,
        reason: 'PRICE_APPROACHING_UPPER_BAND'
      };
    }
    // Price approaching lower band with momentum
    else if (currentPrice < bb.middle && 
            (currentPrice - bb.lower) / (bb.middle - bb.lower) < 0.2) {
      return {
        type: 'BUY',
        weight: 0.3,
        reason: 'PRICE_APPROACHING_LOWER_BAND'
      };
    }
    
    // No strong signal
    return {
      type: 'NONE',
      weight: 0,
      reason: 'PRICE_WITHIN_BANDS'
    };
  }

  /**
   * Analyzes support and resistance levels
   * @private
   * @param {Object} supportResistance - Support and resistance data
   * @param {number} currentPrice - Current price
   * @returns {Object} Support/resistance signal
   */
  analyzeSupportResistance(supportResistance, currentPrice) {
    if (!supportResistance) {
      return { type: 'NONE', weight: 0, reason: 'NO_SUPPORT_RESISTANCE_DATA' };
    }
    
    const { closestSupport, closestResistance } = supportResistance;
    
    // If no support or resistance levels found
    if (!closestSupport && !closestResistance) {
      return { type: 'NONE', weight: 0, reason: 'NO_SIGNIFICANT_LEVELS' };
    }
    
    // Check if price is near support level (potential buy)
    if (closestSupport) {
      const supportDelta = (currentPrice - closestSupport.price) / currentPrice;
      
      if (supportDelta < 0.02 && supportDelta >= 0) {
        return {
          type: 'BUY',
          weight: 0.5 * closestSupport.strength,
          reason: 'PRICE_AT_SUPPORT'
        };
      }
    }
    
    // Check if price is near resistance level (potential sell)
    if (closestResistance) {
      const resistanceDelta = (closestResistance.price - currentPrice) / currentPrice;
      
      if (resistanceDelta < 0.02 && resistanceDelta >= 0) {
        return {
          type: 'SELL',
          weight: 0.5 * closestResistance.strength,
          reason: 'PRICE_AT_RESISTANCE'
        };
      }
    }
    
    return { type: 'NONE', weight: 0, reason: 'NO_NEAR_SUPPORT_RESISTANCE' };
  }

  /**
   * Check for divergences between price and indicators
   * @private
   * @param {Array<number>} prices - Historical price data
   * @param {Object} indicators - Technical indicators
   * @returns {Object} Divergence signal
   */
  checkForDivergences(prices, indicators) {
    // No previous data to compare with
    if (prices.length < 10) {
      return { type: 'NONE', weight: 0, reason: 'INSUFFICIENT_DATA_FOR_DIVERGENCE' };
    }
    
    // Get price changes
    const currentPrice = prices[prices.length - 1];
    const prevPrice = prices[prices.length - 10];
    const priceChange = (currentPrice - prevPrice) / prevPrice;
    
    // Get RSI changes
    const rsiValue = indicators.rsi;
    const rsiChange = indicators.rsi - this.indicatorConfig.rsi.period; // Simplified
    
    // Check for bullish RSI divergence (price making lower lows but RSI making higher lows)
    if (priceChange < -0.05 && rsiChange > 0) {
      return {
        type: 'BUY',
        weight: 0.7,
        reason: 'BULLISH_RSI_DIVERGENCE'
      };
    }
    
    // Check for bearish RSI divergence (price making higher highs but RSI making lower highs)
    if (priceChange > 0.05 && rsiChange < 0) {
      return {
        type: 'SELL',
        weight: 0.7,
        reason: 'BEARISH_RSI_DIVERGENCE'
      };
    }
    
    return { type: 'NONE', weight: 0, reason: 'NO_DIVERGENCE_DETECTED' };
  }

  /**
   * Store signal data for future reference
   * @private
   * @param {string} token - Token identifier
   * @param {Object} signalData - Signal data to store
   */
  storePreviousSignal(token, signalData) {
    this.previousSignals.set(token, signalData);
    
    // Cleanup old signals - keep only last 100
    if (this.previousSignals.size > 100) {
      const oldestKey = this.previousSignals.keys().next().value;
      this.previousSignals.delete(oldestKey);
    }
  }

  /**
   * Analyzes MACD for trading signals
   * @private
   * @param {Object} macd - MACD indicator data
   * @param {string} trendDirection - Current price trend direction
   * @returns {Object} MACD signal
   */
  analyzeMACD(macd, trendDirection) {
    // Get the last and previous histogram values
    const lastHistogram = macd.lastHistogram;
    const prevHistogram = macd.previousHistogram;
    
    // MACD line has crossed above signal line (bullish)
    if (prevHistogram < 0 && lastHistogram > 0) {
      // Stronger signal if aligned with trend
      const weight = trendDirection === 'UP' ? 0.8 : 0.6;
      return {
        type: 'BUY',
        weight,
        reason: 'MACD_BULLISH_CROSSOVER'
      };
    }
    // MACD line has crossed below signal line (bearish)
    else if (prevHistogram > 0 && lastHistogram < 0) {
      // Stronger signal if aligned with trend
      const weight = trendDirection === 'DOWN' ? 0.8 : 0.6;
      return {
        type: 'SELL',
        weight,
        reason: 'MACD_BEARISH_CROSSOVER'
      };
    }
    // MACD histogram is increasing (bullish momentum building)
    else if (lastHistogram > prevHistogram && lastHistogram > 0) {
      return {
        type: 'BUY',
        weight: 0.4,
        reason: 'MACD_BULLISH_MOMENTUM'
      };
    }
    // MACD histogram is decreasing (bearish momentum building)
    else if (lastHistogram < prevHistogram && lastHistogram < 0) {
      return {
        type: 'SELL',
        weight: 0.4,
        reason: 'MACD_BEARISH_MOMENTUM'
      };
    }
    
    // No strong signal
    return {
      type: 'NONE',
      weight: 0,
      reason: 'NEUTRAL_MACD'
    };