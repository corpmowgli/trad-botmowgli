// bot.js - Optimized version
import { tradingConfig } from './config/tradingConfig.js';
import { EnhancedMomentumStrategy } from './strategies/enhancedMomentumStrategy.js';
import { MarketDataService } from './services/marketDataService.js';
import { RiskManager } from './trading/riskManager.js';
import { PositionManager } from './trading/positionManager.js';
import { PortfolioManager } from './trading/portfolioManager.js';
import { TradeLogger } from './trading/tradeLogger.js';
import { TradingVisualizer } from './utils/tradingVisualizer.js';
import { SimulationEngine } from './trading/simulationEngine.js';
import { retry, delay, generateUUID } from './utils/helpers.js';
import EventEmitter from 'events';

/**
 * Classe principale du bot de trading
 * Gère l'orchestration des différents composants du système
 */
export class TradingBot extends EventEmitter {
  /**
   * Constructeur de la classe TradingBot
   * @param {Object} customConfig - Configuration personnalisée (optionnelle)
   */
  constructor(customConfig = {}) {
    super();
    
    // Fusionner la configuration personnalisée avec la configuration par défaut
    this.config = { ...tradingConfig, ...customConfig };
    
    // Initialiser les composants du système
    this.strategy = new EnhancedMomentumStrategy(this.config);
    this.marketData = new MarketDataService(this.config);
    this.riskManager = new RiskManager(this.config);
    this.positionManager = new PositionManager(this.config);
    this.portfolioManager = new PortfolioManager(this.config.simulation.initialCapital);
    this.logger = new TradeLogger(this.config);
    this.visualizer = new TradingVisualizer(this.logger);
    
    // État du bot
    this.isRunning = false;
    this.isStopping = false;
    this.consecutiveErrors = 0;
    this.lastCycleTime = null;
    this.startTime = null;
    this.processingStatus = {
      isProcessingCycle: false,
      lastCycleTime: null,
      cycleCount: 0,
      successfulCycles: 0,
      failedCycles: 0
    };
    
    // Cache pour optimiser les performances
    this.dataCache = new Map(); // Cache pour les réponses API
    this.tokenCache = new Map(); // Cache pour les tokens qualifiés
    this.priceCache = new Map(); // Cache pour les prix actuels
    
    // Identifiants des intervalles pour le nettoyage
    this.intervals = {
      mainLoop: null,
      statusUpdate: null,
      cleanupTask: null,
      dataCacheCleanup: null
    };
    
    // Initialiser la journalisation
    this._initializeLogging();
  }

  /**
   * Initialise la journalisation du bot
   * @private
   */
  _initializeLogging() {
    // Configurer les écouteurs d'événements pour la journalisation
    this.on('trade', (trade) => {
      console.log(`[Bot] Trade executed: ${trade.token} - Profit: ${trade.profit}`);
    });
    
    this.on('error', (error) => {
      console.error(`[Bot] Error: ${error.message}`);
    });
    
    this.on('warning', (message) => {
      console.warn(`[Bot] Warning: ${message}`);
    });
    
    this.on('info', (message) => {
      if (this.config.logging.level === 'debug' || this.config.logging.level === 'info') {
        console.log(`[Bot] Info: ${message}`);
      }
    });
    
    this.on('debug', (message) => {
      if (this.config.logging.level === 'debug') {
        console.debug(`[Bot] Debug: ${message}`);
      }
    });
  }

  /**
   * Démarre le bot de trading
   * @returns {Promise<boolean>} True si le démarrage réussit
   */
  async start() {
    // Vérifier si le bot est déjà en cours d'exécution
    if (this.isRunning) {
      this.emit('warning', 'Bot is already running');
      return false;
    }
    
    try {
      this.isRunning = true;
      this.isStopping = false;
      this.startTime = Date.now();
      this.consecutiveErrors = 0;
      this.emit('info', `Trading bot started at ${new Date(this.startTime).toISOString()}`);
      
      // Configurer l'intervalle pour le cycle de trading principal
      const cycleInterval = this.config.trading.cycleInterval || 60000; // Défaut: 1 minute
      this.intervals.mainLoop = setInterval(() => this.runTradingCycle(), cycleInterval);
      
      // Configurer l'intervalle pour les mises à jour d'état
      this.intervals.statusUpdate = setInterval(() => this.emitStatusUpdate(), 30000);
      
      // Configurer l'intervalle pour les tâches de nettoyage (une fois par jour)
      this.intervals.cleanupTask = setInterval(() => this.performCleanupTasks(), 24 * 60 * 60 * 1000);
      
      // Configurer le nettoyage du cache de données (toutes les 10 minutes)
      this.intervals.dataCacheCleanup = setInterval(() => this.cleanupDataCache(), 10 * 60 * 1000);
      
      // Exécuter immédiatement le premier cycle
      this.runTradingCycle();
      
      return true;
    } catch (error) {
      this.isRunning = false;
      this.emit('error', error);
      return false;
    }
  }
  
  /**
   * Arrête le bot de trading
   * @returns {Promise<Object>} Rapport de performance final
   */
  async stop() {
    if (!this.isRunning) {
      this.emit('warning', 'Bot is not running');
      return this.getPerformanceReport();
    }
    
    try {
      this.isStopping = true;
      this.emit('info', 'Stopping trading bot...');
      
      // Nettoyer les intervalles
      for (const [key, interval] of Object.entries(this.intervals)) {
        if (interval) {
          clearInterval(interval);
          this.intervals[key] = null;
        }
      }
      
      // Fermer toutes les positions ouvertes si configuré
      if (this.config.trading.closePositionsOnStop) {
        await this.closeAllPositions();
      }
      
      // Générer le rapport final
      const report = this.generateConsoleReport();
      console.log(report);
      
      // Nettoyer les ressources
      this.logger.cleanup();
      
      this.isRunning = false;
      this.isStopping = false;
      this.emit('info', `Trading bot stopped. Total runtime: ${this._calculateRuntime()}`);
      
      return this.getPerformanceReport();
    } catch (error) {
      this.emit('error', error);
      this.isRunning = false;
      this.isStopping = false;
      return this.getPerformanceReport();
    }
  }
  
  /**
   * Exécute un cycle de trading complet
   * @returns {Promise<boolean>} true si le cycle a réussi
   */
  async runTradingCycle() {
    // Éviter l'exécution simultanée de plusieurs cycles
    if (this.processingStatus.isProcessingCycle) {
      this.emit('debug', 'Trading cycle already in progress, skipping this cycle');
      return false;
    }
    
    // Marquer le début du cycle
    this.processingStatus.isProcessingCycle = true;
    this.processingStatus.lastCycleTime = Date.now();
    this.processingStatus.cycleCount++;
    
    try {
      this.emit('debug', `Starting trading cycle #${this.processingStatus.cycleCount}`);
      
      // Étape 1: Obtenir les tokens qualifiés
      const tokens = await retry(
        () => this.getQualifiedTokens(),
        3,
        1000,
        (retry, delay, error) => this.emit('debug', `Retrying getQualifiedTokens (${retry}/3): ${error.message}`)
      );
      
      if (!tokens || tokens.length === 0) {
        this.emit('info', 'No qualified tokens found in this cycle');
      } else {
        this.emit('debug', `Found ${tokens.length} qualified tokens`);
        
        // Étape 2: Traiter les tokens avec un peu de parallélisme (limite à 3 tokens simultanés)
        const batchSize = 3;
        for (let i = 0; i < tokens.length; i += batchSize) {
          const tokenBatch = tokens.slice(i, i + batchSize);
          
          // Traiter chaque lot en parallèle
          await Promise.all(
            tokenBatch.map(async (token) => {
              // Vérifier si le bot est en cours d'arrêt
              if (this.isStopping) return;
              
              await this.processToken(token);
            })
          );
          
          // Petite pause entre les lots pour éviter de surcharger les API
          if (i + batchSize < tokens.length) {
            await delay(1000);
          }
        }
      }
      
      // Étape 3: Vérifier et fermer les positions qui ont atteint leurs objectifs
      await this.checkAndClosePositions();
      
      this.processingStatus.successfulCycles++;
      this.consecutiveErrors = 0;
      this.emit('debug', `Completed trading cycle #${this.processingStatus.cycleCount}`);
      
      return true;
    } catch (error) {
      this.processingStatus.failedCycles++;
      this.consecutiveErrors++;
      this.emit('error', error);
      
      // Vérifier si le nombre d'erreurs consécutives dépasse le seuil configuré
      if (this.consecutiveErrors >= this.config.errorHandling.maxConsecutiveErrors) {
        this.emit('warning', `Too many consecutive errors (${this.consecutiveErrors}), activating circuit breaker`);
        
        // Activer le disjoncteur
        this._activateCircuitBreaker();
      }
      
      return false;
    } finally {
      // Marquer la fin du cycle
      this.processingStatus.isProcessingCycle = false;
    }
  }
  
  /**
   * Traite un token spécifique pour l'analyse et le trading potentiel
   * @param {Object} token - Informations du token
   * @returns {Promise<Object|null>} Position ouverte ou null
   */
  async processToken(token) {
    try {
      // Vérifier si nous avons déjà une position pour ce token
      const openPositions = this.positionManager.getOpenPositions();
      if (openPositions.some(p => p.token === token.token_mint)) {
        this.emit('debug', `Already have a position for ${token.token_mint}, skipping`);
        return null;
      }
      
      // Obtenir les données de marché agrégées
      const marketData = await this.marketData.aggregateTokenData(token.token_mint);
      
      // Obtenir les données historiques
      const historicalData = await this.getHistoricalData(token.token_mint);
      
      // Vérifier si nous avons suffisamment de données
      if (!historicalData || historicalData.length < this.config.indicators.minimumDataPoints) {
        this.emit('debug', `Insufficient historical data for ${token.token_mint}`);
        return null;
      }
      
      // Préparer les données pour l'analyse
      const prices = historicalData.map(data => data.price);
      const volumes = historicalData.map(data => data.volume);
      
      // Analyser avec la stratégie de trading
      const signal = await this.strategy.analyze(
        token.token_mint,
        prices, 
        volumes, 
        marketData
      );
      
      // Vérifier si le signal est valide et si nous pouvons trader selon la gestion des risques
      if (signal.type === 'NONE' || signal.confidence < this.config.trading.minConfidenceThreshold) {
        this.emit('debug', `No valid signal for ${token.token_mint} (Confidence: ${signal.confidence})`);
        return null;
      }
      
      // Vérifier si nous pouvons trader selon la gestion des risques
      if (!this.riskManager.canTrade(this.portfolioManager)) {
        this.emit('info', `Risk management prevents trading for ${token.token_mint}`);
        return null;
      }
      
      // Calculer la taille de la position
      const price = prices[prices.length - 1];
      const amount = this.riskManager.calculatePositionSize(price, this.portfolioManager);
      
      // Ouvrir une nouvelle position avec les informations du signal
      const position = await this.openNewPosition(token.token_mint, price, amount, signal);
      
      return position;
    } catch (error) {
      this.emit('error', new Error(`Error processing token ${token.token_mint}: ${error.message}`));
      return null;
    }
  }

  /**
   * Vérifie et ferme les positions qui ont atteint leurs objectifs
   * @returns {Promise<Array>} Positions fermées
   */
  async checkAndClosePositions() {
    try {
      // Récupérer les prix actuels pour toutes les positions
      const currentPrices = await this.fetchCurrentPrices();
      
      // Vérifier les positions avec les prix actuels
      const closedPositions = await this.positionManager.checkPositions(currentPrices);
      
      // Traiter les positions fermées
      for (const position of closedPositions) {
        // Mettre à jour le portfolio
        this.portfolioManager.updatePortfolio(position);
        
        // Journaliser le trade avec les informations supplémentaires du signal
        const tradeLog = this.logger.logTrade({
          ...position,
          signalConfidence: position.signalConfidence || 0,
          signalReasons: position.signalReasons || []
        });
        
        // Émettre l'événement de trade
        this.emit('trade', tradeLog);
      }
      
      if (closedPositions.length > 0) {
        this.emit('info', `Closed ${closedPositions.length} positions`);
      }
      
      return closedPositions;
    } catch (error) {
      this.emit('error', new Error(`Error checking positions: ${error.message}`));
      return [];
    }
  }

  /**
   * Ouvre une nouvelle position
   * @param {string} token - Token à trader
   * @param {number} price - Prix d'entrée
   * @param {number} amount - Montant à trader
   * @param {Object} signal - Signal de trading
   * @returns {Promise<Object|null>} Position ouverte ou null
   */
  async openNewPosition(token, price, amount, signal) {
    try {
      // Vérifier que les paramètres d'entrée sont valides
      if (!token || !price || !amount || price <= 0 || amount <= 0) {
        this.emit('warning', `Invalid parameters for opening position: token=${token}, price=${price}, amount=${amount}`);
        return null;
      }
      
      // Vérifier si le nombre maximum de positions est atteint
      const openPositions = this.positionManager.getOpenPositions();
      if (openPositions.length >= this.config.trading.maxOpenPositions) {
        this.emit('info', `Maximum number of open positions (${this.config.trading.maxOpenPositions}) reached`);
        return null;
      }
      
      // Ouvrir la position
      const position = await this.positionManager.openPosition(token, price, amount);
      
      if (position) {
        // Stocker les informations du signal dans la position pour la journalisation
        position.signalConfidence = signal.confidence;
        position.signalReasons = signal.reasons;
        position.signal = signal.type;
        position.openTime = Date.now();
        position.id = generateUUID();
        
        this.emit('info', `Opened new position for ${token} at price ${price}, amount: ${amount}, signal: ${signal.type}`);
        return position;
      }
      
      return null;
    } catch (error) {
      this.emit('error', new Error(`Error opening position for ${token}: ${error.message}`));
      return null;
    }
  }

  /**
   * Ferme toutes les positions ouvertes
   * @returns {Promise<Array>} Positions fermées
   */
  async closeAllPositions() {
    try {
      const positions = this.positionManager.getOpenPositions();
      
      if (positions.length === 0) {
        this.emit('info', 'No open positions to close');
        return [];
      }
      
      this.emit('info', `Closing all ${positions.length} open positions`);
      
      // Récupérer les prix actuels
      const currentPrices = await this.fetchCurrentPrices();
      
      const closedPositions = [];
      
      // Fermer manuellement chaque position
      for (const position of positions) {
        const price = currentPrices.get(position.token) || position.entryPrice;
        
        try {
          const closedPosition = {
            ...position,
            exitPrice: price,
            profit: (price - position.entryPrice) * position.amount,
            profitPercentage: ((price - position.entryPrice) / position.entryPrice) * 100,
            holdingTime: Date.now() - position.openTime,
            closedAt: Date.now(),
            closeReason: 'MANUAL_CLOSE'
          };
          
          // Mettre à jour le portfolio
          this.portfolioManager.updatePortfolio(closedPosition);
          
          // Journaliser le trade
          this.logger.logTrade(closedPosition);
          
          // Émettre l'événement de trade
          this.emit('trade', closedPosition);
          
          closedPositions.push(closedPosition);
        } catch (error) {
          this.emit('error', new Error(`Error closing position for ${position.token}: ${error.message}`));
        }
      }
      
      // Effacer toutes les positions du gestionnaire
      this.positionManager.clearPositions();
      
      return closedPositions;
    } catch (error) {
      this.emit('error', new Error(`Error closing all positions: ${error.message}`));
      return [];
    }
  }

  /**
   * Récupère les prix actuels pour tous les tokens dans les positions avec cache
   * @returns {Promise<Map>} Map des prix actuels (token -> prix)
   */
  async fetchCurrentPrices() {
    const positions = this.positionManager.getOpenPositions();
    const prices = new Map();
    
    // Créer une liste des tokens à vérifier
    const tokens = positions.map(p => p.token);
    
    // Vérifier le cache pour les prix récents (moins de 30 secondes)
    let tokensToFetch = [];
    for (const token of tokens) {
      const cachedPrice = this.priceCache.get(token);
      if (cachedPrice && (Date.now() - cachedPrice.timestamp < 30000)) {
        prices.set(token, cachedPrice.price);
      } else {
        tokensToFetch.push(token);
      }
    }
    
    // Si des tokens ont besoin d'être récupérés, les récupérer en lot si possible
    if (tokensToFetch.length > 0) {
      try {
        // Essayer d'abord une récupération par lots
        const batchPrices = await retry(
          () => this.marketData.getBatchTokenPrices(tokensToFetch),
          3, 
          1000
        );
        
        if (batchPrices) {
          // Mettre à jour les prix et le cache
          for (const [token, price] of Object.entries(batchPrices)) {
            if (price) {
              prices.set(token, price);
              this.priceCache.set(token, {
                price,
                timestamp: Date.now()
              });
            }
          }
          
          // Vérifier s'il manque des tokens
          tokensToFetch = tokensToFetch.filter(token => !prices.has(token));
        }
      } catch (error) {
        this.emit('warning', `Batch price fetch failed, falling back to individual requests: ${error.message}`);
      }
      
      // Récupérer individuellement les prix manquants
      for (const token of tokensToFetch) {
        try {
          const price = await retry(
            () => this.marketData.getTokenPrice(token),
            3,
            1000
          );
          
          if (price) {
            prices.set(token, price);
            this.priceCache.set(token, {
              price,
              timestamp: Date.now()
            });
          } else {
            // Si le prix n'est pas disponible, utiliser le prix d'entrée comme fallback
            const position = positions.find(p => p.token === token);
            prices.set(token, position.entryPrice);
            this.emit('warning', `Could not fetch current price for ${token}, using entry price`);
          }
        } catch (error) {
          this.emit('error', new Error(`Error fetching price for ${token}: ${error.message}`));
          // Utiliser le prix d'entrée comme fallback
          const position = positions.find(p => p.token === token);
          prices.set(token, position.entryPrice);
        }
      }
    }
    
    return prices;
  }

  /**
   * Récupère les tokens qualifiés selon les critères configurés avec cache
   * @returns {Promise<Array>} Liste des tokens qualifiés
   */
  async getQualifiedTokens() {
    try {
      // Vérifier si nous avons un cache valide (moins de 10 minutes)
      const cachedTokens = this.tokenCache.get('qualified_tokens');
      if (cachedTokens && (Date.now() - cachedTokens.timestamp < 10 * 60 * 1000)) {
        return cachedTokens.data;
      }
      
      const response = await this.marketData.getQualifiedTokens(
        this.config.trading.minLiquidity,
        this.config.trading.minVolume24h
      );
      
      // Valider et filtrer la réponse
      if (!response || !Array.isArray(response)) {
        this.emit('warning', 'Invalid response from getQualifiedTokens');
        return [];
      }
      
      // Filtrer les tokens invalides
      const validTokens = response.filter(token => 
        token && token.token_mint && typeof token.token_mint === 'string'
      );
      
      // Mettre à jour le cache
      this.tokenCache.set('qualified_tokens', {
        data: validTokens,
        timestamp: Date.now()
      });
      
      return validTokens;
    } catch (error) {
      this.emit('error', new Error(`Error getting qualified tokens: ${error.message}`));
      return [];
    }
  }
  
  /**
   * Récupère les données historiques pour un token spécifique avec cache
   * @param {string} tokenMint - Adresse du token
   * @param {number} lookbackPeriod - Période de recul en heures (défaut: 50)
   * @returns {Promise<Array>} Données historiques
   */
  async getHistoricalData(tokenMint, lookbackPeriod = 50) {
    try {
      // Créer une clé de cache incluant le token et la période de recul
      const cacheKey = `historical_${tokenMint}_${lookbackPeriod}`;
      
      // Vérifier si nous avons des données en cache et qu'elles ne sont pas périmées
      const cachedData = this.dataCache.get(cacheKey);
      if (cachedData && (Date.now() - cachedData.timestamp < 5 * 60 * 1000)) { // cache de 5 minutes
        return cachedData.data;
      }
      
      // Valider les paramètres
      if (!tokenMint || typeof tokenMint !== 'string') {
        this.emit('warning', `Invalid tokenMint parameter: ${tokenMint}`);
        return [];
      }
      
      if (lookbackPeriod <= 0) {
        lookbackPeriod = 50; // Valeur par défaut
      }
      
      // Calculer les timestamps
      const endTime = Date.now();
      const startTime = endTime - (lookbackPeriod * 3600 * 1000); // lookbackPeriod en heures
      
      const response = await retry(
        () => this.marketData.getHistoricalPrices(
          tokenMint,
          startTime,
          endTime,
          '1h' // Intervalles de 1 heure
        ),
        3,
        1000
      );
      
      // Valider la réponse
      if (!response || !Array.isArray(response)) {
        this.emit('warning', `Invalid historical data response for ${tokenMint}`);
        return [];
      }
      
      // Filtrer et valider les données
      const validData = response.filter(item => 
        item && 
        typeof item.price === 'number' && 
        typeof item.volume === 'number' && 
        typeof item.timestamp === 'number'
      );
      
      // Mettre à jour le cache
      this.dataCache.set(cacheKey, {
        data: validData,
        timestamp: Date.now()
      });
      
      return validData;
    } catch (error) {
      this.emit('error', new Error(`Error getting historical data for ${tokenMint}: ${error.message}`));
      return [];
    }
  }
  
  /**
   * Exécute une simulation de backtest
   * @param {Date|string|number} startDate - Date de début
   * @param {Date|string|number} endDate - Date de fin
   * @param {Object} customConfig - Configuration personnalisée pour la simulation
   * @returns {Promise<Object>} Résultats de la simulation
   */
  async runSimulation(startDate, endDate, customConfig = {}) {
    if (this.isRunning) {
      this.emit('warning', 'Cannot run simulation while bot is running');
      return {
        success: false,
        error: 'Bot is currently running'
      };
    }
    
    try {
      this.emit('info', `Starting simulation from ${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`);
      
      // Créer le moteur de simulation si nécessaire
      if (!this.simulationEngine) {
        this.simulationEngine = new SimulationEngine(
          this.marketData,
          this.strategy,
          this.riskManager,
          { ...this.config, ...customConfig }
        );
      }
      
      // Exécuter la simulation
      const simulationResult = await this.simulationEngine.runSimulation(
        startDate,
        endDate
      );
      
      this.emit('info', `Simulation completed with ${simulationResult.trades.length} trades`);
      
      return simulationResult;
    } catch (error) {
      this.emit('error', new Error(`Error running simulation: ${error.message}`));
      
      return {
        success: false,
        error: error.message,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString()
      };
    }
  }
  
  /**
   * Obtient un rapport de performance complet
   * @returns {Object} Rapport de performance
   */
  getPerformanceReport() {
    return {
      metrics: this.logger.getPerformanceMetrics(),
      recentTrades: this.logger.getRecentTrades(10),
      dailyPerformance: this.logger.getDailyPerformance(),
      portfolioMetrics: this.portfolioManager.getMetrics(),
      botMetrics: {
        uptime: this._calculateRuntime(),
        isRunning: this.isRunning,
        cyclesRun: this.processingStatus.cycleCount,
        successfulCycles: this.processingStatus.successfulCycles,
        failedCycles: this.processingStatus.failedCycles,
        lastCycleTime: this.processingStatus.lastCycleTime 
          ? new Date(this.processingStatus.lastCycleTime).toISOString() 
          : null,
        cacheStats: this.getCacheStats()
      }
    };
  }
  
  /**
   * Obtient les statistiques de cache
   * @returns {Object} Statistiques de cache
   */
  getCacheStats() {
    return {
      dataCache: this.dataCache.size,
      tokenCache: this.tokenCache.size,
      priceCache: this.priceCache.size
    };
  }
  
  /**
   * Nettoie les caches de données périmées
   * @private
   */
  cleanupDataCache() {
    const now = Date.now();
    
    // Nettoyer le cache de données historiques (plus de 10 minutes)
    for (const [key, value] of this.dataCache.entries()) {
      if (now - value.timestamp > 10 * 60 * 1000) {
        this.dataCache.delete(key);
      }
    }
    
    // Nettoyer le cache de prix (plus de 2 minutes)
    for (const [key, value] of this.priceCache.entries()) {
      if (now - value.timestamp > 2 * 60 * 1000) {
        this.priceCache.delete(key);
      }
    }
    
    // Nettoyer le cache de tokens (plus de 30 minutes)
    for (const [key, value] of this.tokenCache.entries()) {
      if (now - value.timestamp > 30 * 60 * 1000) {
        this.tokenCache.delete(key);
      }
    }
    
    this.emit('debug', `Cache cleanup: ${this.dataCache.size} historical data, ${this.priceCache.size} prices, ${this.tokenCache.size} token lists`);
  }
  
  /**
   * Exporte les logs de trading
   * @param {string} format - Format d'exportation (json ou csv)
   * @returns {string} Logs exportés
   */
  exportTradingLogs(format = 'json') {
    return this.logger.exportLogs(format);
  }
  
  /**
   * Génère un rapport console
   * @returns {string} Rapport formaté pour la console
   */
  generateConsoleReport() {
    return this.visualizer.generateConsoleReport();
  }
  
  /**
   * Génère un rapport HTML
   * @returns {string} Rapport HTML
   */
  generateHtmlReport() {
    return this.visualizer.generateHtmlReport();
  }
  
  /**
   * Génère un rapport interactif avancé avec graphiques
   * @returns {string} Rapport HTML interactif
   */
  generateInteractiveReport() {
    return this.visualizer.generateInteractiveReport();
  }
  
  /**
   * Émet une mise à jour d'état pour les clients connectés
   */
  emitStatusUpdate() {
    if (!this.isRunning) return;
    
    const statusUpdate = {
      timestamp: new Date().toISOString(),
      botStatus: {
        isRunning: this.isRunning,
        uptime: this._calculateRuntime(),
        cyclesRun: this.processingStatus.cycleCount,
        successfulCycles: this.processingStatus.successfulCycles,
        failedCycles: this.processingStatus.failedCycles,
        cacheStats: this.getCacheStats()
      },
      portfolioStatus: this.portfolioManager.getMetrics(),
      openPositions: this.positionManager.getOpenPositions().length
    };
    
    this.emit('status', statusUpdate);
  }
  
  /**
   * Effectue des tâches de nettoyage périodiques
   */
  async performCleanupTasks() {
    try {
      this.emit('info', 'Performing scheduled cleanup tasks');
      
      // Nettoyage des anciens logs
      const deletedFiles = await this.logger.cleanupOldLogs(90); // 90 jours
      
      if (deletedFiles > 0) {
        this.emit('info', `Cleaned up ${deletedFiles} old log files`);
      }
      
      // Exportation automatique des logs
      const exported = await this.logger.exportAndSaveLogs('json');
      
      if (exported) {
        this.emit('info', 'Successfully exported trading logs');
      }
      
      // Nettoyage complet des caches
      this.cleanupDataCache();
      
      return true;
    } catch (error) {
      this.emit('error', new Error(`Error during cleanup tasks: ${error.message}`));
      return false;
    }
  }
  
  /**
   * Active le disjoncteur en cas d'erreurs consécutives
   * @private
   */
  _activateCircuitBreaker() {
    // Arrêter temporairement le bot
    this.isRunning = false;
    
    // Nettoyer les intervalles
    for (const interval of Object.values(this.intervals)) {
      if (interval) clearInterval(interval);
    }
    
    this.emit('warning', `Circuit breaker activated, pausing for ${this.config.errorHandling.circuitBreakerTimeout / 1000} seconds`);
    
    // Redémarrer après le délai configuré
    setTimeout(() => {
      this.emit('info', 'Circuit breaker timeout expired, restarting bot');
      this.start().catch(error => {
        this.emit('error', new Error(`Failed to restart after circuit breaker: ${error.message}`));
      });
    }, this.config.errorHandling.circuitBreakerTimeout);
  }
  
  /**
   * Calcule la durée de fonctionnement du bot
   * @returns {string} Durée formatée
   * @private
   */
  _calculateRuntime() {
    if (!this.startTime) return '0s';
    
    const runtime = Date.now() - this.startTime;
    const seconds = Math.floor(runtime / 1000) % 60;
    const minutes = Math.floor(runtime / (1000 * 60)) % 60;
    const hours = Math.floor(runtime / (1000 * 60 * 60)) % 24;
    const days = Math.floor(runtime / (1000 * 60 * 60 * 24));
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  /**
   * Calcule le nombre d'heures entre deux dates
   * @param {Date|string|number} start - Date de début
   * @param {Date|string|number} end - Date de fin
   * @returns {number} Nombre d'heures
   * @private
   */
  _calculateHoursBetween(start, end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    const diffMs = Math.abs(endDate - startDate);
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }
}

export default TradingBot;