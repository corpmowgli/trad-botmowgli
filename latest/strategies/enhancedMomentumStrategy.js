import { technicalAnalysis } from '../utils/indicators.js';

export class EnhancedMomentumStrategy {
  constructor(config) {
    this.config = config;
    this.lastSignals = new Map(); // Store previous signals for each token
  }

  async analyze(token, prices, volume, marketData) {
    const { rsi, macd, bb } = await technicalAnalysis.calculateIndicators(prices);
    const volumeProfile = await this.analyzeVolumeProfile(volume);
    const marketMetrics = await this.analyzeMarketMetrics(marketData);

    let signal = {
      type: 'NONE',
      confidence: 0,
      reasons: []
    };

    // Market Metrics Analysis
    if (!this.validateMarketConditions(marketMetrics)) {
      return signal;
    }

    // Trend Analysis
    const trend = this.analyzeTrend(prices);
    signal.confidence += trend.weight;
    signal.reasons.push(trend.reason);

    // Price Action Analysis
    const priceAction = this.analyzePriceAction(prices, bb);
    if (priceAction.signal) {
      signal.confidence += priceAction.weight;
      signal.reasons.push(priceAction.reason);
    }

    // RSI Analysis with Divergence
    const rsiSignal = this.analyzeRSIWithDivergence(prices, rsi);
    signal.confidence += rsiSignal.weight;
    signal.reasons.push(rsiSignal.reason);

    // MACD Analysis with Confirmation
    const macdSignal = this.analyzeMacdEnhanced(macd, trend.direction);
    signal.confidence += macdSignal.weight;
    signal.reasons.push(macdSignal.reason);

    // Volume Analysis
    if (volumeProfile.increasing && volumeProfile.volumeRatio > this.config.indicators.volumeProfile.threshold) {
      signal.confidence += 0.3;
      signal.reasons.push('STRONG_VOLUME_CONFIRMATION');
    }

    // Avoid frequent signal changes
    const previousSignal = this.lastSignals.get(token);
    if (previousSignal && Date.now() - previousSignal.timestamp < 3600000) { // 1 hour
      signal.confidence *= 0.7;
    }

    // Determine final signal type
    if (signal.confidence > 0.8) {
      signal.type = trend.direction === 'UP' ? 'BUY' : 'SELL';
      this.lastSignals.set(token, { type: signal.type, timestamp: Date.now() });
    }

    return signal;
  }

  validateMarketConditions(metrics) {
    return metrics.liquidity >= this.config.trading.minLiquidity &&
           metrics.volume24h >= this.config.trading.minVolume24h &&
           Math.abs(metrics.priceChange24h) <= 30;
  }
}
