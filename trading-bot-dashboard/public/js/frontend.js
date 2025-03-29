// frontend.js - Combined app.js and charts.js
const TradingDashboard = (function() {
    // Configuration
    const config = {
      API_BASE_URL: window.location.origin + '/api',
      UPDATE_INTERVAL: 10000
    };
  
    // State management
    const state = {
      isRunning: false,
      darkMode: localStorage.getItem('darkMode') === 'true',
      performanceData: null,
      dailyPerformanceData: [],
      recentTrades: [],
      csrfToken: null,
      chartInstances: {},
      userSettings: JSON.parse(localStorage.getItem('userSettings') || '{}')
    };
  
    // DOM elements cache
    const dom = {};
  
    // Chart colors
    const chartColors = {
      blue: 'rgba(54, 162, 235, 1)',
      blueTransparent: 'rgba(54, 162, 235, 0.2)',
      green: 'rgba(75, 192, 192, 1)',
      greenTransparent: 'rgba(75, 192, 192, 0.2)',
      red: 'rgba(255, 99, 132, 1)',
      redTransparent: 'rgba(255, 99, 132, 0.2)',
      yellow: 'rgba(255, 206, 86, 1)',
      purple: 'rgba(153, 102, 255, 1)',
      dark: {
        background: 'rgba(40, 44, 52, 1)',
        text: 'rgba(248, 249, 250, 1)',
        grid: 'rgba(255, 255, 255, 0.1)',
        green: 'rgba(105, 240, 174, 1)',
        greenTransparent: 'rgba(105, 240, 174, 0.2)',
        red: 'rgba(255, 99, 132, 1)',
        redTransparent: 'rgba(255, 99, 132, 0.2)',
        blue: 'rgba(100, 181, 246, 1)',
        blueTransparent: 'rgba(100, 181, 246, 0.2)'
      }
    };
  
    // Socket connection
    let socket;
  
    // Initialization
    function init() {
      cacheDomElements();
      checkAuthentication().then(authenticated => {
        if (authenticated) {
          applyTheme();
          addLogoutButton();
          initEventListeners();
          initCharts();
          fetchData();
          initSocketConnection();
          setupAutoUpdates();
        }
      });
    }
  
    // Cache DOM elements for performance
    function cacheDomElements() {
      const elements = [
        'startBotBtn', 'stopBotBtn', 'botStatus', 'botStatusText', 
        'capitalValue', 'totalProfitValue', 'winRateValue', 'winRateMetricValue', 
        'totalTradesValue', 'winningTradesValue', 'losingTradesValue', 
        'avgProfitValue', 'avgLossValue', 'biggestWinValue', 'biggestLossValue', 
        'tradesTableBody', 'refreshTradesBtn', 'exportTradesBtn', 'currentDateTime', 
        'runSimulationBtn', 'startDateInput', 'endDateInput', 'simulationResults', 
        'paginationContainer', 'darkModeToggle', 'userInfo'
      ];
  
      elements.forEach(id => {
        dom[id] = document.getElementById(id);
      });
    }
  
    // Authentication check
    async function checkAuthentication() {
      try {
        const response = await fetch(`${config.API_BASE_URL}/verify-auth`, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          window.location.href = '/login.html';
          return false;
        }
        
        const data = await response.json();
        updateUserInfo(data.user);
        return data.authenticated;
      } catch (error) {
        console.error('Authentication error:', error);
        window.location.href = '/login.html';
        return false;
      }
    }
  
    // Update user info display
    function updateUserInfo(user) {
      if (dom.userInfo && user) {
        dom.userInfo.textContent = `${user.username} (${user.role})`;
      }
    }
  
    // Add logout button
    function addLogoutButton() {
      const navbarNav = document.querySelector('.navbar-nav.ms-auto');
      
      if (navbarNav) {
        const logoutItem = document.createElement('li');
        logoutItem.className = 'nav-item';
        
        const logoutButton = document.createElement('button');
        logoutButton.id = 'logoutBtn';
        logoutButton.className = 'btn btn-outline-light ms-2';
        logoutButton.textContent = 'Déconnexion';
        
        logoutButton.addEventListener('click', logout);
        
        logoutItem.appendChild(logoutButton);
        navbarNav.appendChild(logoutItem);
      }
    }
  
    // Logout function
    async function logout() {
      try {
        const token = await fetchCsrfToken();
        
        const response = await fetch(`${config.API_BASE_URL}/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token
          },
          credentials: 'include'
        });
        
        if (response.ok) {
          if (socket) socket.disconnect();
          window.location.href = '/login.html';
        }
      } catch (error) {
        console.error('Logout error:', error);
        showError('Erreur lors de la déconnexion');
      }
    }
  
    // Initialize Socket.IO connection
    function initSocketConnection() {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('token='))
        ?.split('=')[1];
      
      if (!token) {
        console.warn('No token found for Socket.IO');
        return;
      }
      
      socket = io({
        auth: { token }
      });
      
      socket.on('connect', () => console.log('Socket connected'));
      socket.on('disconnect', () => console.log('Socket disconnected'));
      
      socket.on('auth_error', (data) => {
        console.error('Socket auth error:', data);
        showError('Session expirée. Veuillez vous reconnecter.');
        setTimeout(() => window.location.href = '/login.html', 3000);
      });
      
      socket.on('bot_status', (data) => updateBotStatus(data.isRunning));
      socket.on('bot_status_change', (data) => updateBotStatus(data.isRunning));
      
      socket.on('bot_update', (data) => {
        if (data.report) updatePerformanceUI(data.report);
        
        if (data.recentTrades && data.recentTrades.length > 0) {
          const currentTrades = new Set(state.recentTrades.map(t => t.id));
          const newTrades = data.recentTrades.filter(t => !currentTrades.has(t.id));
          
          if (newTrades.length > 0) {
            state.recentTrades = [...newTrades, ...state.recentTrades].slice(0, 50);
            updateTradesTable();
            showNotification('Nouvelle transaction', `${newTrades.length} nouvelle(s) transaction(s)`);
          }
        }
      });
      
      socket.emit('request_update');
    }
  
    // Initialize event listeners
    function initEventListeners() {
      // Navigation
      document.querySelectorAll('a.nav-link').forEach(link => {
        link.addEventListener('click', handleNavigation);
      });
      
      // Button events
      if (dom.startBotBtn) dom.startBotBtn.addEventListener('click', startBot);
      if (dom.stopBotBtn) dom.stopBotBtn.addEventListener('click', stopBot);
      if (dom.refreshTradesBtn) dom.refreshTradesBtn.addEventListener('click', fetchRecentTrades);
      if (dom.exportTradesBtn) dom.exportTradesBtn.addEventListener('click', exportTradingLogs);
      if (dom.runSimulationBtn) dom.runSimulationBtn.addEventListener('click', runSimulation);
      
      // Dark mode toggle
      if (dom.darkModeToggle) {
        dom.darkModeToggle.addEventListener('click', toggleDarkMode);
      }
      
      // State change event
      document.addEventListener('stateChange', (event) => {
        const { key, value } = event.detail;
        if (key === 'darkMode') applyTheme();
      });
      
      // Network error handling
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        try {
          const response = await originalFetch(...args);
          
          if (response.status === 401 && !args[0].includes('/api/verify-auth')) {
            showSessionExpiredModal();
          }
          
          if (response.status === 403 && args[0].includes('/api/')) {
            const data = await response.clone().json();
            if (data.code === 'CSRF_ERROR') {
              showError('Session expirée. Actualisation en cours...');
              setTimeout(() => window.location.reload(), 2000);
            } else {
              showError('Accès refusé. Vérifiez vos autorisations.');
            }
          }
          
          return response;
        } catch (error) {
          if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
            showError('Erreur de connexion au serveur.');
          }
          throw error;
        }
      };
    }
  
    // Fetch CSRF Token
    async function fetchCsrfToken() {
      if (state.csrfToken) return state.csrfToken;
      
      try {
        const response = await fetch(`${config.API_BASE_URL}/csrf-token`, {
          credentials: 'include'
        });
        
        if (!response.ok) throw new Error('CSRF token fetch failed');
        
        const data = await response.json();
        state.csrfToken = data.csrfToken;
        return state.csrfToken;
      } catch (error) {
        console.error('CSRF token error:', error);
        showError('Erreur de sécurité. Veuillez actualiser la page.');
        return null;
      }
    }
  
    // Initial data fetch
    function fetchData() {
      fetchBotStatus();
      fetchPerformanceData();
      fetchRecentTrades();
      fetchDailyPerformance();
    }
  
    // Set up automatic updates
    function setupAutoUpdates() {
      const intervals = [
        setInterval(fetchPerformanceData, config.UPDATE_INTERVAL),
        setInterval(fetchRecentTrades, config.UPDATE_INTERVAL * 3),
        setInterval(fetchDailyPerformance, config.UPDATE_INTERVAL * 6)
      ];
      
      window.addEventListener('beforeunload', () => {
        intervals.forEach(interval => clearInterval(interval));
        if (socket) socket.disconnect();
      });
    }
  
    // API FUNCTIONS
    
    async function fetchBotStatus() {
      try {
        const response = await fetch(`${config.API_BASE_URL}/status`, {
          credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Bot status fetch failed');
        
        const data = await response.json();
        updateBotStatus(data.isRunning);
      } catch (error) {
        console.error('Bot status error:', error);
        showError('Erreur lors de la récupération du statut');
      }
    }
    
    async function fetchPerformanceData() {
      try {
        const response = await fetch(`${config.API_BASE_URL}/performance`, {
          credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Performance data fetch failed');
        
        const data = await response.json();
        state.performanceData = data;
        updatePerformanceUI(data);
      } catch (error) {
        console.error('Performance data error:', error);
        showError('Erreur de données de performance');
      }
    }
    
    async function fetchRecentTrades(page = 1, limit = 50) {
      try {
        showLoading(dom.tradesTableBody);
        
        const offset = (page - 1) * limit;
        const response = await fetch(`${config.API_BASE_URL}/trades?limit=${limit}&offset=${offset}`, {
          credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Trades fetch failed');
        
        const data = await response.json();
        state.recentTrades = data.trades;
        
        updateTradesTable();
        updatePagination(data.pagination);
        updateTradesDistributionChart();
        
        return data;
      } catch (error) {
        console.error('Trades fetch error:', error);
        if (dom.tradesTableBody) {
          dom.tradesTableBody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Erreur de chargement</td></tr>';
        }
        return { trades: [], pagination: { total: 0 } };
      }
    }
    
    async function fetchDailyPerformance() {
      try {
        const response = await fetch(`${config.API_BASE_URL}/daily-performance?limit=30`, {
          credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Daily performance fetch failed');
        
        const data = await response.json();
        state.dailyPerformanceData = data.data;
        
        updateDailyPerformanceChart();
        updateCapitalEvolutionChart();
      } catch (error) {
        console.error('Daily performance error:', error);
        showError('Erreur de données de performance');
      }
    }
    
    async function startBot() {
      try {
        const token = await fetchCsrfToken();
        if (!token) throw new Error('CSRF token missing');
        
        const response = await fetch(`${config.API_BASE_URL}/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token
          },
          credentials: 'include'
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Bot start failed');
        }
        
        await response.json();
        showSuccess('Bot démarré avec succès');
        updateBotStatus(true);
      } catch (error) {
        console.error('Bot start error:', error);
        showError(error.message || 'Erreur lors du démarrage');
      }
    }
    
    async function stopBot() {
      try {
        const token = await fetchCsrfToken();
        if (!token) throw new Error('CSRF token missing');
        
        const response = await fetch(`${config.API_BASE_URL}/stop`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token
          },
          credentials: 'include'
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Bot stop failed');
        }
        
        await response.json();
        showSuccess('Bot arrêté avec succès');
        updateBotStatus(false);
        
        setTimeout(() => {
          fetchPerformanceData();
          fetchRecentTrades();
          fetchDailyPerformance();
        }, 1000);
      } catch (error) {
        console.error('Bot stop error:', error);
        showError(error.message || 'Erreur lors de l\'arrêt');
      }
    }
    
    async function exportTradingLogs() {
      try {
        const format = state.userSettings.exportFormat || 'json';
        const compress = state.userSettings.compressExport || false;
        
        window.open(`${config.API_BASE_URL}/export-logs?format=${format}&compress=${compress}`, '_blank');
      } catch (error) {
        console.error('Export error:', error);
        showError('Erreur lors de l\'exportation');
      }
    }
    
    async function runSimulation() {
      try {
        const token = await fetchCsrfToken();
        if (!token) throw new Error('CSRF token missing');
        
        const startDate = dom.startDateInput.value;
        const endDate = dom.endDateInput.value;
        
        if (!startDate || !endDate) {
          showError('Veuillez sélectionner des dates de début et de fin');
          return;
        }
        
        // Validate dates
        const start = new Date(startDate);
        const end = new Date(endDate);
        const now = new Date();
        
        if (start > end) {
          showError('La date de début doit être antérieure à la date de fin');
          return;
        }
        
        if (end > now) {
          showError('La date de fin ne peut pas être dans le futur');
          return;
        }
        
        if (end - start > 365 * 24 * 60 * 60 * 1000) {
          showError('La période ne peut pas dépasser 1 an');
          return;
        }
        
        showLoading(dom.simulationResults);
        dom.simulationResults.style.display = 'block';
        
        dom.runSimulationBtn.disabled = true;
        dom.runSimulationBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Simulation en cours...';
        
        const response = await fetch(`${config.API_BASE_URL}/simulation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token
          },
          body: JSON.stringify({ startDate, endDate }),
          credentials: 'include'
        });
        
        dom.runSimulationBtn.disabled = false;
        dom.runSimulationBtn.textContent = 'Lancer la Simulation';
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Simulation failed');
        }
        
        const data = await response.json();
        updateSimulationUI(data);
        showSuccess('Simulation terminée avec succès');
      } catch (error) {
        console.error('Simulation error:', error);
        dom.simulationResults.style.display = 'none';
        dom.runSimulationBtn.disabled = false;
        dom.runSimulationBtn.textContent = 'Lancer la Simulation';
        showError(error.message || 'Erreur de simulation');
      }
    }
  
    // UI UPDATES
  
    function updateBotStatus(isRunning) {
      state.isRunning = isRunning;
      
      if (dom.botStatus && dom.botStatusText) {
        if (isRunning) {
          dom.botStatus.classList.remove('offline');
          dom.botStatus.classList.add('online');
          dom.botStatusText.textContent = 'En ligne';
          
          if (dom.startBotBtn) dom.startBotBtn.disabled = true;
          if (dom.stopBotBtn) dom.stopBotBtn.disabled = false;
        } else {
          dom.botStatus.classList.remove('online');
          dom.botStatus.classList.add('offline');
          dom.botStatusText.textContent = 'Hors ligne';
          
          if (dom.startBotBtn) dom.startBotBtn.disabled = false;
          if (dom.stopBotBtn) dom.stopBotBtn.disabled = true;
        }
      }
    }
  
    function updatePerformanceUI(data) {
      if (!data || !data.metrics || !data.portfolioMetrics) return;
      
      const { metrics } = data;
      const portfolioMetrics = data.portfolioMetrics;
      
      // Update primary metrics with highlight effect
      const updateMetric = (element, value, format = 'currency', positive = null) => {
        if (!element) return;
        
        // Format the value
        let formattedValue;
        if (format === 'currency') {
          formattedValue = formatCurrency(value);
        } else if (format === 'percentage') {
          formattedValue = formatPercentage(value);
        } else {
          formattedValue = value.toString();
        }
        
        element.textContent = formattedValue;
        element.classList.add('highlight-update');
        setTimeout(() => element.classList.remove('highlight-update'), 1500);
        
        // Add profit/loss styling if applicable
        if (positive !== null) {
          if (positive) {
            element.classList.add('profit-positive');
            element.classList.remove('profit-negative');
          } else {
            element.classList.add('profit-negative');
            element.classList.remove('profit-positive');
          }
        }
      };
      
      updateMetric(dom.capitalValue, portfolioMetrics.currentCapital || 0);
      updateMetric(dom.totalProfitValue, metrics.totalProfit || 0, 'currency', metrics.totalProfit > 0);
      updateMetric(dom.winRateValue, metrics.winRate || 0, 'percentage');
      
      // Update detailed metrics
      if (dom.totalTradesValue) dom.totalTradesValue.textContent = metrics.totalTrades || 0;
      if (dom.winningTradesValue) dom.winningTradesValue.textContent = metrics.winningTrades || 0;
      if (dom.losingTradesValue) dom.losingTradesValue.textContent = metrics.losingTrades || 0;
      if (dom.winRateMetricValue) dom.winRateMetricValue.textContent = formatPercentage(metrics.winRate || 0);
      
      if (dom.avgProfitValue) dom.avgProfitValue.textContent = formatCurrency(metrics.averageWin || 0);
      if (dom.avgLossValue) dom.avgLossValue.textContent = formatCurrency(Math.abs(metrics.averageLoss || 0));
      if (dom.biggestWinValue) dom.biggestWinValue.textContent = formatCurrency(metrics.biggestWin || 0);
      if (dom.biggestLossValue) dom.biggestLossValue.textContent = formatCurrency(Math.abs(metrics.biggestLoss || 0));
    }
  
    function updateTradesTable() {
      if (!dom.tradesTableBody) return;
      
      if (!state.recentTrades || state.recentTrades.length === 0) {
        dom.tradesTableBody.innerHTML = '<tr><td colspan="10" class="text-center">Aucune transaction trouvée</td></tr>';
        return;
      }
      
      let html = '';
      
      state.recentTrades.forEach(trade => {
        const date = new Date(trade.timestamp).toLocaleString();
        const profitClass = trade.profit >= 0 ? 'profit-positive' : 'profit-negative';
        const holdingTimeHours = (trade.holdingPeriod / (1000 * 60 * 60)).toFixed(2);
        
        html += `
          <tr>
            <td>${date}</td>
            <td>${escapeHtml(trade.token)}</td>
            <td>${escapeHtml(trade.signal)}</td>
            <td>${trade.entryPrice ? trade.entryPrice.toFixed(6) : 'N/A'}</td>
            <td>${trade.exitPrice ? trade.exitPrice.toFixed(6) : 'N/A'}</td>
            <td>${trade.amount ? trade.amount.toFixed(2) : 'N/A'}</td>
            <td class="${profitClass}">${formatCurrency(trade.profit || 0)}</td>
            <td class="${profitClass}">${formatPercentage(trade.profitPercentage || 0)}</td>
            <td>${holdingTimeHours}h</td>
            <td><span class="badge bg-info">${trade.signalConfidence ? trade.signalConfidence.toFixed(2) : 'N/A'}</span></td>
          </tr>
        `;
      });
      
      dom.tradesTableBody.innerHTML = html;
    }
  
    function updatePagination(paginationData) {
      if (!dom.paginationContainer || !paginationData) return;
      
      const { total, limit, offset } = paginationData;
      const currentPage = Math.floor(offset / limit) + 1;
      const totalPages = Math.ceil(total / limit);
      
      let paginationHtml = '';
      
      if (totalPages > 1) {
        paginationHtml += `
          <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="1">&laquo;</a>
          </li>
        `;
        
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);
        
        for (let i = startPage; i <= endPage; i++) {
          paginationHtml += `
            <li class="page-item ${i === currentPage ? 'active' : ''}">
              <a class="page-link" href="#" data-page="${i}">${i}</a>
            </li>
          `;
        }
        
        paginationHtml += `
          <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${totalPages}">&raquo;</a>
          </li>
        `;
      }
      
      dom.paginationContainer.innerHTML = paginationHtml;
      
      // Add event listeners
      dom.paginationContainer.querySelectorAll('.page-link').forEach(link => {
        link.addEventListener('click', async (e) => {
          e.preventDefault();
          
          const page = parseInt(e.target.dataset.page);
          if (!isNaN(page)) {
            await fetchRecentTrades(page, limit);
          }
        });
      });
    }
  
    function updateSimulationUI(data) {
      if (!dom.simulationResults || !data || !data.metrics) {
        if (dom.simulationResults) {
          dom.simulationResults.style.display = 'none';
        }
        return;
      }
      
      const { metrics, trades } = data;
      
      // Update simulation metrics
      const simMetrics = {
        totalTradesValue: document.getElementById('simTotalTradesValue'),
        winningTradesValue: document.getElementById('simWinningTradesValue'),
        losingTradesValue: document.getElementById('simLosingTradesValue'),
        winRateValue: document.getElementById('simWinRateValue'),
        totalProfitValue: document.getElementById('simTotalProfitValue'),
        maxDrawdownValue: document.getElementById('simMaxDrawdownValue')
      };
      
      if (simMetrics.totalTradesValue) simMetrics.totalTradesValue.textContent = metrics.totalTrades || 0;
      if (simMetrics.winningTradesValue) simMetrics.winningTradesValue.textContent = metrics.winningTrades || 0;
      if (simMetrics.losingTradesValue) simMetrics.losingTradesValue.textContent = metrics.losingTrades || 0;
      if (simMetrics.winRateValue) simMetrics.winRateValue.textContent = formatPercentage(metrics.winRate || 0);
      if (simMetrics.totalProfitValue) simMetrics.totalProfitValue.textContent = formatCurrency(metrics.totalProfit || 0);
      if (simMetrics.maxDrawdownValue) simMetrics.maxDrawdownValue.textContent = formatPercentage(metrics.maxDrawdown || 0);
      
      // Update simulation chart
      updateSimulationProfitChart(trades);
    }
  
    function handleNavigation(e) {
      e.preventDefault();
      
      const targetId = e.target.getAttribute('href').substring(1);
      
      // Update active navigation
      document.querySelectorAll('a.nav-link').forEach(link => {
        link.classList.remove('active');
      });
      
      e.target.classList.add('active');
      
      // Show/hide simulation section
      if (targetId === 'simulation') {
        const simulationSection = document.getElementById('simulationSection');
        if (simulationSection) simulationSection.style.display = 'block';
      } else {
        const simulationSection = document.getElementById('simulationSection');
        if (simulationSection) simulationSection.style.display = 'none';
      }
    }
  
    // CHART FUNCTIONS
    
    function initCharts() {
      initDailyPerformanceChart();
      initTradesDistributionChart();
      initCapitalEvolutionChart();
      initSimulationProfitChart();
    }
    
    function initDailyPerformanceChart() {
      const ctx = document.getElementById('dailyPerformanceChart')?.getContext('2d');
      if (!ctx) return;
      
      state.chartInstances.dailyPerformance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
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
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: { usePointStyle: true, boxWidth: 6 }
            },
            tooltip: {
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              titleColor: '#6c757d',
              bodyColor: '#6c757d',
              borderColor: 'rgba(0, 0, 0, 0.1)',
              borderWidth: 1,
              callbacks: {
                label: context => `Profit: ${formatCurrency(context.raw)}`
              }
            }
          },
          scales: {
            y: {
              grid: { color: 'rgba(0, 0, 0, 0.05)' },
              ticks: { callback: value => formatCurrency(value) }
            },
            x: {
              grid: { display: false },
              ticks: { maxRotation: 0, minRotation: 0, maxTicksLimit: 10 }
            }
          },
          animation: { duration: 1000, easing: 'easeOutQuart' }
        }
      });
    }
    
    function initTradesDistributionChart() {
      const ctx = document.getElementById('tradesDistributionChart')?.getContext('2d');
      if (!ctx) return;
      
      state.chartInstances.tradesDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Gagnants', 'Perdants'],
          datasets: [{
            data: [0, 0],
            backgroundColor: [chartColors.greenTransparent, chartColors.redTransparent],
            borderColor: [chartColors.green, chartColors.red],
            borderWidth: 1,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '70%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { usePointStyle: true, padding: 15, boxWidth: 8 }
            },
            tooltip: {
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              callbacks: {
                label: context => {
                  const value = context.raw;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = total > 0 ? (value / total * 100).toFixed(1) + '%' : '0%';
                  return `${context.label}: ${value} (${percentage})`;
                }
              }
            }
          }
        }
      });
      
      // Add center text
      const originalDraw = state.chartInstances.tradesDistribution.draw;
      state.chartInstances.tradesDistribution.draw = function() {
        originalDraw.apply(this, arguments);
        
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
    
    function initCapitalEvolutionChart() {
      const ctx = document.getElementById('capitalEvolutionChart')?.getContext('2d');
      if (!ctx) return;
      
      state.chartInstances.capitalEvolution = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Capital (USD)',
            data: [],
            backgroundColor: chartColors.blueTransparent,
            borderColor: chartColors.blue,
            borderWidth: 2,
            pointRadius: 3,
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                label: context => `Capital: ${formatCurrency(context.raw)}`
              }
            }
          },
          scales: {
            y: {
              grid: { color: 'rgba(0, 0, 0, 0.05)' },
              ticks: { callback: value => formatCurrency(value) }
            },
            x: {
              grid: { display: false },
              ticks: { maxTicksLimit: 10, maxRotation: 0 }
            }
          }
        }
      });
    }
    
    function initSimulationProfitChart() {
      const ctx = document.getElementById('simulationProfitChart')?.getContext('2d');
      if (!ctx) return;
      
      state.chartInstances.simulationProfit = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Profit cumulé (USD)',
            data: [],
            backgroundColor: chartColors.purpleTransparent,
            borderColor: chartColors.purple,
            borderWidth: 2,
            pointRadius: 2,
            fill: true,
            tension: 0.2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: 'Évolution du profit durant la simulation',
              font: { size: 16, weight: 'bold' }
            },
            tooltip: {
              callbacks: {
                label: context => `Profit: ${formatCurrency(context.raw)}`
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { callback: value => formatCurrency(value) }
            },
            x: {
              ticks: { maxTicksLimit: 8, maxRotation: 0 }
            }
          }
        }
      });
    }
    
    function updateDailyPerformanceChart() {
      const chart = state.chartInstances.dailyPerformance;
      const data = state.dailyPerformanceData;
      
      if (!chart || !data || data.length === 0) return;
      
      const recentData = data.slice(-30);
      
      chart.data.labels = recentData.map(day => day.date);
      chart.data.datasets[0].data = recentData.map(day => day.profit);
      
      chart.update('show');
    }
    
    function updateTradesDistributionChart() {
      const chart = state.chartInstances.tradesDistribution;
      const data = state.performanceData?.metrics;
      
      if (!chart || !data) return;
      
      chart.data.datasets[0].data = [data.winningTrades || 0, data.losingTrades || 0];
      chart.update('show');
    }
    
    function updateCapitalEvolutionChart() {
      const chart = state.chartInstances.capitalEvolution;
      const data = state.dailyPerformanceData;
      const performanceData = state.performanceData;
      
      if (!chart || !data || data.length === 0) return;
      
      // Calculate capital evolution
      let capital = performanceData?.portfolioMetrics?.initialCapital || 10000;
      let capitalHistory = [];
      const dates = [];
      
      // Sort by date (ascending)
      const sortedData = [...data].sort((a, b) => {
        return new Date(a.date) - new Date(b.date);
      });
      
      // Build capital history
      for (const day of sortedData) {
        capital += day.profit;
        capitalHistory.push(capital);
        dates.push(day.date);
      }
      
      // Limit points for better display
      if (dates.length > 20) {
        const step = Math.ceil(dates.length / 20);
        const filteredDates = dates.filter((_, i) => i % step === 0);
        const filteredCapital = capitalHistory.filter((_, i) => i % step === 0);
        
        chart.data.labels = filteredDates;
        chart.data.datasets[0].data = filteredCapital;
      } else {
        chart.data.labels = dates;
        chart.data.datasets[0].data = capitalHistory;
      }
      
      // Set colors based on trend
      if (capitalHistory.length > 1) {
        const isPositive = capitalHistory[capitalHistory.length - 1] > capitalHistory[0];
        const isDarkMode = state.darkMode;
        
        chart.data.datasets[0].backgroundColor = isPositive 
          ? (isDarkMode ? chartColors.dark.greenTransparent : chartColors.greenTransparent)
          : (isDarkMode ? chartColors.dark.redTransparent : chartColors.redTransparent);
          
        chart.data.datasets[0].borderColor = isPositive 
          ? (isDarkMode ? chartColors.dark.green : chartColors.green)
          : (isDarkMode ? chartColors.dark.red : chartColors.red);
      }
      
      chart.update('show');
    }
    
    function updateSimulationProfitChart(trades) {
      const chart = state.chartInstances.simulationProfit;
      
      if (!chart || !trades || trades.length === 0) return;
      
      // Sort trades by timestamp
      const sortedTrades = [...trades].sort((a, b) => {
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      
      // Calculate cumulative profit
      let cumulativeProfit = 0;
      const profitData = [];
      const labels = [];
      
      sortedTrades.forEach((trade, index) => {
        cumulativeProfit += trade.profit;
        profitData.push(cumulativeProfit);
        
        // Format date for labels
        const date = new Date(trade.timestamp);
        const formattedDate = date.toLocaleDateString('fr-FR', {
          month: 'short',
          day: 'numeric'
        });
        
        // Show fewer labels to avoid crowding
        labels.push(index % Math.max(1, Math.floor(sortedTrades.length / 15)) === 0 ? formattedDate : '');
      });
      
      chart.data.labels = labels;
      chart.data.datasets[0].data = profitData;
      
      // Adjust colors based on trend
      const finalProfit = profitData[profitData.length - 1];
      const isDarkMode = state.darkMode;
      
      if (finalProfit > 0) {
        chart.data.datasets[0].backgroundColor = isDarkMode ? chartColors.dark.greenTransparent : chartColors.greenTransparent;
        chart.data.datasets[0].borderColor = isDarkMode ? chartColors.dark.green : chartColors.green;
      } else {
        chart.data.datasets[0].backgroundColor = isDarkMode ? chartColors.dark.redTransparent : chartColors.redTransparent;
        chart.data.datasets[0].borderColor = isDarkMode ? chartColors.dark.red : chartColors.red;
      }
      
      // Update chart title with profit info
      if (profitData.length > 0) {
        chart.options.plugins.title.text = `Évolution du profit: ${formatCurrency(finalProfit)}`;
      }
      
      chart.update('show');
    }
    
    function updateChartsForDarkMode(isDarkMode) {
      const textColor = isDarkMode ? chartColors.dark.text : '#6c757d';
      const gridColor = isDarkMode ? chartColors.dark.grid : 'rgba(0, 0, 0, 0.1)';
      
      Chart.defaults.color = textColor;
      
      // Update each chart
      Object.values(state.chartInstances).forEach(chart => {
        if (!chart) return;
        
        // Update scale colors
        if (chart.options.scales?.y) {
          chart.options.scales.y.grid.color = gridColor;
          chart.options.scales.y.ticks.color = textColor;
        }
        
        if (chart.options.scales?.x) {
          chart.options.scales.x.grid.color = gridColor;
          chart.options.scales.x.ticks.color = textColor;
        }
        
        // Update legend text color
        if (chart.options.plugins?.legend) {
          chart.options.plugins.legend.labels.color = textColor;
        }
        
        // Update tooltip colors
        if (chart.options.plugins?.tooltip) {
          chart.options.plugins.tooltip.titleColor = isDarkMode ? '#fff' : '#6c757d';
          chart.options.plugins.tooltip.bodyColor = isDarkMode ? '#fff' : '#6c757d';
          chart.options.plugins.tooltip.backgroundColor = isDarkMode ? 'rgba(45, 55, 72, 0.9)' : 'rgba(255, 255, 255, 0.9)';
          chart.options.plugins.tooltip.borderColor = isDarkMode ? 'rgba(74, 85, 104, 1)' : 'rgba(0, 0, 0, 0.1)';
        }
        
        // Update daily performance chart colors
        if (chart === state.chartInstances.dailyPerformance) {
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
        
        // Update trades distribution chart colors
        if (chart === state.chartInstances.tradesDistribution) {
          chart.data.datasets[0].backgroundColor = [
            isDarkMode ? chartColors.dark.greenTransparent : chartColors.greenTransparent,
            isDarkMode ? chartColors.dark.redTransparent : chartColors.redTransparent
          ];
          
          chart.data.datasets[0].borderColor = [
            isDarkMode ? chartColors.dark.green : chartColors.green,
            isDarkMode ? chartColors.dark.red : chartColors.red
          ];
        }
        
        chart.update();
      });
    }
  
    // THEME & DISPLAY UTILITIES
    
    function toggleDarkMode() {
      state.darkMode = !state.darkMode;
      localStorage.setItem('darkMode', state.darkMode);
      
      // Dispatch state change event
      document.dispatchEvent(new CustomEvent('stateChange', { 
        detail: { key: 'darkMode', value: state.darkMode }
      }));
    }
    
    function applyTheme() {
      if (state.darkMode) {
        document.body.classList.add('dark-mode');
        if (dom.darkModeToggle) {
          dom.darkModeToggle.classList.add('dark');
        }
      } else {
        document.body.classList.remove('dark-mode');
        if (dom.darkModeToggle) {
          dom.darkModeToggle.classList.remove('dark');
        }
      }
      
      updateChartsForDarkMode(state.darkMode);
    }
    
    // Utility functions
    
    function formatCurrency(value) {
      if (value === undefined || value === null) return 'N/A';
      
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    }
    
    function formatPercentage(value) {
      if (value === undefined || value === null) return 'N/A';
      
      return new Intl.NumberFormat('fr-FR', {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value / 100);
    }
    
    function escapeHtml(str) {
      if (typeof str !== 'string') return str;
      
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
    
    function showLoading(element) {
      if (!element) return;
      
      if (element === dom.simulationResults) {
        element.innerHTML = `
          <div class="d-flex justify-content-center align-items-center p-5">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Chargement...</span>
            </div>
            <span class="ms-3">Exécution de la simulation...</span>
          </div>
        `;
      } else if (element === dom.tradesTableBody) {
        element.innerHTML = `
          <tr>
            <td colspan="10" class="text-center">
              <div class="spinner-border spinner-border-sm text-primary" role="status">
                <span class="visually-hidden">Chargement...</span>
              </div>
              Chargement des données...
            </td>
          </tr>
        `;
      }
    }
    
    function showSuccess(message) {
      showToast(message, 'success');
    }
    
    function showError(message) {
      showToast(message, 'danger');
    }
    
    function showToast(message, type = 'info') {
      const toastContainer = document.getElementById('toastContainer') || createToastContainer();
      
      const toast = document.createElement('div');
      toast.className = 'toast show';
      toast.setAttribute('role', 'alert');
      
      const bgColor = type === 'success' ? 'bg-success' : type === 'danger' ? 'bg-danger' : 'bg-info';
      
      toast.innerHTML = `
        <div class="toast-header ${bgColor} text-white">
          <strong class="me-auto">${type === 'success' ? 'Succès' : type === 'danger' ? 'Erreur' : 'Info'}</strong>
          <small>${new Date().toLocaleTimeString()}</small>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
          ${escapeHtml(message)}
        </div>
      `;
      
      toastContainer.appendChild(toast);
      
      // Auto-close after 5 seconds
      setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 500);
      }, 5000);
      
      // Add click handler to close button
      const closeBtn = toast.querySelector('.btn-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          toast.classList.add('hiding');
          setTimeout(() => toast.remove(), 500);
        });
      }
    }
    
    function createToastContainer() {
      const container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container position-fixed top-0 end-0 p-3';
      container.style.zIndex = '1050';
      document.body.appendChild(container);
      return container;
    }
    
    function showSessionExpiredModal() {
      // Create modal if it doesn't exist
      let modal = document.getElementById('sessionExpiredModal');
      
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sessionExpiredModal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        
        modal.innerHTML = `
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header bg-danger text-white">
                <h5 class="modal-title">Session expirée</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">
                <p>Votre session a expiré. Veuillez vous reconnecter pour continuer.</p>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-primary" id="redirectLoginBtn">Se reconnecter</button>
              </div>
            </div>
          </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add click handler to redirect button
        const redirectBtn = document.getElementById('redirectLoginBtn');
        if (redirectBtn) {
          redirectBtn.addEventListener('click', () => {
            window.location.href = '/login.html';
          });
        }
      }
      
      // Show the modal
      const bsModal = new bootstrap.Modal(modal);
      bsModal.show();
    }
    
    function showNotification(title, message) {
      // Try browser notifications if allowed
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(title, { body: message });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              new Notification(title, { body: message });
            }
          });
        }
      }
      
      // Always show a toast notification
      showSuccess(message);
    }
    
    function updateClock() {
      if (dom.currentDateTime) {
        dom.currentDateTime.textContent = new Date().toLocaleString();
      }
    }
    
    // Initialize date fields for simulation
    function initSimulationDates() {
      if (dom.startDateInput && dom.endDateInput) {
        const today = new Date();
        const lastMonth = new Date();
        lastMonth.setMonth(today.getMonth() - 1);
        
        dom.startDateInput.value = formatDateISOString(lastMonth);
        dom.endDateInput.value = formatDateISOString(today);
      }
    }
    
    function formatDateISOString(date) {
      return date.toISOString().split('T')[0];
    }
  
    // Public API
    return {
      init,
      startBot,
      stopBot,
      toggleDarkMode,
      refreshData: function() {
        fetchBotStatus();
        fetchPerformanceData();
        fetchRecentTrades();
        fetchDailyPerformance();
      }
    };
  })();
  
  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    TradingDashboard.init();
    
    // Initialize clock
    function updateClock() {
      const now = new Date();
      const clockElement = document.getElementById('currentDateTime');
      if (clockElement) {
        clockElement.textContent = now.toLocaleString();
      }
    }
    
    updateClock();
    setInterval(updateClock, 1000);
    
    // Export buttons
    document.getElementById('exportJsonBtn')?.addEventListener('click', () => {
      window.open('/api/export-logs?format=json', '_blank');
    });
    
    document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
      window.open('/api/export-logs?format=csv', '_blank');
    });
    
    document.getElementById('exportCompressedBtn')?.addEventListener('click', () => {
      window.open('/api/export-logs?format=json&compress=true', '_blank');
    });
  });