export class RiskManager {
  constructor(config) {
    this.config = config;
    this.maxDrawdown = -15; // Maximum drawdown percentage allowed
    this.maxDailyLoss = -5; // Maximum daily loss percentage
    this.dailyStats = {
      trades: 0,
      profit: 0,
      losses: 0
    };
  }

  canTrade(portfolio) {
    return this.checkDailyLimits() && this.checkDrawdown(portfolio);
  }

  calculatePositionSize(price, portfolio) {
    const riskPerTrade = portfolio.total * (this.config.trading.tradeSize / 100);
    return riskPerTrade / price;
  }

  checkDailyLimits() {
    const dailyPnL = this.dailyStats.profit + this.dailyStats.losses;
    return dailyPnL > this.maxDailyLoss;
  }

  checkDrawdown(portfolio) {
    const drawdown = ((portfolio.current - portfolio.peak) / portfolio.peak) * 100;
    return drawdown > this.maxDrawdown;
  }

  updateStats(trade) {
    this.dailyStats.trades++;
    if (trade.profit > 0) {
      this.dailyStats.profit += trade.profit;
    } else {
      this.dailyStats.losses += trade.profit;
    }
  }

  resetDailyStats() {
    this.dailyStats = {
      trades: 0,
      profit: 0,
      losses: 0
    };
  }
}
