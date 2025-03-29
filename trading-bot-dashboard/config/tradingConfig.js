// config/tradingConfig.js
export const tradingConfig = {
  api: {
    // Main API endpoints
    raydiumBaseUrl: 'https://api.raydium.io/v2',
    jupiterBaseUrl: 'https://price.jup.ag/v4',
    coingeckoBaseUrl: 'https://api.coingecko.com/api/v3',
    
    // Rate limiting settings
    rateLimits: {
      raydium: { requestsPerMinute: 30, burstLimit: 10 },
      jupiter: { requestsPerMinute: 60, burstLimit: 20 },
      coingecko: { requestsPerMinute: 30, burstLimit: 5 }
    },
    
    // Timeout and retry settings
    timeout: 10000,
    maxRetries: 3,
    retryDelay: 1000
  },
  
  // Trading parameters
  trading: {
    tradeSize: 2, // Percentage of portfolio per trade
    stopLoss: 5, // Percentage
    takeProfit: 15, // Percentage
    maxOpenPositions: 3,
    minLiquidity: 100000, // Minimum pool liquidity in USD
    minVolume24h: 50000, // Minimum 24h volume in USD
    maxPriceVolatility: 25, // Maximum 24h price volatility percentage
    minMarketCap: 500000, // Minimum market cap in USD
    minConfidenceThreshold: 0.65, // Minimum signal confidence to trade
    cycleInterval: 60000, // Trading cycle interval in ms (1 minute)
    closePositionsOnStop: true, // Auto-close positions when bot stops
    
    // Advanced trading settings
    maxRiskPerTrade: 2.5, // Maximum percentage risk per trade
    maxDailyLoss: -5, // Maximum daily loss percentage
    maxExposure: 60, // Maximum total portfolio exposure percentage
    maxConsecutiveLosses: 3, // Maximum consecutive losses before reducing position size
    
    // Trading time restrictions (if needed)
    restrictedHours: [], // E.g. [0, 1, 2, 3] would avoid trading during hours 0-3 UTC
    tradingDays: [0, 1, 2, 3, 4, 5, 6], // 0-6, Sunday to Saturday
    
    // Position management
    adjustStopLoss: true, // Enable trailing stop loss
    trailingStopPercent: 2, // Trailing stop percentage
    partialTakeProfit: false, // Enable partial take profit
    partialTakeProfitLevels: [
      { percent: 50, targetPercent: 5 }, // Take 50% profit at 5% gain
      { percent: 25, targetPercent: 10 } // Take 25% profit at 10% gain
    ]
  },
  
  // Technical indicators configuration
  indicators: {
    minimumDataPoints: 50, // Minimum data points required for analysis
    
    rsi: {
      period: 14,
      oversold: 30,
      overbought: 70,
      weight: 0.2 // Importance weight in strategy
    },
    
    macd: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      weight: 0.25
    },
    
    bollingerBands: {
      period: 20,
      stdDev: 2,
      weight: 0.15
    },
    
    volumeProfile: {
      lookback: 24, // hours
      threshold: 1.2, // Volume increase threshold
      weight: 0.15
    },
    
    ema: {
      periods: [50, 200], // EMA periods to calculate
      weight: 0.15
    },
    
    priceAction: {
      weight: 0.1 // Weight for price action patterns
    }
  },
  
  // Simulation/backtesting settings
  simulation: {
    initialCapital: 10000,
    backtestDays: 30,
    minProfitableRatio: 0.6, // Minimum ratio of profitable trades
    maxDrawdown: 15, // Maximum allowed drawdown percentage
    maxHoldingPeriodHours: 48, // Maximum holding period for trades in simulation
    includeFees: true, // Include trading fees in simulation
    feePercentage: 0.1, // Fee percentage for simulations
    
    // Monte Carlo settings
    monteCarloIterations: 100, // Number of iterations for Monte Carlo analysis
    confidenceInterval: 0.95 // Confidence interval for Monte Carlo
  },
  
  // Logging configuration
  logging: {
    level: 'info', // 'debug', 'info', 'warn', 'error'
    persistentStorage: true,
    filePath: 'logs/trades',
    maxLogFiles: 100, // Maximum number of log files to keep
    autoExport: {
      enabled: true,
      interval: 86400000, // Daily (in ms)
      format: 'json',
      compress: true // Enable compression for exports
    }
  },
  
  // Error handling
  errorHandling: {
    maxConsecutiveErrors: 3,
    circuitBreakerTimeout: 300000, // 5 minutes in ms
    errorNotification: true, // Enable error notifications
    
    // Retry settings for critical operations
    retry: {
      enabled: true,
      maxRetries: 3,
      retryDelay: 1000,
      exponentialBackoff: true
    }
  },
  
  // Performance optimization
  performance: {
    useCache: true,
    cacheExpiryTimes: {
      prices: 30000, // 30 seconds
      marketData: 300000, // 5 minutes
      historicalData: 600000, // 10 minutes
      qualifiedTokens: 1800000 // 30 minutes
    },
    maxCacheItems: {
      prices: 1000,
      marketData: 500,
      historicalData: 100,
      qualifiedTokens: 1
    },
    
    // Parallelism settings
    maxParallelTokenProcessing: 3, // Max tokens to process in parallel
    batchProcessing: true, // Enable batch processing of API requests
    maxBatchSize: 25 // Maximum batch size for API requests
  }
};

export default tradingConfig;