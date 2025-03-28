// charts.js - Gestion des graphiques pour le dashboard de trading

// Configuration globale des graphiques
Chart.defaults.font.family = "'Segoe UI', 'Helvetica Neue', 'Arial', sans-serif";
Chart.defaults.color = '#6c757d';
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;

// Cache pour les instances de graphiques
const chartInstances = {
    dailyPerformance: null,
    tradesDistribution: null,
    capitalEvolution: null,
    simulationProfit: null
};

// Palettes de couleurs pour les graphiques
const chartColors = {
    // Couleurs standards
    blue: 'rgba(54, 162, 235, 1)',
    blueTransparent: 'rgba(54, 162, 235, 0.2)',
    green: 'rgba(75, 192, 192, 1)',
    greenTransparent: 'rgba(75, 192, 192, 0.2)',
    red: 'rgba(255, 99, 132, 1)',
    redTransparent: 'rgba(255, 99, 132, 0.2)',
    yellow: 'rgba(255, 206, 86, 1)',
    yellowTransparent: 'rgba(255, 206, 86, 0.2)',
    purple: 'rgba(153, 102, 255, 1)',
    purpleTransparent: 'rgba(153, 102, 255, 0.2)',
    orange: 'rgba(255, 159, 64, 1)',
    orangeTransparent: 'rgba(255, 159, 64, 0.2)',
    darkBlue: 'rgba(36, 97, 165, 1)',
    darkBlueTransparent: 'rgba(36, 97, 165, 0.2)',
    
    // Palette pour le mode sombre
    dark: {
        background: 'rgba(40, 44, 52, 1)',
        text: 'rgba(248, 249, 250, 1)',
        grid: 'rgba(255, 255, 255, 0.1)',
        green: 'rgba(105, 240, 174, 1)',
        greenTransparent: 'rgba(105, 240, 174, 0.2)',
        red: 'rgba(255, 99, 132, 1)',
        redTransparent: 'rgba(255, 99, 132, 0.2)',
        blue: 'rgba(100, 181, 246, 1)',
        blueTransparent: 'rgba(100, 181, 246, 0.2)',
        purple: 'rgba(186, 104, 200, 1)',
        purpleTransparent: 'rgba(186, 104, 200, 0.2)',
    }
};

// Initialisation des graphiques
document.addEventListener('DOMContentLoaded', () => {
    // Vérifier que nous sommes sur la page principale
    if (document.getElementById('dailyPerformanceChart')) {
        initializeCharts();
        
        // Vérifier si le mode sombre est activé
        const isDarkMode = document.body.classList.contains('dark-mode');
        if (isDarkMode) {
            updateChartsForDarkMode(true);
        }
    }
    
    // Écouteur pour le changement de thème
    document.addEventListener('stateChange', (event) => {
        if (event.detail.key === 'darkMode') {
            updateChartsForDarkMode(event.detail.value);
        }
    });
    
    // Observer les changements de dimensions pour redimensionner les graphiques
    const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            resizeCharts();
        }
    });
    
    // Observer le conteneur principal
    const container = document.querySelector('.container-fluid');
    if (container) {
        resizeObserver.observe(container);
    }
    
    // Observer chaque conteneur de graphique
    const chartContainers = document.querySelectorAll('.chart-container');
    chartContainers.forEach(container => {
        resizeObserver.observe(container);
    });
});

// Fonction pour redimensionner les graphiques
function resizeCharts() {
    Object.values(chartInstances).forEach(chart => {
        if (chart) {
            chart.resize();
        }
    });
}

// Fonction pour initialiser tous les graphiques
function initializeCharts() {
    initDailyPerformanceChart();
    initTradesDistributionChart();
    initCapitalEvolutionChart();
    initSimulationProfitChart();
}

// Fonction pour mettre à jour les graphiques en mode sombre/clair
function updateChartsForDarkMode(isDarkMode) {
    const textColor = isDarkMode ? chartColors.dark.text : '#6c757d';
    const gridColor = isDarkMode ? chartColors.dark.grid : 'rgba(0, 0, 0, 0.1)';
    
    Chart.defaults.color = textColor;
    
    // Mettre à jour chaque graphique
    Object.values(chartInstances).forEach(chart => {
        if (chart) {
            // Mettre à jour les couleurs des grilles
            if (chart.options.scales && chart.options.scales.y) {
                chart.options.scales.y.grid.color = gridColor;
                chart.options.scales.y.ticks.color = textColor;
            }
            
            if (chart.options.scales && chart.options.scales.x) {
                chart.options.scales.x.grid.color = gridColor;
                chart.options.scales.x.ticks.color = textColor;
            }
            
            // Mettre à jour la couleur du texte pour les légendes
            if (chart.options.plugins && chart.options.plugins.legend) {
                chart.options.plugins.legend.labels.color = textColor;
            }
            
            // Mettre à jour la couleur du texte pour les tooltips
            if (chart.options.plugins && chart.options.plugins.tooltip) {
                chart.options.plugins.tooltip.titleColor = isDarkMode ? '#fff' : '#6c757d';
                chart.options.plugins.tooltip.bodyColor = isDarkMode ? '#fff' : '#6c757d';
                chart.options.plugins.tooltip.backgroundColor = isDarkMode ? 'rgba(45, 55, 72, 0.9)' : 'rgba(255, 255, 255, 0.9)';
                chart.options.plugins.tooltip.borderColor = isDarkMode ? 'rgba(74, 85, 104, 1)' : 'rgba(0, 0, 0, 0.1)';
            }
            
            // Mettre à jour les couleurs des données si c'est un graphique de performance
            if (chart === chartInstances.dailyPerformance && chart.data && chart.data.datasets.length > 0) {
                chart.data.datasets[0].backgroundColor = function(context) {
                    const value = context.dataset.data[context.dataIndex];
                    return value >= 0 
                        ? (isDarkMode ? chartColors.dark.greenTransparent : chartColors.greenTransparent)
                        : (isDarkMode ? chartColors.dark.redTransparent : chartColors.redTransparent);
                };
                
                chart.data.datasets[0].borderColor = function(context) {
                    const value = context.dataset.data[context.dataIndex];
                    return value >= 0 
                        ? (isDarkMode ? chartColors.dark.green : chartColors.green)
                        : (isDarkMode ? chartColors.dark.red : chartColors.red);
                };
            }
            
            // Mettre à jour le graphique de répartition des trades
            if (chart === chartInstances.tradesDistribution && chart.data && chart.data.datasets.length > 0) {
                chart.data.datasets[0].backgroundColor = [
                    isDarkMode ? chartColors.dark.greenTransparent : chartColors.greenTransparent,
                    isDarkMode ? chartColors.dark.redTransparent : chartColors.redTransparent
                ];
                
                chart.data.datasets[0].borderColor = [
                    isDarkMode ? chartColors.dark.green : chartColors.green,
                    isDarkMode ? chartColors.dark.red : chartColors.red
                ];
            }
            
            // Mettre à jour le graphique d'évolution du capital
            if (chart === chartInstances.capitalEvolution && chart.data && chart.data.datasets.length > 0) {
                const isPositive = chart.data.datasets[0].data.length > 1 && 
                                   chart.data.datasets[0].data[chart.data.datasets[0].data.length - 1] > 
                                   chart.data.datasets[0].data[0];
                
                chart.data.datasets[0].backgroundColor = isPositive 
                    ? (isDarkMode ? chartColors.dark.greenTransparent : chartColors.greenTransparent)
                    : (isDarkMode ? chartColors.dark.redTransparent : chartColors.redTransparent);
                
                chart.data.datasets[0].borderColor = isPositive 
                    ? (isDarkMode ? chartColors.dark.green : chartColors.green)
                    : (isDarkMode ? chartColors.dark.red : chartColors.red);
                
                chart.data.datasets[0].pointBackgroundColor = isPositive 
                    ? (isDarkMode ? chartColors.dark.green : chartColors.green)
                    : (isDarkMode ? chartColors.dark.red : chartColors.red);
            }
            
            chart.update();
        }
    });
}

// Fonction pour initialiser le graphique des performances journalières
function initDailyPerformanceChart() {
    const ctx = document.getElementById('dailyPerformanceChart')?.getContext('2d');
    if (!ctx) return;
    
    chartInstances.dailyPerformance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Profits journaliers (USD)',
                    data: [],
                    backgroundColor: function(context) {
                        const value = context.dataset.data[context.dataIndex];
                        return value >= 0 ? chartColors.greenTransparent : chartColors.redTransparent;
                    },
                    borderColor: function(context) {
                        const value = context.dataset.data[context.dataIndex];
                        return value >= 0 ? chartColors.green : chartColors.red;
                    },
                    borderWidth: 1,
                    borderRadius: 4,
                    barPercentage: 0.7
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 6
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    titleColor: '#6c757d',
                    bodyColor: '#6c757d',
                    borderColor: 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 4,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            return `Profit: ${value !== undefined ? formatCurrency(value) : 'N/A'}`;
                        },
                        title: function(context) {
                            return context[0].label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        drawBorder: false,
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        autoSkip: true,
                        maxRotation: 0,
                        minRotation: 0,
                        maxTicksLimit: 10
                    }
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
}

// Fonction pour initialiser le graphique de répartition des trades
function initTradesDistributionChart() {
    const ctx = document.getElementById('tradesDistributionChart')?.getContext('2d');
    if (!ctx) return;
    
    chartInstances.tradesDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Gagnants', 'Perdants'],
            datasets: [{
                data: [0, 0],
                backgroundColor: [
                    chartColors.greenTransparent,
                    chartColors.redTransparent
                ],
                borderColor: [
                    chartColors.green,
                    chartColors.red
                ],
                borderWidth: 1,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            circumference: 360,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        boxWidth: 8
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    titleColor: '#6c757d',
                    bodyColor: '#6c757d',
                    borderColor: 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 4,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? (value / total * 100).toFixed(1) + '%' : '0%';
                            return `${context.label}: ${value} (${percentage})`;
                        }
                    }
                }
            },
            layout: {
                padding: 10
            },
            animation: {
                animateRotate: true,
                animateScale: true,
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
    
    // Ajouter du texte au centre du doughnut
    if (chartInstances.tradesDistribution) {
        const originalDraw = chartInstances.tradesDistribution.draw;
        chartInstances.tradesDistribution.draw = function() {
            originalDraw.apply(this, arguments);
            
            const width = this.width;
            const height = this.height;
            const ctx = this.ctx;
            
            const data = this.data.datasets[0].data;
            const total = data.reduce((a, b) => a + b, 0);
            
            ctx.save();
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            
            const centerX = (this.chartArea.left + this.chartArea.right) / 2;
            const centerY = (this.chartArea.top + this.chartArea.bottom) / 2;
            
            if (total > 0) {
                const winRate = (data[0] / total * 100).toFixed(1) + '%';
                
                ctx.font = 'bold 22px Arial';
                ctx.fillStyle = data[0] >= data[1] ? chartColors.green : chartColors.red;
                ctx.fillText(winRate, centerX, centerY - 10);
                
                ctx.font = '14px Arial';
                ctx.fillStyle = '#6c757d';
                ctx.fillText('Win Rate', centerX, centerY + 15);
            } else {
                ctx.font = '16px Arial';
                ctx.fillStyle = '#6c757d';
                ctx.fillText('Aucune donnée', centerX, centerY);
            }
            
            ctx.restore();
        };
    }
}

// Fonction pour initialiser le graphique d'évolution du capital
function initCapitalEvolutionChart() {
    const ctx = document.getElementById('capitalEvolutionChart')?.getContext('2d');
    if (!ctx) return;
    
    chartInstances.capitalEvolution = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Capital (USD)',
                data: [],
                backgroundColor: chartColors.blueTransparent,
                borderColor: chartColors.blue,
                borderWidth: 2,
                pointBackgroundColor: chartColors.blue,
                pointRadius: 3,
                pointHoverRadius: 5,
                fill: true,
                tension: 0.3,
                cubicInterpolationMode: 'monotone'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 6
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    titleColor: '#6c757d',
                    bodyColor: '#6c757d',
                    borderColor: 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 4,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `Capital: ${context.raw !== undefined ? formatCurrency(context.raw) : 'N/A'}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        drawBorder: false,
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxTicksLimit: 10,
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: true
                    }
                }
            },
            elements: {
                line: {
                    tension: 0.3
                }
            },
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            }
        }
    });
}

// Fonction pour initialiser le graphique des profits de simulation
function initSimulationProfitChart() {
    const ctx = document.getElementById('simulationProfitChart')?.getContext('2d');
    if (!ctx) return;
    
    chartInstances.simulationProfit = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Profit cumulé (USD)',
                data: [],
                backgroundColor: chartColors.purpleTransparent,
                borderColor: chartColors.purple,
                borderWidth: 2,
                pointBackgroundColor: chartColors.purple,
                pointRadius: 2,
                pointHoverRadius: 4,
                fill: true,
                tension: 0.2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 6
                    }
                },
                title: {
                    display: true,
                    text: 'Évolution du profit durant la simulation',
                    padding: {
                        top: 10,
                        bottom: 20
                    },
                    font: {
                        size: 16,
                        weight: 'bold'
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    titleColor: '#6c757d',
                    bodyColor: '#6c757d',
                    borderColor: 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 4,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `Profit: ${context.raw !== undefined ? formatCurrency(context.raw) : 'N/A'}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        drawBorder: false,
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxTicksLimit: 8,
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: true
                    }
                }
            },
            elements: {
                line: {
                    tension: 0.2
                }
            },
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            }
        }
    });
}

// Fonction pour mettre à jour le graphique des performances journalières
function updateDailyPerformanceChart() {
    // Récupérer les données
    const dailyPerformanceData = window.state?.dailyPerformanceData;
    if (!chartInstances.dailyPerformance || !dailyPerformanceData || dailyPerformanceData.length === 0) return;
    
    // Limiter aux 30 derniers jours
    const recentData = dailyPerformanceData.slice(-30);
    
    const labels = recentData.map(day => day.date);
    const profits = recentData.map(day => day.profit);
    
    chartInstances.dailyPerformance.data.labels = labels;
    chartInstances.dailyPerformance.data.datasets[0].data = profits;
    
    // Mettre à jour les axes y pour qu'ils soient cohérents
    const maxProfit = Math.max(...profits, 0);
    const minProfit = Math.min(...profits, 0);
    const margin = Math.max(Math.abs(maxProfit), Math.abs(minProfit)) * 0.1;
    
    chartInstances.dailyPerformance.options.scales.y.suggestedMin = minProfit - margin;
    chartInstances.dailyPerformance.options.scales.y.suggestedMax = maxProfit + margin;
    
    // Animation pour une mise à jour fluide
    chartInstances.dailyPerformance.options.animation = {
        duration: 800,
        easing: 'easeOutQuad'
    };
    
    chartInstances.dailyPerformance.update('show');
}

// Fonction pour mettre à jour le graphique de répartition des trades
function updateTradesDistributionChart() {
    // Récupérer les données
    const performanceData = window.state?.performanceData;
    if (!chartInstances.tradesDistribution || !performanceData || !performanceData.metrics) return;
    
    const { winningTrades, losingTrades } = performanceData.metrics;
    
    chartInstances.tradesDistribution.data.datasets[0].data = [winningTrades, losingTrades];
    
    // Animation pour une mise à jour fluide
    chartInstances.tradesDistribution.options.animation = {
        duration: 500,
        easing: 'easeOutQuart'
    };
    
    chartInstances.tradesDistribution.update('show');
}

// Fonction pour mettre à jour le graphique d'évolution du capital
function updateCapitalEvolutionChart() {
    // Récupérer les données
    const dailyPerformanceData = window.state?.dailyPerformanceData;
    const performanceData = window.state?.performanceData;
    
    if (!chartInstances.capitalEvolution || !dailyPerformanceData || dailyPerformanceData.length === 0) return;
    
    // Calculer l'évolution du capital à partir des profits journaliers
    let capital = performanceData?.portfolioMetrics?.initialCapital || 10000;
    let capitalHistory = [];
    const dates = [];
    
    // Trier les données par date (croissante)
    const sortedData = [...dailyPerformanceData].sort((a, b) => {
        return new Date(a.date) - new Date(b.date);
    });
    
    // Construire l'historique du capital
    for (const day of sortedData) {
        capital += day.profit;
        capitalHistory.push(capital);
        
        // Formatter la date pour l'affichage
        const date = new Date(day.date);
        const formattedDate = date.toLocaleDateString('fr-FR', {
            month: 'short',
            day: 'numeric'
        });
        dates.push(formattedDate);
    }
    
    // Limiter le nombre de points affichés pour une meilleure lisibilité
    if (dates.length > 20) {
        const step = Math.ceil(dates.length / 20);
        const filteredDates = [];
        const filteredCapital = [];
        
        for (let i = 0; i < dates.length; i += step) {
            filteredDates.push(dates[i]);
            filteredCapital.push(capitalHistory[i]);
        }
        
        // S'assurer que le dernier point est inclus
        if (dates.length % step !== 0) {
            filteredDates.push(dates[dates.length - 1]);
            filteredCapital.push(capitalHistory[capitalHistory.length - 1]);
        }
        
        chartInstances.capitalEvolution.data.labels = filteredDates;
        chartInstances.capitalEvolution.data.datasets[0].data = filteredCapital;
    } else {
        chartInstances.capitalEvolution.data.labels = dates;
        chartInstances.capitalEvolution.data.datasets[0].data = capitalHistory;
    }
    
    // Ajuster les couleurs en fonction de la tendance
    if (capitalHistory.length > 1) {
        const firstValue = capitalHistory[0];
        const lastValue = capitalHistory[capitalHistory.length - 1];
        const percentageChange = ((lastValue - firstValue) / firstValue) * 100;
        
        // Vérifier si le mode sombre est activé
        const isDarkMode = document.body.classList.contains('dark-mode');
        
        // Ajuster les couleurs en fonction de la performance
        if (percentageChange > 0) {
            // Tendance positive
            chartInstances.capitalEvolution.data.datasets[0].backgroundColor = isDarkMode 
                ? chartColors.dark.greenTransparent 
                : chartColors.greenTransparent;
            chartInstances.capitalEvolution.data.datasets[0].borderColor = isDarkMode 
                ? chartColors.dark.green 
                : chartColors.green;
            chartInstances.capitalEvolution.data.datasets[0].pointBackgroundColor = isDarkMode 
                ? chartColors.dark.green 
                : chartColors.green;
        } else {
            // Tendance négative
            chartInstances.capitalEvolution.data.datasets[0].backgroundColor = isDarkMode 
                ? chartColors.dark.redTransparent 
                : chartColors.redTransparent;
            chartInstances.capitalEvolution.data.datasets[0].borderColor = isDarkMode 
                ? chartColors.dark.red 
                : chartColors.red;
            chartInstances.capitalEvolution.data.datasets[0].pointBackgroundColor = isDarkMode 
                ? chartColors.dark.red 
                : chartColors.red;
        }
    }
    
    // Animations pour une mise à jour fluide
    chartInstances.capitalEvolution.options.animation = {
        duration: 800,
        easing: 'easeOutQuad'
    };
    
    chartInstances.capitalEvolution.update('show');
}

// Fonction pour mettre à jour le graphique des profits de simulation
function updateSimulationProfitChart(trades) {
    if (!chartInstances.simulationProfit || !trades || trades.length === 0) return;
    
    // Trier les transactions par date (croissante)
    const sortedTrades = [...trades].sort((a, b) => {
        return new Date(a.timestamp) - new Date(b.timestamp);
    });
    
    // Calculer le profit cumulatif
    let cumulativeProfit = 0;
    const profitData = [];
    const labels = [];
    
    sortedTrades.forEach((trade, index) => {
        cumulativeProfit += trade.profit;
        profitData.push(cumulativeProfit);
        
        // Formatage de la date pour les labels
        const date = new Date(trade.timestamp);
        const formattedDate = date.toLocaleDateString('fr-FR', {
            month: 'short',
            day: 'numeric'
        });
        
        // Afficher moins de labels pour éviter l'encombrement
        if (index % Math.max(1, Math.floor(sortedTrades.length / 15)) === 0) {
            labels.push(formattedDate);
        } else {
            labels.push('');
        }
    });
    
    chartInstances.simulationProfit.data.labels = labels;
    chartInstances.simulationProfit.data.datasets[0].data = profitData;
    
    // Vérifier si le mode sombre est activé
    const isDarkMode = document.body.classList.contains('dark-mode');
    
    // Ajuster les couleurs en fonction de la tendance finale
    if (profitData.length > 0) {
        const finalProfit = profitData[profitData.length - 1];
        
        if (finalProfit > 0) {
            chartInstances.simulationProfit.data.datasets[0].backgroundColor = isDarkMode 
                ? chartColors.dark.greenTransparent 
                : chartColors.greenTransparent;
            chartInstances.simulationProfit.data.datasets[0].borderColor = isDarkMode 
                ? chartColors.dark.green 
                : chartColors.green;
            chartInstances.simulationProfit.data.datasets[0].pointBackgroundColor = isDarkMode 
                ? chartColors.dark.green 
                : chartColors.green;
        } else {
            chartInstances.simulationProfit.data.datasets[0].backgroundColor = isDarkMode 
                ? chartColors.dark.redTransparent 
                : chartColors.redTransparent;
            chartInstances.simulationProfit.data.datasets[0].borderColor = isDarkMode 
                ? chartColors.dark.red 
                : chartColors.red;
            chartInstances.simulationProfit.data.datasets[0].pointBackgroundColor = isDarkMode 
                ? chartColors.dark.red 
                : chartColors.red;
        }
    }
    
    // Mettre à jour le titre du graphique avec le profit total
    if (profitData.length > 0) {
        const finalProfit = profitData[profitData.length - 1];
        const profitPercentage = sortedTrades[0].entryPrice && sortedTrades[0].amount
            ? (finalProfit / (sortedTrades[0].entryPrice * sortedTrades[0].amount)) * 100
            : 0;
        
        chartInstances.simulationProfit.options.plugins.title.text = 
            `Évolution du profit: ${formatCurrency(finalProfit)} (${profitPercentage.toFixed(2)}%)`;
    }
    
    // Animer la transition
    chartInstances.simulationProfit.options.animation = {
        duration: 1000,
        easing: 'easeOutCubic'
    };
    
    chartInstances.simulationProfit.update('show');
}

// Créer un graphique comparatif entre plusieurs périodes
function createComparisonChart(containerId, periods, data) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    
    // Détruire le graphique existant s'il y en a un
    if (container.chart) {
        container.chart.destroy();
    }
    
    const ctx = container.getContext('2d');
    
    // Vérifier si le mode sombre est activé
    const isDarkMode = document.body.classList.contains('dark-mode');
    
    // Préparer les datasets pour chaque période
    const datasets = periods.map((period, index) => {
        const colorKeys = Object.keys(chartColors).filter(key => !key.includes('Transparent') && key !== 'dark');
        const colorKey = colorKeys[index % colorKeys.length];
        const color = isDarkMode && chartColors.dark[colorKey] 
            ? chartColors.dark[colorKey] 
            : chartColors[colorKey];
        const transparentColor = isDarkMode && chartColors.dark[colorKey + 'Transparent'] 
            ? chartColors.dark[colorKey + 'Transparent'] 
            : chartColors[colorKey + 'Transparent'] || color.replace('1)', '0.2)');
        
        return {
            label: period.label,
            data: period.data,
            borderColor: color,
            backgroundColor: transparentColor,
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            pointRadius: 3,
            pointHoverRadius: 5
        };
    });
    
    // Créer le graphique
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 6,
                        color: isDarkMode ? chartColors.dark.text : '#6c757d'
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: isDarkMode ? 'rgba(45, 55, 72, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: isDarkMode ? '#fff' : '#6c757d',
                    bodyColor: isDarkMode ? '#fff' : '#6c757d',
                    borderColor: isDarkMode ? 'rgba(74, 85, 104, 1)' : 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 4
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        drawBorder: false,
                        color: isDarkMode ? chartColors.dark.grid : 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        color: isDarkMode ? chartColors.dark.text : '#6c757d',
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: isDarkMode ? chartColors.dark.text : '#6c757d',
                        maxTicksLimit: 10,
                        maxRotation: 0,
                        minRotation: 0
                    }
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
    
    // Stocker l'instance du graphique pour pouvoir le détruire plus tard
    container.chart = chart;
    
    return chart;
}

// Créer un graphique de distribution des profits/pertes
function createProfitDistributionChart(containerId, profitData) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    
    // Détruire le graphique existant s'il y en a un
    if (container.chart) {
        container.chart.destroy();
    }
    
    const ctx = container.getContext('2d');
    
    // Vérifier si le mode sombre est activé
    const isDarkMode = document.body.classList.contains('dark-mode');
    
    // Analyse des données pour créer des buckets
    const buckets = createHistogramBuckets(profitData, 10);
    
    // Créer le graphique
    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: buckets.labels,
            datasets: [{
                label: 'Distribution des profits',
                data: buckets.counts,
                backgroundColor: buckets.labels.map(label => {
                    const value = parseFloat(label.split(' - ')[0]);
                    return value >= 0 
                        ? (isDarkMode ? chartColors.dark.greenTransparent : chartColors.greenTransparent)
                        : (isDarkMode ? chartColors.dark.redTransparent : chartColors.redTransparent);
                }),
                borderColor: buckets.labels.map(label => {
                    const value = parseFloat(label.split(' - ')[0]);
                    return value >= 0 
                        ? (isDarkMode ? chartColors.dark.green : chartColors.green)
                        : (isDarkMode ? chartColors.dark.red : chartColors.red);
                }),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: isDarkMode ? 'rgba(45, 55, 72, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: isDarkMode ? '#fff' : '#6c757d',
                    bodyColor: isDarkMode ? '#fff' : '#6c757d',
                    borderColor: isDarkMode ? 'rgba(74, 85, 104, 1)' : 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 4,
                    callbacks: {
                        title: function(tooltipItems) {
                            return tooltipItems[0].label;
                        },
                        label: function(context) {
                            return `Nombre de trades: ${context.raw}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Nombre de trades',
                        color: isDarkMode ? chartColors.dark.text : '#6c757d'
                    },
                    grid: {
                        drawBorder: false,
                        color: isDarkMode ? chartColors.dark.grid : 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        precision: 0,
                        color: isDarkMode ? chartColors.dark.text : '#6c757d'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Plage de profit (%)',
                        color: isDarkMode ? chartColors.dark.text : '#6c757d'
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: isDarkMode ? chartColors.dark.text : '#6c757d',
                        maxRotation: 45,
                        minRotation: 0
                    }
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
    
    // Stocker l'instance du graphique pour pouvoir la détruire plus tard
    container.chart = chart;
    
    return chart;
}

// Fonction utilitaire pour créer des buckets pour l'histogramme
function createHistogramBuckets(data, numBuckets) {
    if (data.length === 0) return { labels: [], counts: [] };
    
    // Trouver min et max
    const min = Math.min(...data);
    const max = Math.max(...data);
    
    // Calculer la taille d'un bucket
    const range = max - min;
    const bucketSize = range / numBuckets;
    
    // Créer les buckets
    const buckets = Array(numBuckets).fill(0);
    const bucketLabels = [];
    
    // Configurer les labels
    for (let i = 0; i < numBuckets; i++) {
        const lowerBound = min + i * bucketSize;
        const upperBound = min + (i + 1) * bucketSize;
        bucketLabels.push(`${lowerBound.toFixed(2)}% - ${upperBound.toFixed(2)}%`);
    }
    
    // Compter les occurrences
    data.forEach(value => {
        if (value === max) {
            // Cas spécial pour la valeur maximale
            buckets[numBuckets - 1]++;
        } else {
            const bucketIndex = Math.floor((value - min) / bucketSize);
            buckets[bucketIndex]++;
        }
    });
    
    return {
        labels: bucketLabels,
        counts: buckets
    };
}

// Fonction utilitaire pour formater la monnaie
function formatCurrency(value) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

// Exportation de fonctions pour une utilisation externe
window.chartUtils = {
    updateDailyPerformanceChart,
    updateTradesDistributionChart,
    updateCapitalEvolutionChart,
    updateSimulationProfitChart,
    createComparisonChart,
    createProfitDistributionChart,
    updateChartsForDarkMode
};