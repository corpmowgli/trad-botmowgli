export class PortfolioManager {
  constructor(initialCapital) {
    this.initialCapital = initialCapital;
    this.currentCapital = initialCapital;
    this.peakCapital = initialCapital;
    this.trades = [];
    this.dailyStats = {
      date: new Date().toISOString().split('T')[0],
      profit: 0,
      trades: 0
    };
  }

  updatePortfolio(trade) {
    this.currentCapital += trade.profit;
    this.peakCapital = Math.max(this.peakCapital, this.currentCapital);
    this.trades.push(trade);
    
    const tradeDate = new Date(trade.timestamp).toISOString().split('T')[0];
    if (tradeDate !== this.dailyStats.date) {
      this.resetDailyStats();
    }
    
    this.dailyStats.profit += trade.profit;
    this.dailyStats.trades += 1;
  }

  getMetrics() {
    const winningTrades = this.trades.filter(t => t.profit > 0);
    const losingTrades = this.trades.filter(t => t.profit < 0);

    return {
      totalProfit: this.currentCapital - this.initialCapital,
      profitPercentage: ((this.currentCapital - this.initialCapital) / this.initialCapital) * 100,
      winRate: (winningTrades.length / this.trades.length) * 100,
      averageWin: winningTrades.length ? winningTrades.reduce((sum, t) => sum + t.profit, 0) / winningTrades.length : 0,
      averageLoss: losingTrades.length ? losingTrades.reduce((sum, t) => sum + t.profit, 0) / losingTrades.length : 0,
      maxDrawdown: ((this.peakCapital - Math.min(...this.trades.map(t => t.currentCapital))) / this.peakCapital) * 100,
      totalTrades: this.trades.length,
      dailyStats: { ...this.dailyStats }
    };
  }

  resetDailyStats() {
    this.dailyStats = {
      date: new Date().toISOString().split('T')[0],
      profit: 0,
      trades: 0
    };
  }
}
