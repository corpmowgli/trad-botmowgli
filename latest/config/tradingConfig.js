// config/tradingConfig.js
export const tradingConfig = {
  api: {
    raydiumBaseUrl: 'https://api.raydium.io/v2',
    jupiterBaseUrl: 'https://price.jup.ag/v4',
    coingeckoBaseUrl: 'https://api.coingecko.com/api/v3'
  },
  trading: {
    tradeSize: 2, // Percentage of portfolio per trade
    stopLoss: 5, // Percentage
    takeProfit: 15, // Percentage
    maxOpenPositions: 3,
    minLiquidity: 100000, // Minimum pool liquidity in USD
    minVolume24h: 50000, // Minimum 24h volume in USD
  },
  indicators: {
    rsi: {
      period: 14,
      oversold: 30,
      overbought: 70
    },
    macd: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9
    },
    bollingerBands: {
      period: 20,
      stdDev: 2
    },
    volumeProfile: {
      lookback: 24, // hours
      threshold: 1.2 // Volume increase threshold
    }
  },
  simulation: {
    initialCapital: 10000,
    backtestDays: 30,
    minProfitableRatio: 0.6, // Minimum ratio of profitable trades
    maxDrawdown: 15, // Maximum allowed drawdown percentage
  },
  // Add logging configuration
  logging: {
    enabled: true,
    level: 'info', // 'debug', 'info', 'warn', 'error'
    persistentStorage: true,
    storageType: 'file', // 'file', 'database'
    filePath: './logs/trades/',
    autoExport: {
      enabled: true,
      interval: 86400000, // Daily (in ms)
      format: 'json'
    }
  }
};
