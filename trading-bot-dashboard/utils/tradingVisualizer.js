// utils/tradingVisualizer.js
import { formatCurrency, formatPercentage, formatTimestamp } from './helpers.js';

export class TradingVisualizer {
  constructor(logger) {
    this.logger = logger;
  }

  // Générer un rapport visuel pour la console
  generateConsoleReport() {
    try {
      const metrics = this.logger.getPerformanceMetrics();
      const recentTrades = this.logger.getRecentTrades(5);
      const dailyPerformance = this.logger.getDailyPerformance().slice(-7); // 7 derniers jours

      let report = '\n======== RAPPORT DE PERFORMANCE DU BOT DE TRADING ========\n\n';

      // Statistiques résumées
      report += `Profit Total: ${formatCurrency(metrics.totalProfit)} (${formatPercentage(metrics.winRate)} Win Rate)\n`;
      report += `Trades: ${metrics.totalTrades} (${metrics.winningTrades} gagnants, ${metrics.losingTrades} perdants)\n`;
      report += `Facteur de Profit: ${metrics.profitFactor.toFixed(2)}\n`;
      report += `Gain Moyen: ${formatCurrency(metrics.averageWin)} | Perte Moyenne: ${formatCurrency(Math.abs(metrics.averageLoss))}\n`;
      report += `Temps de Détention Moyen: ${(metrics.averageHoldingPeriodHours).toFixed(2)} heures\n\n`;

      // Trades récents
      report += '--- TRADES RÉCENTS ---\n';
      recentTrades.forEach(trade => {
        const profitSymbol = trade.profit >= 0 ? '✓' : '✗';
        report += `${profitSymbol} ${formatTimestamp(trade.timestamp)} | ${trade.token} | ${formatCurrency(trade.profit)} (${formatPercentage(trade.profitPercentage)})\n`;
      });

      // Performance journalière
      report += '\n--- PERFORMANCE JOURNALIÈRE (7 DERNIERS JOURS) ---\n';
      dailyPerformance.forEach(day => {
        const profitSymbol = day.profit >= 0 ? '✓' : '✗';
        report += `${profitSymbol} ${day.date} | Trades: ${day.trades} | Profit: ${formatCurrency(day.profit)} | Win Rate: ${formatPercentage(day.winRate)}\n`;
      });

      report += '\n==========================================================\n';

      return report;
    } catch (error) {
      console.error('Error generating console report:', error);
      return 'Error generating report.';
    }
  }

  // Générer un rapport HTML simple
  generateHtmlReport() {
    try {
      const metrics = this.logger.getPerformanceMetrics();
      const recentTrades = this.logger.getRecentTrades(10);
      const dailyPerformance = this.logger.getDailyPerformance();

      return `
<!DOCTYPE html>
<html>
<head>
<title>Trading Bot Performance Report</title>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
<h3>Performance Globale</h3>
<p>Profit Total: <span class="${metrics.totalProfit >= 0 ? 'positive' : 'negative'}">${formatCurrency(metrics.totalProfit)}</span></p>
<p>Win Rate: ${formatPercentage(metrics.winRate)}</p>
<p>Facteur de Profit: ${metrics.profitFactor.toFixed(2)}</p>
</div>

<div class="summary-item">
<h3>Statistiques des Trades</h3>
<p>Trades Total: ${metrics.totalTrades}</p>
<p>Trades Gagnants: ${metrics.winningTrades}</p>
<p>Trades Perdants: ${metrics.losingTrades}</p>
</div>

<div class="summary-item">
<h3>Valeurs Moyennes</h3>
<p>Gain Moyen: ${formatCurrency(metrics.averageWin)}</p>
<p>Perte Moyenne: ${formatCurrency(Math.abs(metrics.averageLoss))}</p>
<p>Temps de Détention Moyen: ${(metrics.averageHoldingPeriodHours).toFixed(2)} heures</p>
</div>
</div>

<h2>Trades Récents</h2>
<table>
<thead>
<tr>
<th>Date</th>
<th>Token</th>
<th>Prix d'Entrée</th>
<th>Prix de Sortie</th>
<th>Montant</th>
<th>Profit</th>
<th>Signal</th>
</tr>
</thead>
<tbody>
${recentTrades.map(trade => `
<tr>
<td>${formatTimestamp(trade.timestamp)}</td>
<td>${trade.token}</td>
<td>${(trade.entryPrice || 0).toFixed(6)}</td>
<td>${(trade.exitPrice || 0).toFixed(6)}</td>
<td>${(trade.amount || 0).toFixed(2)}</td>
<td class="${trade.profit >= 0 ? 'positive' : 'negative'}">${formatCurrency(trade.profit)} (${formatPercentage(trade.profitPercentage)})</td>
<td>${trade.signal || 'N/A'}</td>
</tr>
`).join('')}
</tbody>
</table>

<h2>Performance Journalière</h2>
<table>
<thead>
<tr>
<th>Date</th>
<th>Trades</th>
<th>Gagnants/Perdants</th>
<th>Win Rate</th>
<th>Profit</th>
<th>Volume de Trading</th>
</tr>
</thead>
<tbody>
${dailyPerformance.map(day => `
<tr>
<td>${day.date}</td>
<td>${day.trades}</td>
<td>${day.winningTrades}/${day.losingTrades}</td>
<td>${formatPercentage(day.winRate)}</td>
<td class="${day.profit >= 0 ? 'positive' : 'negative'}">${formatCurrency(day.profit)}</td>
<td>${formatCurrency(day.volume)}</td>
</tr>
`).join('')}
</tbody>
</table>

<p><small>Rapport généré le ${new Date().toLocaleString()}</small></p>
</div>
</body>
</html>
`;
    } catch (error) {
      console.error('Error generating HTML report:', error);
      return `<html><body><h1>Error generating report</h1><p>${error.message}</p></body></html>`;
    }
  }
  
  // Générer un rapport interactif plus avancé avec graphiques
  generateInteractiveReport() {
    try {
      const metrics = this.logger.getPerformanceMetrics();
      const dailyPerformance = this.logger.getDailyPerformance();
      const recentTrades = this.logger.getRecentTrades(100);
      
      // Préparer les données pour les graphiques
      const dates = dailyPerformance.map(day => day.date);
      const profits = dailyPerformance.map(day => day.profit);
      const cumulative = [];
      let cumulativeProfit = 0;
      
      profits.forEach(profit => {
        cumulativeProfit += profit;
        cumulative.push(cumulativeProfit);
      });
      
      // Calculer la distribution des trades
      const tradePercentages = recentTrades.map(trade => trade.profitPercentage);
      
      return `
<!DOCTYPE html>
<html>
<head>
<title>Trading Bot Interactive Report</title>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body { font-family: Arial, sans-serif; padding: 20px; background-color: #f8f9fa; }
.card { border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); margin-bottom: 20px; }
.profit { color: #198754; font-weight: 600; }
.loss { color: #dc3545; font-weight: 600; }
.chart-container { height: 400px; margin-bottom: 20px; }
</style>
</head>
<body>

<div class="container">
  <h1 class="my-4">Trading Bot Interactive Report</h1>
  
  <div class="row">
    <div class="col-md-4">
      <div class="card">
        <div class="card-body">
          <h5 class="card-title">Performance Summary</h5>
          <p>Profit Total: <span class="${metrics.totalProfit >= 0 ? 'profit' : 'loss'}">${formatCurrency(metrics.totalProfit)}</span></p>
          <p>Win Rate: ${formatPercentage(metrics.winRate)}</p>
          <p>Trades: ${metrics.totalTrades} (${metrics.winningTrades} gagnants, ${metrics.losingTrades} perdants)</p>
          <p>Facteur de Profit: ${metrics.profitFactor.toFixed(2)}</p>
        </div>
      </div>
    </div>
    <div class="col-md-4">
      <div class="card">
        <div class="card-body">
          <h5 class="card-title">Average Metrics</h5>
          <p>Gain Moyen: <span class="profit">${formatCurrency(metrics.averageWin)}</span></p>
          <p>Perte Moyenne: <span class="loss">${formatCurrency(Math.abs(metrics.averageLoss))}</span></p>
          <p>Plus Grand Gain: <span class="profit">${formatCurrency(metrics.biggestWin)}</span></p>
          <p>Plus Grande Perte: <span class="loss">${formatCurrency(Math.abs(metrics.biggestLoss))}</span></p>
        </div>
      </div>
    </div>
    <div class="col-md-4">
      <div class="card">
        <div class="card-body">
          <h5 class="card-title">Timing Metrics</h5>
          <p>Temps de Détention Moyen: ${(metrics.averageHoldingPeriodHours).toFixed(2)} heures</p>
          <p>Date du Rapport: ${new Date().toLocaleString()}</p>
        </div>
      </div>
    </div>
  </div>
  
  <div class="row">
    <div class="col-md-8">
      <div class="card">
        <div class="card-body">
          <h5 class="card-title">Profit Journalier</h5>
          <div class="chart-container">
            <canvas id="dailyProfitChart"></canvas>
          </div>
        </div>
      </div>
    </div>
    <div class="col-md-4">
      <div class="card">
        <div class="card-body">
          <h5 class="card-title">Distribution des Trades</h5>
          <div class="chart-container">
            <canvas id="tradesDistributionChart"></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <div class="row">
    <div class="col-12">
      <div class="card">
        <div class="card-body">
          <h5 class="card-title">Évolution du Profit Cumulé</h5>
          <div class="chart-container">
            <canvas id="cumulativeProfitChart"></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <div class="row">
    <div class="col-12">
      <div class="card">
        <div class="card-body">
          <h5 class="card-title">Distribution des Gains/Pertes (%)</h5>
          <div class="chart-container">
            <canvas id="profitDistributionChart"></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
// Configuration des graphiques
const ctx1 = document.getElementById('dailyProfitChart').getContext('2d');
const ctx2 = document.getElementById('tradesDistributionChart').getContext('2d');
const ctx3 = document.getElementById('cumulativeProfitChart').getContext('2d');
const ctx4 = document.getElementById('profitDistributionChart').getContext('2d');

// Données des graphiques
const dates = ${JSON.stringify(dates)};
const profits = ${JSON.stringify(profits)};
const cumulative = ${JSON.stringify(cumulative)};
const tradePercentages = ${JSON.stringify(tradePercentages)};

// Graphique de profit journalier
new Chart(ctx1, {
  type: 'bar',
  data: {
    labels: dates,
    datasets: [{
      label: 'Profit Journalier',
      data: profits,
      backgroundColor: profits.map(value => value >= 0 ? 'rgba(75, 192, 192, 0.2)' : 'rgba(255, 99, 132, 0.2)'),
      borderColor: profits.map(value => value >= 0 ? 'rgba(75, 192, 192, 1)' : 'rgba(255, 99, 132, 1)'),
      borderWidth: 1
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true
      }
    }
  }
});

// Graphique de distribution des trades
new Chart(ctx2, {
  type: 'doughnut',
  data: {
    labels: ['Gagnants', 'Perdants'],
    datasets: [{
      data: [${metrics.winningTrades}, ${metrics.losingTrades}],
      backgroundColor: [
        'rgba(75, 192, 192, 0.2)',
        'rgba(255, 99, 132, 0.2)'
      ],
      borderColor: [
        'rgba(75, 192, 192, 1)',
        'rgba(255, 99, 132, 1)'
      ],
      borderWidth: 1
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false
  }
});

// Graphique de profit cumulé
new Chart(ctx3, {
  type: 'line',
  data: {
    labels: dates,
    datasets: [{
      label: 'Profit Cumulé',
      data: cumulative,
      fill: true,
      backgroundColor: 'rgba(54, 162, 235, 0.2)',
      borderColor: 'rgba(54, 162, 235, 1)',
      borderWidth: 2,
      tension: 0.1
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        ticks: {
          callback: function(value) {
            return '$' + value.toFixed(2);
          }
        }
      }
    }
  }
});

// Créer un histogramme de distribution des profits
function createHistogram(data, bins) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const binSize = range / bins;
  
  const histogram = Array(bins).fill(0);
  const binLabels = [];
  
  for (let i = 0; i < bins; i++) {
    const lowerBound = min + i * binSize;
    const upperBound = min + (i + 1) * binSize;
    binLabels.push(\`\${lowerBound.toFixed(1)} - \${upperBound.toFixed(1)}\`);
  }
  
  data.forEach(value => {
    if (value === max) {
      histogram[bins - 1]++;
    } else {
      const binIndex = Math.floor((value - min) / binSize);
      histogram[binIndex]++;
    }
  });
  
  return { histogram, binLabels };
}

// Distribution des profits/pertes
const { histogram, binLabels } = createHistogram(tradePercentages, 10);

new Chart(ctx4, {
  type: 'bar',
  data: {
    labels: binLabels,
    datasets: [{
      label: 'Nombre de Trades',
      data: histogram,
      backgroundColor: 'rgba(153, 102, 255, 0.2)',
      borderColor: 'rgba(153, 102, 255, 1)',
      borderWidth: 1
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0
        }
      }
    }
  }
});
</script>

</body>
</html>
`;
    } catch (error) {
      console.error('Error generating interactive report:', error);
      return `<html><body><h1>Error generating interactive report</h1><p>${error.message}</p></body></html>`;
    }
  }
  
  // Exporter les données au format CSV
  generateCsvReport() {
    try {
      const trades = this.logger.tradeLogs;
      
      // En-têtes CSV
      const headers = [
        'id',
        'date',
        'token',
        'entryPrice',
        'exitPrice',
        'amount',
        'profit',
        'profitPercentage',
        'signal',
        'signalConfidence',
        'holdingPeriod'
      ].join(',');
      
      // Lignes de données
      const rows = trades.map(trade => {
        return [
          trade.id,
          formatTimestamp(trade.timestamp),
          trade.token,
          trade.entryPrice,
          trade.exitPrice,
          trade.amount,
          trade.profit,
          trade.profitPercentage,
          trade.signal,
          trade.signalConfidence,
          trade.holdingPeriod
        ].join(',');
      });
      
      // Combiner les en-têtes et les lignes
      return [headers, ...rows].join('\n');
    } catch (error) {
      console.error('Error generating CSV report:', error);
      return 'Error,generating,CSV,report';
    }
  }
  
  // Configuration par défaut de journalisation
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