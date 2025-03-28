// trading/tradeLogger.js
export class TradeLogger {
  constructor(config) {
    this.config = config;
    this.tradeLogs = [];
    this.dailyLogs = new Map(); // Map with date string keys
    this.totalStats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      biggestWin: 0,
      biggestLoss: 0
    };
  }

  logTrade(trade) {
    // Format trade data for logging
    const tradeLog = {
      id: this.generateTradeId(),
      token: trade.token,
      timestamp: trade.timestamp,
      date: new Date(trade.timestamp).toISOString().split('T')[0],
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      amount: trade.amount,
      profit: trade.profit,
      profitPercentage: ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100,
      signal: trade.signal,
      signalConfidence: trade.signalConfidence || 0,
      signalReasons: trade.signalReasons || [],
      holdingPeriod: trade.holdingTime || 0,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit
    };

    // Add log to the trades array
    this.tradeLogs.push(tradeLog);

    // Update total stats
    this.updateTotalStats(tradeLog);

    // Update daily stats
    this.updateDailyStats(tradeLog);

    // If configured, save to persistent storage
    if (this.config.logging?.persistentStorage) {
      this.saveToStorage(tradeLog);
    }

    return tradeLog;
  }

  generateTradeId() {
    // Generate a unique ID for each trade
    return `trade-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  updateTotalStats(trade) {
    this.totalStats.totalTrades++;
    if (trade.profit > 0) {
      this.totalStats.winningTrades++;
      this.totalStats.biggestWin = Math.max(this.totalStats.biggestWin, trade.profit);
    } else {
      this.totalStats.losingTrades++;
      this.totalStats.biggestLoss = Math.min(this.totalStats.biggestLoss, trade.profit);
    }
    this.totalStats.totalProfit += trade.profit;
  }

  updateDailyStats(trade) {
    const date = trade.date;

    if (!this.dailyLogs.has(date)) {
      this.dailyLogs.set(date, {
        date,
        trades: 0,
        winningTrades: 0,
        losingTrades: 0,
        profit: 0,
        volume: 0,
        tokens: new Set()
      });
    }

    const dailyLog = this.dailyLogs.get(date);
    dailyLog.trades++;
    dailyLog.profit += trade.profit;
    dailyLog.volume += trade.amount * trade.entryPrice;
    dailyLog.tokens.add(trade.token);

    if (trade.profit > 0) {
      dailyLog.winningTrades++;
    } else {
      dailyLog.losingTrades++;
    }
  }

  getTradesByToken(token) {
    return this.tradeLogs.filter(trade => trade.token === token);
  }

  getTradesByDateRange(startDate, endDate) {
    return this.tradeLogs.filter(trade => {
      const tradeDate = new Date(trade.timestamp);
      return tradeDate >= new Date(startDate) && tradeDate <= new Date(endDate);
    });
  }

  getDailyPerformance() {
    return Array.from(this.dailyLogs.values()).map(dailyLog => ({
      ...dailyLog,
      tokens: Array.from(dailyLog.tokens), // Convert Set to Array for serialization
      winRate: dailyLog.trades > 0 ? (dailyLog.winningTrades / dailyLog.trades) * 100 : 0
    }));
  }

  getPerformanceMetrics() {
    const winRate = this.totalStats.totalTrades > 0
      ? (this.totalStats.winningTrades / this.totalStats.totalTrades) * 100
      : 0;

    const averageWin = this.totalStats.winningTrades > 0
      ? this.tradeLogs
        .filter(t => t.profit > 0)
        .reduce((sum, t) => sum + t.profit, 0) / this.totalStats.winningTrades
      : 0;

    const averageLoss = this.totalStats.losingTrades > 0
      ? this.tradeLogs
        .filter(t => t.profit < 0)
        .reduce((sum, t) => sum + t.profit, 0) / this.totalStats.losingTrades
      : 0;

    // Calculate profit factor (absolute ratio of gross profits to gross losses)
    const grossProfit = this.tradeLogs
      .filter(t => t.profit > 0)
      .reduce((sum, t) => sum + t.profit, 0);

    const grossLoss = Math.abs(this.tradeLogs
      .filter(t => t.profit < 0)
      .reduce((sum, t) => sum + t.profit, 0));

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

    // Calculate average holding period
    const avgHoldingPeriod = this.tradeLogs.length > 0
      ? this.tradeLogs.reduce((sum, t) => sum + t.holdingPeriod, 0) / this.tradeLogs.length
      : 0;

    return {
      totalTrades: this.totalStats.totalTrades,
      winningTrades: this.totalStats.winningTrades,
      losingTrades: this.totalStats.losingTrades,
      winRate,
      totalProfit: this.totalStats.totalProfit,
      averageWin,
      averageLoss,
      biggestWin: this.totalStats.biggestWin,
      biggestLoss: this.totalStats.biggestLoss,
      profitFactor,
      averageHoldingPeriodMs: avgHoldingPeriod,
      // Convert milliseconds to more readable format
      averageHoldingPeriodHours: avgHoldingPeriod / (1000 * 60 * 60)
    };
  }

  getRecentTrades(limit = 10) {
    return this.tradeLogs
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  saveToStorage(tradeLog) {
    // Implementation depends on your storage solution
    // Could be file system, database, etc.
    console.log(`[Storage] Saving trade: ${tradeLog.id}`);
    // Add actual implementation based on your infrastructure
  }

  exportLogs(format = 'json') {
    if (format === 'json') {
      return JSON.stringify({
        trades: this.tradeLogs,
        metrics: this.getPerformanceMetrics(),
        dailyPerformance: this.getDailyPerformance()
      }, null, 2);
    } else if (format === 'csv') {
      return this.generateCSV();
    }

    throw new Error(`Unsupported export format: ${format}`);
  }

  generateCSV() {
    // Generate CSV from trade logs
    const headers = [
      'id', 'token', 'date', 'timestamp', 'entryPrice', 'exitPrice',
      'amount', 'profit', 'profitPercentage', 'signal', 'signalConfidence',
      'holdingPeriod', 'stopLoss', 'takeProfit'
    ].join(',');

    const rows = this.tradeLogs.map(trade =>
      [
        trade.id,
        trade.token,
        trade.date,
        trade.timestamp,
        trade.entryPrice,
        trade.exitPrice,
        trade.amount,
        trade.profit,
        trade.profitPercentage,
        trade.signal,
        trade.signalConfidence,
        trade.holdingPeriod,
        trade.stopLoss,
        trade.takeProfit
      ].join(',')
    );

    return [headers, ...rows].join('\n');
  }
}
