// utils/tradingVisualizer.js
export class TradingVisualizer {
  constructor(logger) {
    this.logger = logger;
  }

  // Generate a console-based visual report
  generateConsoleReport() {
    const metrics = this.logger.getPerformanceMetrics();
    const recentTrades = this.logger.getRecentTrades(5);
    const dailyPerformance = this.logger.getDailyPerformance().slice(-7); // Last 7 days

    let report = '\n======== TRADING BOT PERFORMANCE REPORT ========\n\n';

    // Summary statistics
    report += `Total Profit: ${metrics.totalProfit.toFixed(2)} USD (${metrics.winRate.toFixed(2)}% Win Rate)\n`;
    report += `Trades: ${metrics.totalTrades} (${metrics.winningTrades} wins, ${metrics.losingTrades} losses)\n`;
    report += `Profit Factor: ${metrics.profitFactor.toFixed(2)}\n`;
    report += `Avg Win: ${metrics.averageWin.toFixed(2)} USD | Avg Loss: ${metrics.averageLoss.toFixed(2)} USD\n`;
    report += `Average Holding Time: ${(metrics.averageHoldingPeriodHours).toFixed(2)} hours\n\n`;

    // Recent trades
    report += '--- RECENT TRADES ---\n';
    recentTrades.forEach(trade => {
      const profitSymbol = trade.profit >= 0 ? '✓' : '✗';
      report += `${profitSymbol} ${trade.date} | ${trade.token} | ${trade.profit.toFixed(2)} USD (${trade.profitPercentage.toFixed(2)}%)\n`;
    });

    // Daily performance
    report += '\n--- DAILY PERFORMANCE (LAST 7 DAYS) ---\n';
    dailyPerformance.forEach(day => {
      const profitSymbol = day.profit >= 0 ? '✓' : '✗';
      report += `${profitSymbol} ${day.date} | Trades: ${day.trades} | Profit: ${day.profit.toFixed(2)} USD | Win Rate: ${day.winRate.toFixed(2)}%\n`;
    });

    report += '\n==============================================\n';

    return report;
  }

  // Generate a simple HTML report that can be saved to a file
  generateHtmlReport() {
    const metrics = this.logger.getPerformanceMetrics();
    const recentTrades = this.logger.getRecentTrades(10);
    const dailyPerformance = this.logger.getDailyPerformance();

    return `
<!DOCTYPE html>
<html>
<head>
<title>Trading Bot Performance Report</title>
<style>
body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
.container { max-width: 1000px; margin: 0 auto; }
.metrics { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
.profit { color: green; font-weight: bold; }
.loss { color: red; font-weight: bold; }
table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
th { background-color: #f2f2f2; }
.positive { color: green; }
.negative { color: red; }
h2 { margin-top: 30px; }
.summary { display: flex; flex-wrap: wrap; }
.summary-item { flex: 1; min-width: 200px; margin: 10px; padding: 15px; background: #f9f9f9; border-radius: 5px; }
.summary-item h3 { margin-top: 0; }
</style>
</head>
<body>
<div class="container">
<h1>Trading Bot Performance Report</h1>

<div class="summary">
<div class="summary-item">
<h3>Overall Performance</h3>
<p>Total Profit: <span class="${metrics.totalProfit >= 0 ? 'positive' : 'negative'}">${metrics.totalProfit.toFixed(2)} USD</span></p>
<p>Win Rate: ${metrics.winRate.toFixed(2)}%</p>
<p>Profit Factor: ${metrics.profitFactor.toFixed(2)}</p>
</div>

<div class="summary-item">
<h3>Trade Statistics</h3>
<p>Total Trades: ${metrics.totalTrades}</p>
<p>Winning Trades: ${metrics.winningTrades}</p>
<p>Losing Trades: ${metrics.losingTrades}</p>
</div>

<div class="summary-item">
<h3>Average Values</h3>
<p>Average Win: ${metrics.averageWin.toFixed(2)} USD</p>
<p>Average Loss: ${metrics.averageLoss.toFixed(2)} USD</p>
<p>Avg Hold Time: ${(metrics.averageHoldingPeriodHours).toFixed(2)} hours</p>
</div>
</div>

<h2>Recent Trades</h2>
<table>
<thead>
<tr>
<th>Date</th>
<th>Token</th>
<th>Entry Price</th>
<th>Exit Price</th>
<th>Amount</th>
<th>Profit</th>
<th>Signal</th>
</tr>
</thead>
<tbody>
${recentTrades.map(trade => `
<tr>
<td>${new Date(trade.timestamp).toLocaleString()}</td>
<td>${trade.token}</td>
<td>${trade.entryPrice.toFixed(6)}</td>
<td>${trade.exitPrice.toFixed(6)}</td>
<td>${trade.amount.toFixed(2)}</td>
<td class="${trade.profit >= 0 ? 'positive' : 'negative'}">${trade.profit.toFixed(2)} USD (${trade.profitPercentage.toFixed(2)}%)</td>
<td>${trade.signal}</td>
</tr>
`).join('')}
</tbody>
</table>

<h2>Daily Performance</h2>
<table>
<thead>
<tr>
<th>Date</th>
<th>Trades</th>
<th>Win/Loss</th>
<th>Win Rate</th>
<th>Profit</th>
<th>Trading Volume</th>
</tr>
</thead>
<tbody>
${dailyPerformance.map(day => `
<tr>
<td>${day.date}</td>
<td>${day.trades}</td>
<td>${day.winningTrades}/${day.losingTrades}</td>
<td>${day.winRate.toFixed(2)}%</td>
<td class="${day.profit >= 0 ? 'positive' : 'negative'}">${day.profit.toFixed(2)} USD</td>
<td>${day.volume.toFixed(2)} USD</td>
</tr>
`).join('')}
</tbody>
</table>

<p><small>Report generated on ${new Date().toLocaleString()}</small></p>
</div>
</body>
</html>
`;
  }

  // Default logging configuration
  static getDefaultLoggingConfig() {
    return {
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
  }
}
