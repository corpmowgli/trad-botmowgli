export const technicalAnalysis = {
  calculateRSI(prices, period = 14) {
    const changes = prices.slice(1).map((price, i) => price - prices[i]);
    const gains = changes.map(change => change > 0 ? change : 0);
    const losses = changes.map(change => change < 0 ? -change : 0);

    let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;

    const rsiData = [];
    for (let i = period; i < prices.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
      
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      rsiData.push(rsi);
    }

    return {
      values: rsiData,
      last: rsiData[rsiData.length - 1]
    };
  },

  calculateMACD(prices) {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    
    const macdLine = ema12.map((value, index) => value - ema26[index]);
    const signalLine = this.calculateEMA(macdLine, 9);
    const histogram = macdLine.map((value, index) => value - signalLine[index]);

    return {
      macdLine,
      signalLine,
      histogram,
      previousHistogram: histogram[histogram.length - 2],
      lastHistogram: histogram[histogram.length - 1]
    };
  },

  calculateBollingerBands(prices, period = 20, stdDev = 2) {
    const sma = this.calculateSMA(prices, period);
    const bands = sma.map((mean, i) => {
      const slice = prices.slice(i - period, i);
      const std = this.standardDeviation(slice);
      return {
        upper: mean + stdDev * std,
        middle: mean,
        lower: mean - stdDev * std
      };
    });
    return bands[bands.length - 1];
  },

  calculateEMA(prices, period) {
    const multiplier = 2 / (period + 1);
    let ema = [prices[0]];
    for (let i = 1; i < prices.length; i++) {
      ema.push((prices[i] - ema[i - 1]) * multiplier + ema[i - 1]);
    }
    return ema;
  },

  calculateSMA(prices, period) {
    const sma = [];
    for (let i = period; i <= prices.length; i++) {
      const slice = prices.slice(i - period, i);
      const sum = slice.reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
    return sma;
  },

  standardDeviation(values) {
    const mean = values.reduce((a, b) => a + b) / values.length;
    const squareDiffs = values.map(value => Math.pow(value - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b) / values.length;
    return Math.sqrt(avgSquareDiff);
  }
};
