// app.js - Script principal pour le dashboard de trading

document.addEventListener('DOMContentLoaded', () => {
    // Configuration
    const API_BASE_URL = window.location.origin + '/api';
    const UPDATE_INTERVAL = 10000; // 10 secondes
    
    // État global avec stockage local
    const state = {
        isRunning: false,
        performanceData: null,
        dailyPerformanceData: [],
        recentTrades: [],
        csrfToken: null,
        darkMode: localStorage.getItem('darkMode') === 'true',
        userSettings: JSON.parse(localStorage.getItem('userSettings') || '{}'),
        
        // Méthodes pour manipuler l'état
        updateState(key, value) {
            this[key] = value;
            
            // Persister certaines valeurs dans localStorage
            if (['darkMode', 'userSettings'].includes(key)) {
                localStorage.setItem(key, typeof value === 'object' ? JSON.stringify(value) : value);
            }
            
            // Émettre un événement pour que l'UI puisse s'actualiser
            const event = new CustomEvent('stateChange', { detail: { key, value } });
            document.dispatchEvent(event);
        }
    };
    
    // Connexion Socket.IO pour les mises à jour en temps réel
    let socket;
    
    // Éléments du DOM
    const domElements = {
        startBotBtn: document.getElementById('startBotBtn'),
        stopBotBtn: document.getElementById('stopBotBtn'),
        botStatus: document.getElementById('botStatus'),
        botStatusText: document.getElementById('botStatusText'),
        capitalValue: document.getElementById('capitalValue'),
        totalProfitValue: document.getElementById('totalProfitValue'),
        winRateValue: document.getElementById('winRateValue'),
        winRateMetricValue: document.getElementById('winRateMetricValue'),
        totalTradesValue: document.getElementById('totalTradesValue'),
        winningTradesValue: document.getElementById('winningTradesValue'),
        losingTradesValue: document.getElementById('losingTradesValue'),
        avgProfitValue: document.getElementById('avgProfitValue'),
        avgLossValue: document.getElementById('avgLossValue'),
        biggestWinValue: document.getElementById('biggestWinValue'),
        biggestLossValue: document.getElementById('biggestLossValue'),
        tradesTableBody: document.getElementById('tradesTableBody'),
        refreshTradesBtn: document.getElementById('refreshTradesBtn'),
        exportTradesBtn: document.getElementById('exportTradesBtn'),
        currentDateTime: document.getElementById('currentDateTime'),
        runSimulationBtn: document.getElementById('runSimulationBtn'),
        startDateInput: document.getElementById('startDateInput'),
        endDateInput: document.getElementById('endDateInput'),
        simulationResults: document.getElementById('simulationResults'),
        paginationContainer: document.getElementById('tradesPagination'),
        darkModeToggle: document.getElementById('darkModeToggle'),
        userInfo: document.getElementById('userInfo')
    };
    
    // Initialisation de l'application
    async function initApp() {
        try {
            const authenticated = await checkAuthentication();
            
            if (authenticated) {
                // Configurer le thème
                applyTheme();
                
                // Ajouter un bouton de déconnexion
                addLogoutButton();
                
                // Initialisation des écouteurs d'événements
                initEventListeners();
                
                // Chargement initial des données
                fetchBotStatus();
                fetchPerformanceData();
                await fetchRecentTrades();
                fetchDailyPerformance();
                
                // Initialiser Socket.IO
                initSocketConnection();
                
                // Configuration des événements de mise à jour automatique
                const autoUpdateIntervals = [
                    setInterval(fetchPerformanceData, UPDATE_INTERVAL),
                    setInterval(fetchRecentTrades, UPDATE_INTERVAL * 3),
                    setInterval(fetchDailyPerformance, UPDATE_INTERVAL * 6)
                ];
                
                // Écouteur pour nettoyer les intervalles à la fermeture de la page
                window.addEventListener('beforeunload', () => {
                    autoUpdateIntervals.forEach(interval => clearInterval(interval));
                    if (socket) socket.disconnect();
                });
            }
        } catch (error) {
            console.error('Erreur d\'initialisation de l\'application:', error);
            showError('Erreur d\'initialisation de l\'application. Veuillez actualiser la page.');
        }
    }
    
    // Vérifier l'authentification
    async function checkAuthentication() {
        try {
            const response = await fetch(`${API_BASE_URL}/verify-auth`, {
                credentials: 'include' // Inclure les cookies
            });
            
            if (!response.ok) {
                // Rediriger vers la page de connexion
                window.location.href = '/login.html';
                return false;
            }
            
            const data = await response.json();
            
            // Mettre à jour les informations utilisateur
            updateUserInfo(data.user);
            
            return data.authenticated;
        } catch (error) {
            console.error('Erreur lors de la vérification d\'authentification:', error);
            window.location.href = '/login.html';
            return false;
        }
    }
    
    // Mettre à jour les informations utilisateur
    function updateUserInfo(user) {
        if (domElements.userInfo && user) {
            domElements.userInfo.textContent = `${user.username} (${user.role})`;
        }
    }
    
    // Ajouter un bouton de déconnexion
    function addLogoutButton() {
        const navbarNav = document.querySelector('.navbar-nav.ms-auto');
        
        if (navbarNav) {
            const logoutItem = document.createElement('li');
            logoutItem.className = 'nav-item';
            
            const logoutButton = document.createElement('button');
            logoutButton.id = 'logoutBtn';
            logoutButton.className = 'btn btn-outline-light ms-2';
            logoutButton.textContent = 'Déconnexion';
            
            logoutButton.addEventListener('click', async () => {
                try {
                    const token = await fetchCsrfToken();
                    
                    const response = await fetch(`${API_BASE_URL}/logout`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': token
                        },
                        credentials: 'include'
                    });
                    
                    if (response.ok) {
                        // Déconnecter Socket.IO
                        if (socket) socket.disconnect();
                        
                        window.location.href = '/login.html';
                    }
                } catch (error) {
                    console.error('Erreur lors de la déconnexion:', error);
                    showError('Erreur lors de la déconnexion');
                }
            });
            
            logoutItem.appendChild(logoutButton);
            navbarNav.appendChild(logoutItem);
        }
    }
    
    // Initialiser la connexion Socket.IO
    function initSocketConnection() {
        // Obtenir le token JWT depuis les cookies
        const token = document.cookie
            .split('; ')
            .find(row => row.startsWith('token='))
            ?.split('=')[1];
        
        if (!token) {
            console.warn('Pas de token trouvé pour Socket.IO');
            return;
        }
        
        // Configurer Socket.IO avec authentification
        socket = io({
            auth: {
                token: token
            }
        });
        
        socket.on('connect', () => {
            console.log('Connecté au serveur via Socket.IO');
        });
        
        socket.on('disconnect', () => {
            console.log('Déconnecté du serveur');
        });
        
        socket.on('auth_error', (data) => {
            console.error('Erreur d\'authentification Socket.IO:', data);
            showError('Session expirée. Veuillez vous reconnecter.');
            setTimeout(() => window.location.href = '/login.html', 3000);
        });
        
        socket.on('bot_status', (data) => {
            updateBotStatus(data.isRunning);
        });
        
        socket.on('bot_status_change', (data) => {
            updateBotStatus(data.isRunning);
        });
        
        socket.on('bot_update', (data) => {
            console.log('Mise à jour du bot reçue:', data);
            
            if (data.report) {
                updatePerformanceUI(data.report);
            }
            
            if (data.recentTrades && data.recentTrades.length > 0) {
                // Vérifier les nouvelles transactions
                const currentTrades = new Set(state.recentTrades.map(t => t.id));
                const newTrades = data.recentTrades.filter(t => !currentTrades.has(t.id));
                
                if (newTrades.length > 0) {
                    // Mettre à jour l'état
                    state.updateState('recentTrades', [...newTrades, ...state.recentTrades].slice(0, 50));
                    updateTradesTable();
                    
                    // Notification de nouvelle transaction
                    showNotification('Nouvelle transaction détectée', `${newTrades.length} nouvelle(s) transaction(s) effectuée(s)`);
                }
            }
        });
        
        // Demander une mise à jour immédiate
        socket.emit('request_update');
    }
    
    // Initialiser les écouteurs d'événements
    function initEventListeners() {
        // Navigation
        const navLinks = document.querySelectorAll('a.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', handleNavigation);
        });
        
        // Événements des boutons
        if (domElements.startBotBtn) domElements.startBotBtn.addEventListener('click', startBot);
        if (domElements.stopBotBtn) domElements.stopBotBtn.addEventListener('click', stopBot);
        if (domElements.refreshTradesBtn) domElements.refreshTradesBtn.addEventListener('click', fetchRecentTrades);
        if (domElements.exportTradesBtn) domElements.exportTradesBtn.addEventListener('click', exportTradingLogs);
        if (domElements.runSimulationBtn) domElements.runSimulationBtn.addEventListener('click', runSimulation);
        
        // Écouteur pour le mode sombre
        if (domElements.darkModeToggle) {
            domElements.darkModeToggle.addEventListener('click', toggleDarkMode);
        }
        
        // Écouteur pour les changements d'état
        document.addEventListener('stateChange', (event) => {
            const { key, value } = event.detail;
            
            // Mettre à jour l'UI en fonction du changement d'état
            if (key === 'darkMode') {
                applyTheme();
            }
        });
        
        // Intercept des erreurs réseau
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            try {
                const response = await originalFetch(...args);
                
                // Gestion de la session expirée
                if (response.status === 401) {
                    // Si c'est l'API de vérification, on ignore
                    if (!args[0].includes('/api/verify-auth')) {
                        showSessionExpiredModal();
                    }
                }
                
                // Gestion des erreurs 403
                if (response.status === 403) {
                    // Si c'est une erreur CSRF, recharger la page pour obtenir un nouveau token
                    if (args[0].includes('/api/')) {
                        const data = await response.clone().json();
                        if (data.code === 'CSRF_ERROR') {
                            showError('Session expirée. Actualisation en cours...');
                            setTimeout(() => window.location.reload(), 2000);
                        } else {
                            showError('Accès refusé. Vérifiez vos autorisations.');
                        }
                    }
                }
                
                return response;
            } catch (error) {
                // Gestion des erreurs réseau
                if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
                    showError('Erreur de connexion au serveur. Vérifiez votre connexion Internet.');
                }
                throw error;
            }
        };
    }
    
    // Fonction pour obtenir un token CSRF
    async function fetchCsrfToken() {
        try {
            // Utiliser le token en cache s'il existe
            if (state.csrfToken) return state.csrfToken;
            
            const response = await fetch(`${API_BASE_URL}/csrf-token`, {
                credentials: 'include' // Inclure les cookies
            });
            
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération du token CSRF');
            }
            
            const data = await response.json();
            state.csrfToken = data.csrfToken;
            return state.csrfToken;
        } catch (error) {
            console.error('Erreur lors de la récupération du token CSRF:', error);
            showError('Erreur lors de la récupération du token CSRF');
            return null;
        }
    }
    
    // Fonctions de l'API
    // ---------------------------------------------------------------------
    
    async function fetchBotStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/status`, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération du statut du bot');
            }
            
            const data = await response.json();
            updateBotStatus(data.isRunning);
        } catch (error) {
            console.error('Erreur lors de la récupération du statut du bot:', error);
            showError('Erreur lors de la récupération du statut du bot');
        }
    }
    
    async function fetchPerformanceData() {
        try {
            const response = await fetch(`${API_BASE_URL}/performance`, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération des données de performance');
            }
            
            const data = await response.json();
            state.updateState('performanceData', data);
            updatePerformanceUI(data);
        } catch (error) {
            console.error('Erreur lors de la récupération des données de performance:', error);
            showError('Erreur lors de la récupération des données de performance');
        }
    }
    
    async function fetchRecentTrades(page = 1, limit = 50) {
        try {
            showLoading(domElements.tradesTableBody);
            
            const offset = (page - 1) * limit;
            const response = await fetch(`${API_BASE_URL}/trades?limit=${limit}&offset=${offset}`, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération des transactions');
            }
            
            const data = await response.json();
            state.updateState('recentTrades', data.trades);
            
            updateTradesTable();
            updatePagination(data.pagination);
            
            if (window.chartUtils && window.chartUtils.updateTradesDistributionChart) {
                window.chartUtils.updateTradesDistributionChart();
            }
            
            return data;
        } catch (error) {
            console.error('Erreur lors de la récupération des transactions:', error);
            if (domElements.tradesTableBody) {
                domElements.tradesTableBody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Erreur lors du chargement des données</td></tr>`;
            }
            showError('Erreur lors de la récupération des transactions');
            return { trades: [], pagination: { total: 0 } };
        }
    }
    
    async function fetchDailyPerformance() {
        try {
            const response = await fetch(`${API_BASE_URL}/daily-performance?limit=30`, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération des performances journalières');
            }
            
            const data = await response.json();
            state.updateState('dailyPerformanceData', data.data);
            
            if (window.chartUtils) {
                if (window.chartUtils.updateDailyPerformanceChart) {
                    window.chartUtils.updateDailyPerformanceChart();
                }
                
                if (window.chartUtils.updateCapitalEvolutionChart) {
                    window.chartUtils.updateCapitalEvolutionChart();
                }
            }
        } catch (error) {
            console.error('Erreur lors de la récupération des performances journalières:', error);
            showError('Erreur lors de la récupération des performances journalières');
        }
    }
    
    async function startBot() {
        try {
            const token = await fetchCsrfToken();
            
            if (!token) {
                throw new Error('Impossible d\'obtenir un token CSRF');
            }
            
            const response = await fetch(`${API_BASE_URL}/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': token
                },
                credentials: 'include'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erreur lors du démarrage du bot');
            }
            
            const data = await response.json();
            showSuccess('Bot démarré avec succès');
            updateBotStatus(true);
        } catch (error) {
            console.error('Erreur lors du démarrage du bot:', error);
            showError(error.message || 'Erreur lors du démarrage du bot');
        }
    }
    
    async function stopBot() {
        try {
            const token = await fetchCsrfToken();
            
            if (!token) {
                throw new Error('Impossible d\'obtenir un token CSRF');
            }
            
            const response = await fetch(`${API_BASE_URL}/stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': token
                },
                credentials: 'include'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erreur lors de l\'arrêt du bot');
            }
            
            const data = await response.json();
            showSuccess('Bot arrêté avec succès');
            updateBotStatus(false);
            
            // Mettre à jour les données après l'arrêt du bot
            setTimeout(() => {
                fetchPerformanceData();
                fetchRecentTrades();
                fetchDailyPerformance();
            }, 1000);
        } catch (error) {
            console.error('Erreur lors de l\'arrêt du bot:', error);
            showError(error.message || 'Erreur lors de l\'arrêt du bot');
        }
    }
    
    async function exportTradingLogs() {
        try {
            const format = state.userSettings.exportFormat || 'json';
            const compress = state.userSettings.compressExport || false;
            
            // Ouvrir dans un nouvel onglet
            window.open(`${API_BASE_URL}/export-logs?format=${format}&compress=${compress}`, '_blank');
        } catch (error) {
            console.error('Erreur lors de l\'exportation des logs:', error);
            showError('Erreur lors de l\'exportation des logs');
        }
    }
    
    async function runSimulation() {
        try {
            const token = await fetchCsrfToken();
            
            if (!token) {
                throw new Error('Impossible d\'obtenir un token CSRF');
            }
            
            const startDate = domElements.startDateInput.value;
            const endDate = domElements.endDateInput.value;
            
            if (!startDate || !endDate) {
                showError('Veuillez sélectionner des dates de début et de fin');
                return;
            }
            
            // Validation des dates
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
            
            if (end - start > 365 * 24 * 60 * 60 * 1000) { // 365 jours en ms
                showError('La période de simulation ne peut pas dépasser 1 an');
                return;
            }
            
            showLoading(domElements.simulationResults);
            domElements.simulationResults.style.display = 'block';
            
            // Désactiver le bouton pendant la simulation
            domElements.runSimulationBtn.disabled = true;
            domElements.runSimulationBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Simulation en cours...';
            
            const response = await fetch(`${API_BASE_URL}/simulation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': token
                },
                body: JSON.stringify({ startDate, endDate }),
                credentials: 'include'
            });
            
            // Réactiver le bouton après la simulation
            domElements.runSimulationBtn.disabled = false;
            domElements.runSimulationBtn.textContent = 'Lancer la Simulation';
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erreur lors de la simulation');
            }
            
            const data = await response.json();
            updateSimulationUI(data);
            showSuccess('Simulation terminée avec succès');
        } catch (error) {
            console.error('Erreur lors de l\'exécution de la simulation:', error);
            domElements.simulationResults.style.display = 'none';
            domElements.runSimulationBtn.disabled = false;
            domElements.runSimulationBtn.textContent = 'Lancer la Simulation';
            showError(error.message || 'Erreur lors de l\'exécution de la simulation');
        }
    }
    
    // Fonctions UI
    // ---------------------------------------------------------------------
    
    function updateBotStatus(isRunning) {
        state.updateState('isRunning', isRunning);
        
        if (domElements.botStatus && domElements.botStatusText) {
            if (isRunning) {
                domElements.botStatus.classList.remove('offline');
                domElements.botStatus.classList.add('online');
                domElements.botStatusText.textContent = 'En ligne';
                
                if (domElements.startBotBtn) domElements.startBotBtn.disabled = true;
                if (domElements.stopBotBtn) domElements.stopBotBtn.disabled = false;
            } else {
                domElements.botStatus.classList.remove('online');
                domElements.botStatus.classList.add('offline');
                domElements.botStatusText.textContent = 'Hors ligne';
                
                if (domElements.startBotBtn) domElements.startBotBtn.disabled = false;
                if (domElements.stopBotBtn) domElements.stopBotBtn.disabled = true;
            }
        }
    }
    
    function updatePerformanceUI(data) {
        if (!data || !data.metrics || !data.portfolioMetrics) return;
        
        const { metrics } = data;
        const portfolioMetrics = data.portfolioMetrics;
        
        // Mise à jour des valeurs de performance principales
        if (domElements.capitalValue) {
            domElements.capitalValue.textContent = formatCurrency(portfolioMetrics.currentCapital || 0);
            domElements.capitalValue.classList.add('highlight-update');
            setTimeout(() => domElements.capitalValue.classList.remove('highlight-update'), 1500);
        }
        
        if (domElements.totalProfitValue) {
            domElements.totalProfitValue.textContent = formatCurrency(metrics.totalProfit || 0);
            domElements.totalProfitValue.classList.add('highlight-update');
            setTimeout(() => domElements.totalProfitValue.classList.remove('highlight-update'), 1500);
            
            // Coloration selon profit/perte
            if (metrics.totalProfit > 0) {
                domElements.totalProfitValue.classList.add('profit-positive');
                domElements.totalProfitValue.classList.remove('profit-negative');
            } else {
                domElements.totalProfitValue.classList.add('profit-negative');
                domElements.totalProfitValue.classList.remove('profit-positive');
            }
        }
        
        if (domElements.winRateValue) {
            domElements.winRateValue.textContent = formatPercentage(metrics.winRate || 0);
            domElements.winRateValue.classList.add('highlight-update');
            setTimeout(() => domElements.winRateValue.classList.remove('highlight-update'), 1500);
        }
        
        // Mise à jour des métriques détaillées
        if (domElements.totalTradesValue) domElements.totalTradesValue.textContent = metrics.totalTrades || 0;
        if (domElements.winningTradesValue) domElements.winningTradesValue.textContent = metrics.winningTrades || 0;
        if (domElements.losingTradesValue) domElements.losingTradesValue.textContent = metrics.losingTrades || 0;
        if (domElements.winRateMetricValue) domElements.winRateMetricValue.textContent = formatPercentage(metrics.winRate || 0);
        
        if (domElements.avgProfitValue) domElements.avgProfitValue.textContent = formatCurrency(metrics.averageWin || 0);
        if (domElements.avgLossValue) domElements.avgLossValue.textContent = formatCurrency(Math.abs(metrics.averageLoss || 0));
        if (domElements.biggestWinValue) domElements.biggestWinValue.textContent = formatCurrency(metrics.biggestWin || 0);
        if (domElements.biggestLossValue) domElements.biggestLossValue.textContent = formatCurrency(Math.abs(metrics.biggestLoss || 0));
    }
    
    function updateTradesTable() {
        if (!domElements.tradesTableBody) return;
        
        if (!state.recentTrades || state.recentTrades.length === 0) {
            domElements.tradesTableBody.innerHTML = `<tr><td colspan="10" class="text-center">Aucune transaction trouvée</td></tr>`;
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
        
        domElements.tradesTableBody.innerHTML = html;
    }
    
    function updatePagination(paginationData) {
        if (!domElements.paginationContainer || !paginationData) return;
        
        const { total, limit, offset } = paginationData;
        const currentPage = Math.floor(offset / limit) + 1;
        const totalPages = Math.ceil(total / limit);
        
        let paginationHtml = '';
        
        // Créer la pagination
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
        
        domElements.paginationContainer.innerHTML = paginationHtml;
        
        // Ajouter les écouteurs d'événements
        const pageLinks = domElements.paginationContainer.querySelectorAll('.page-link');
        pageLinks.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                
                const page = parseInt(e.target.dataset.page);
                if (isNaN(page)) return;
                
                await fetchRecentTrades(page, limit);
            });
        });
    }
    
    function updateSimulationUI(data) {
        if (!domElements.simulationResults || !data || !data.metrics) {
            if (domElements.simulationResults) {
                domElements.simulationResults.style.display = 'none';
            }
            return;
        }
        
        const { metrics, trades } = data;
        
        // Mise à jour des métriques de simulation
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
        
        // Mise à jour du graphique de simulation
        if (window.chartUtils && window.chartUtils.updateSimulationProfitChart) {
            window.chartUtils.updateSimulationProfitChart(trades);
        }
    }
    
    function handleNavigation(e) {
        e.preventDefault();
        
        const targetId = e.target.getAttribute('href').substring(1);
        
        // Mettre à jour la navigation active
        const navLinks = document.querySelectorAll('a.nav-link');
        navLinks.forEach(link => {
            link.classList.remove('active');
        });
        
        e.target.classList.add('active');
        
        // Gestion de l'affichage des sections
        if (targetId === 'simulation') {
            const simulationSection = document.getElementById('simulationSection');
            if (simulationSection) simulationSection.style.display = 'block';
        } else {
            const simulationSection = document.getElementById('simulationSection');
            if (simulationSection) simulationSection.style.display = 'none';
        }
    }
    
    // Fonctions pour le thème sombre
    // ---------------------------------------------------------------------
    
    function toggleDarkMode() {
        state.updateState('darkMode', !state.darkMode);
    }
    
    function applyTheme() {
        if (state.darkMode) {
            document.body.classList.add('dark-mode');
            if (domElements.darkModeToggle) {
                domElements.darkModeToggle.classList.add('dark');
            }
        } else {
            document.body.classList.remove('dark-mode');
            if (domElements.darkModeToggle) {
                domElements.darkModeToggle.classList.remove('dark');
            }
        }
        
        // Mettre à jour les graphiques
        if (window.chartUtils && window.chartUtils.updateChartsForDarkMode) {
            window.chartUtils.updateChartsForDarkMode(state.darkMode);
        }
    }
    
    // Fonctions utilitaires
    // ---------------------------------------------------------------------
    
    function formatCurrency(value) {
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    }
    
    function formatPercentage(value) {
        return new Intl.NumberFormat('fr-FR', {
            style: 'percent',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value / 100);
    }
    
    function formatDateForInput(date) {
        return date.toISOString().split('T')[0];
    }
    
    function updateClock() {
        const now = new Date();
        if (domElements.currentDateTime) {
            domElements.currentDateTime.textContent = now.toLocaleString();
        }
    }
    
    // Échapper les caractères spéciaux HTML pour éviter les injections XSS
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    
    function showLoading(element) {
        if (!element) return;
        
        if (element === domElements.simulationResults) {
            element.innerHTML = `
                <div class="d-flex justify-content-center align-items-center p-5">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Chargement...</span>
                    </div>
                    <span class="ms-3">Exécution de la simulation...</span>
                </div>
            `;
        } else if (element === domElements.tradesTableBody) {
            element.innerHTML = `<tr><td colspan="10" class="text-center">
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Chargement...</span>
                </div>
                Chargement des données...
            </td></tr>`;
        }
    }
    
    function showSuccess(message) {
        // Toast de succès
        const toastContainer = document.getElementById('toastContainer') || createToastContainer();
        
        const toast = document.createElement('div');
        toast.className = 'toast show';
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');
        
        toast.innerHTML = `
            <div class="toast-header bg-success text-white">
                <strong class="me-auto">Succès</strong>
                <small>${new Date().toLocaleTimeString()}</small>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${escapeHtml(message)}
            </div>
        `;
        
        toastContainer.appendChild(toast);
        
        // Fermer automatiquement après 5 secondes
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => {
                toast.remove();
            }, 500);
        }, 5000);
        
        // Ajouter l'écouteur pour fermer manuellement
        const closeBtn = toast.querySelector('.btn-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                toast.classList.add('hiding');
                setTimeout(() => {
                    toast.remove();
                }, 500);
            });
        }
    }
    
    function showError(message) {
        // Toast d'erreur
        const toastContainer = document.getElementById('toastContainer') || createToastContainer();
        
        const toast = document.createElement('div');
        toast.className = 'toast show';
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');
        
        toast.innerHTML = `
            <div class="toast-header bg-danger text-white">
                <strong class="me-auto">Erreur</strong>
                <small>${new Date().toLocaleTimeString()}</small>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${escapeHtml(message)}
            </div>
        `;
        
        toastContainer.appendChild(toast);
        
        // Fermer automatiquement après 5 secondes
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => {
                toast.remove();
            }, 500);
        }, 5000);
        
        // Ajouter l'écouteur pour fermer manuellement
        const closeBtn = toast.querySelector('.btn-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                toast.classList.add('hiding');
                setTimeout(() => {
                    toast.remove();
                }, 500);
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
        // Créer la modal si elle n'existe pas
        let modal = document.getElementById('sessionExpiredModal');
        
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sessionExpiredModal';
            modal.className = 'modal fade';
            modal.setAttribute('tabindex', '-1');
            modal.setAttribute('aria-labelledby', 'sessionExpiredModalLabel');
            modal.setAttribute('aria-hidden', 'true');
            
            modal.innerHTML = `
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header bg-danger text-white">
                            <h5 class="modal-title" id="sessionExpiredModalLabel">Session expirée</h5>
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
            
            // Ajouter l'écouteur pour la redirection
            const redirectBtn = document.getElementById('redirectLoginBtn');
            if (redirectBtn) {
                redirectBtn.addEventListener('click', () => {
                    window.location.href = '/login.html';
                });
            }
        }
        
        // Afficher la modal
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    }
    
    function showNotification(title, message) {
        // Tentative d'utilisation des notifications navigateur si autorisées
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
        
        // Notification visuelle dans l'interface
        showSuccess(message);
    }
    
    // Initialisation
    // ---------------------------------------------------------------------
    
    // Initialiser l'horloge
    updateClock();
    setInterval(updateClock, 1000);
    
    // Initialisation des dates pour la simulation
    if (domElements.startDateInput && domElements.endDateInput) {
        const today = new Date();
        const lastMonth = new Date();
        lastMonth.setMonth(today.getMonth() - 1);
        
        domElements.startDateInput.value = formatDateForInput(lastMonth);
        domElements.endDateInput.value = formatDateForInput(today);
    }
    
    // Initialiser l'application
    initApp();
});