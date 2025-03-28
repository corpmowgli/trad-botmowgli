export class SimulationEngine {
  constructor(db, strategy, riskManager) {
    this.db = db;
    this.strategy = strategy;
    this.riskManager = riskManager;
    this.portfolio = {
      total: 10000, // Initial capital
      current: 10000,
      peak: 10000
    };
  }

  async runSimulation(startDate, endDate) {
    const trades = [];
    const performanceMetrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      maxDrawdown: 0
    };

    const tokens = await this.getQualifiedTokens();

    for (const token of tokens) {
      const historicalData = await this.getHistoricalData(token.token_mint, startDate, endDate);
      
      for (let i = 50; i < historicalData.length; i++) {
        const windowData = historicalData.slice(i - 50, i);
        const signal = await this.strategy.analyze(
          windowData.map(d => d.price),
          windowData.map(d => d.volume)
        );

        if (signal.type !== 'NONE' && this.riskManager.canTrade(this.portfolio)) {
          const trade = await this.simulateTrade(token, windowData[i], signal);
          if (trade) {
            trades.push(trade);
            this.updatePerformanceMetrics(performanceMetrics, trade);
          }
        }
      }
    }

    return {
      trades,
      metrics: this.calculateFinalMetrics(performanceMetrics)
    };
  }

  async simulateTrade(token, data, signal) {
    const positionSize = this.riskManager.calculatePositionSize(data.price, this.portfolio);
    
    const entryPrice = data.price;
    const amount = positionSize;

    const exitPrice = await this.simulateExit(token, data.timestamp, entryPrice);
    const profit = (exitPrice - entryPrice) * amount;

    this.portfolio.current += profit;
    this.portfolio.peak = Math.max(this.portfolio.current, this.portfolio.peak);

    return {
      token: token.token_mint,
      entryPrice,
      exitPrice,
      amount,
      profit,
      timestamp: data.timestamp,
      signal: signal.type
    };
  }
}
