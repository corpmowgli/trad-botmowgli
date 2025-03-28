import { technicalAnalysis } from '../utils/indicators.js';

export class MomentumStrategy {
  constructor(config) {
    this.config = config;
  }

  async analyze(prices, volume) {
    const { rsi, macd, bb } = await technicalAnalysis.calculateIndicators(prices);
    const volumeProfile = await this.analyzeVolumeProfile(volume);
    
    let signal = {
      type: 'NONE',
      confidence: 0,
      reasons: []
    };

    // Price Action Analysis
    const priceAction = this.analyzePriceAction(prices, bb);
    if (priceAction.signal) {
      signal.confidence += priceAction.weight;
      signal.reasons.push(priceAction.reason);
    }

    // RSI Analysis
    if (rsi.last < this.config.indicators.rsi.oversold) {
      signal.confidence += 0.3;
      signal.reasons.push('RSI_OVERSOLD');
    } else if (rsi.last > this.config.indicators.rsi.overbought) {
      signal.confidence += 0.3;
      signal.type = 'SELL';
      signal.reasons.push('RSI_OVERBOUGHT');
    }

    // MACD Analysis
    const macdSignal = this.analyzeMacd(macd);
    signal.confidence += macdSignal.weight;
    signal.reasons.push(macdSignal.reason);

    // Volume Profile Analysis
    if (volumeProfile.increasing) {
      signal.confidence += 0.2;
      signal.reasons.push('VOLUME_INCREASING');
    }

    // Determine final signal type
    if (signal.confidence > 0.7) {
      signal.type = signal.reasons.some(r => r.includes('SELL')) ? 'SELL' : 'BUY';
    }

    return signal;
  }

  analyzePriceAction(prices, bb) {
    const last = prices[prices.length - 1];
    if (last < bb.lower) {
      return { signal: true, weight: 0.4, reason: 'PRICE_BELOW_BB' };
    }
    if (last > bb.upper) {
      return { signal: true, weight: 0.4, reason: 'PRICE_ABOVE_BB' };
    }
    return { signal: false, weight: 0 };
  }

  analyzeMacd(macd) {
    if (macd.histogram > 0 && macd.histogram > macd.previousHistogram) {
      return { weight: 0.35, reason: 'MACD_BULLISH_CROSSOVER' };
    }
    if (macd.histogram < 0 && macd.histogram < macd.previousHistogram) {
      return { weight: 0.35, reason: 'MACD_BEARISH_CROSSOVER' };
    }
    return { weight: 0, reason: 'MACD_NEUTRAL' };
  }

  async analyzeVolumeProfile(volumes) {
    const recentVolumes = volumes.slice(-24); // Last 24 hours
    const averageVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const latestVolume = volumes[volumes.length - 1];
    return {
      increasing: latestVolume > averageVolume * 1.2,
      volumeRatio: latestVolume / averageVolume
    };
  }
}