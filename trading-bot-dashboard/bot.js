// bot.js
import { tradingConfig } from './config/tradingConfig.js';
import { EnhancedMomentumStrategy } from './strategies/enhancedMomentumStrategy.js';
import { MarketDataService } from './services/marketDataService.js';
import { RiskManager } from './trading/riskManager.js';
import { PositionManager } from './trading/positionManager.js';
import { PortfolioManager } from './trading/portfolioManager.js';
import { TradeLogger } from './trading/tradeLogger.js';
import { TradingVisualizer } from './utils/tradingVisualizer.js';
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
    
    // Identifiants des intervalles pour le nettoyage
    this.intervals = {
      mainLoop: null,
      statusUpdate: null,
      cleanupTask: null
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
      for (const interval of Object.values(this.intervals)) {
        if (interval) clearInterval(interval);
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
        
        // Étape 2: Traiter chaque token séquentiellement
        for (const token of tokens) {
          // Vérifier si le bot est en cours d'arrêt
          if (this.isStopping) break;
          
          await this.processToken(token);
          
          // Petite pause entre les tokens pour éviter de surcharger les API
          await delay(500);
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
   * Récupère les prix actuels pour tous les tokens dans les positions
   * @returns {Promise<Map>} Map des prix actuels (token -> prix)
   */
  async fetchCurrentPrices() {
    const positions = this.positionManager.getOpenPositions();
    const prices = new Map();
    
    for (const position of positions) {
      try {
        const price = await retry(
          () => this.marketData.getTokenPrice(position.token),
          3,
          1000
        );
        
        if (price) {
          prices.set(position.token, price);
        } else {
          // Si le prix n'est pas disponible, utiliser le prix d'entrée comme fallback
          prices.set(position.token, position.entryPrice);
          this.emit('warning', `Could not fetch current price for ${position.token}, using entry price`);
        }
      } catch (error) {
        this.emit('error', new Error(`Error fetching price for ${position.token}: ${error.message}`));
        // Utiliser le prix d'entrée comme fallback
        prices.set(position.token, position.entryPrice);
      }
    }
    
    return prices;
  }

  /**
   * Récupère les tokens qualifiés selon les critères configurés
   * @returns {Promise<Array>} Liste des tokens qualifiés
   */
  async getQualifiedTokens() {
    try {
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
      
      return validTokens;
    } catch (error) {
      this.emit('error', new Error(`Error getting qualified tokens: ${error.message}`));
      return [];
    }
  }
  
  /**
   * Récupère les données historiques pour un token spécifique
   * @param {string} tokenMint - Adresse du token
   * @param {number} lookbackPeriod - Période de recul en heures (défaut: 50)
   * @returns {Promise<Array>} Données historiques
   */
  async getHistoricalData(tokenMint, lookbackPeriod = 50) {
    try {
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
   * @returns {Promise<Object>} Résultats de la simulation
   */
  async runSimulation(startDate, endDate) {
    if (this.isRunning) {
      this.emit('warning', 'Cannot run simulation while bot is running');
      return {
        success: false,
        error: 'Bot is currently running'
      };
    }
    
    this.emit('info', `Starting simulation from ${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`);
    
    const simulationResult = {
      success: true,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      trades: [],
      metrics: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalProfit: 0,
        winRate: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        sharpeRatio: 0
      }
    };
    
    try {
      // Réinitialiser le portfolio pour la simulation
      const initialCapital = this.config.simulation.initialCapital;
      const simulationPortfolio = new PortfolioManager(initialCapital);
      
      // Récupérer les tokens qualifiés pour la simulation
      const tokens = await this.getQualifiedTokens();
      
      if (!tokens || tokens.length === 0) {
        throw new Error('No qualified tokens found for simulation');
      }
      
      this.emit('info', `Running simulation on ${tokens.length} qualified tokens`);
      
      // Variables pour calculer le drawdown et le Sharpe ratio
      let peakCapital = initialCapital;
      let maxDrawdown = 0;
      let dailyReturns = [];
      let currentCapital = initialCapital;
      
      // Traiter chaque token
      for (const token of tokens) {
        // Récupérer les données historiques complètes pour la période de backtest
        const historicalData = await this.getHistoricalData(
          token.token_mint,
          this._calculateHoursBetween(startDate, endDate)
        );
        
        // S'assurer que nous avons suffisamment de données pour l'analyse
        if (!historicalData || historicalData.length < 50) {
          this.emit('debug', `Insufficient historical data for ${token.token_mint}, skipping`);
          continue;
        }
        
        this.emit('debug', `Processing token ${token.token_mint} with ${historicalData.length} data points`);
        
        // Simuler le trading pour chaque fenêtre de trading
        for (let i = 50; i < historicalData.length; i++) {
          // Obtenir les données de la fenêtre pour l'analyse
          const windowData = historicalData.slice(i - 50, i);
          const prices = windowData.map(d => d.price);
          const volumes = windowData.map(d => d.volume);
          
          // Récupérer les métriques de marché pour la fenêtre actuelle
          const marketData = {
            liquidity: token.liquidity || 0,
            volume24h: token.volume24h || 0,
            priceChange24h: ((prices[prices.length - 1] - prices[prices.length - 25]) / prices[prices.length - 25]) * 100,
            marketCap: token.marketCap || 0,
            fullyDilutedValuation: token.fdv || 0
          };
          
          // Analyser avec la stratégie
          const signal = await this.strategy.analyze(
            token.token_mint,
            prices,
            volumes,
            marketData
          );
          
          // Si nous avons un signal valide, simuler un trade
          if (signal.type !== 'NONE' && signal.confidence >= this.config.trading.minConfidenceThreshold) {
            const trade = this.simulateTrade(
              token.token_mint,
              historicalData[i],
              historicalData.slice(i),
              signal,
              simulationPortfolio
            );
            
            if (trade) {
              simulationResult.trades.push(trade);
              
              // Mettre à jour les métriques
              this.updateSimulationMetrics(simulationResult.metrics, trade);
              
              // Mettre à jour le capital actuel pour le calcul du drawdown
              currentCapital += trade.profit;
              
              // Mettre à jour le peak capital si nécessaire
              if (currentCapital > peakCapital) {
                peakCapital = currentCapital;
              }
              
              // Calculer le drawdown actuel
              const currentDrawdown = ((peakCapital - currentCapital) / peakCapital) * 100;
              maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
              
              // Enregistrer le retour quotidien pour le Sharpe ratio
              const dateKey = new Date(trade.timestamp).toISOString().split('T')[0];
              dailyReturns.push({
                date: dateKey,
                return: (trade.profit / initialCapital) * 100
              });
            }
          }
        }
      }
      
      // Calculer les métriques finales
      if (simulationResult.metrics.totalTrades > 0) {
        // Win rate
        simulationResult.metrics.winRate = 
          (simulationResult.metrics.winningTrades / simulationResult.metrics.totalTrades) * 100;
        
        // Max drawdown
        simulationResult.metrics.maxDrawdown = maxDrawdown;
        
        // Profit factor
        const totalGain = simulationResult.trades
          .filter(t => t.profit > 0)
          .reduce((sum, t) => sum + t.profit, 0);
        
        const totalLoss = Math.abs(simulationResult.trades
          .filter(t => t.profit < 0)
          .reduce((sum, t) => sum + t.profit, 0));
        
        simulationResult.metrics.profitFactor = totalLoss > 0 ? totalGain / totalLoss : totalGain > 0 ? Infinity : 0;
        
        // Sharpe ratio (simplified)
        if (dailyReturns.length > 1) {
          const returns = dailyReturns.map(d => d.return);
          const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
          const stdDev = Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
          );
          
          simulationResult.metrics.sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
        }
      }
      
      this.emit('info', `Simulation completed with ${simulationResult.metrics.totalTrades} trades`);
      
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
   * Simule un trade basé sur les données historiques
   * @param {string} tokenMint - Adresse du token
   * @param {Object} entryData - Données d'entrée
   * @param {Array} futureData - Données futures pour la simulation
   * @param {Object} signal - Signal de trading
   * @param {Object} portfolio - Portfolio simulé
   * @returns {Object|null} Trade simulé ou null
   */
  simulateTrade(tokenMint, entryData, futureData, signal, portfolio) {
    try {
      // Valider les entrées
      if (!tokenMint || !entryData || !entryData.price || !futureData || futureData.length < 2) {
        return null;
      }
      
      // Calculer la taille de position basée sur le portfolio et la gestion des risques
      const positionSize = this.riskManager.calculatePositionSize(
        entryData.price,
        portfolio
      );
      
      // Définir les conditions de sortie (stop loss et take profit)
      const stopLoss = entryData.price * (1 - (this.config.trading.stopLoss / 100));
      const takeProfit = entryData.price * (1 + (this.config.trading.takeProfit / 100));
      
      // Trouver le point de sortie dans les données futures
      let exitData = null;
      let holdingTime = 0;
      let exitReason = 'TIMEOUT';
      
      // Parcourir les données futures (limité à 48 heures max)
      for (let i = 1; i < futureData.length && i < 48; i++) {
        const currentPrice = futureData[i].price;
        holdingTime = futureData[i].timestamp - entryData.timestamp;
        
        // Vérifier si stop loss ou take profit est atteint
        if (currentPrice <= stopLoss) {
          exitData = futureData[i];
          exitReason = 'STOP_LOSS';
          break;
        }
        
        if (currentPrice >= takeProfit) {
          exitData = futureData[i];
          exitReason = 'TAKE_PROFIT';
          break;
        }
        
        // Période maximale de détention (24 heures par défaut)
        const maxHoldingHours = this.config.simulation.maxHoldingPeriodHours || 24;
        if (holdingTime >= maxHoldingHours * 60 * 60 * 1000) {
          exitData = futureData[i];
          exitReason = 'MAX_HOLDING_TIME';
          break;
        }
      }
      
      // Si aucun point de sortie trouvé, utiliser le dernier point de données disponible
      if (!exitData && futureData.length > 1) {
        exitData = futureData[Math.min(24, futureData.length - 1)];
        holdingTime = exitData.timestamp - entryData.timestamp;
        exitReason = 'END_OF_DATA';
      } else if (!exitData) {
        // Pas assez de données futures pour simuler la sortie
        return null;
      }
      
      // Calculer le profit
      const profit = (exitData.price - entryData.price) * positionSize;
      
      // Mettre à jour le portfolio simulé
      portfolio.updatePortfolio({
        token: tokenMint,
        entryPrice: entryData.price,
        exitPrice: exitData.price,
        amount: positionSize,
        profit,
        timestamp: entryData.timestamp,
        holdingTime,
        signal: signal.type
      });
      
      // Retourner le trade simulé
      return {
        id: generateUUID(),
        token: tokenMint,
        entryPrice: entryData.price,
        exitPrice: exitData.price,
        amount: positionSize,
        profit,
        profitPercentage: ((exitData.price - entryData.price) / entryData.price) * 100,
        timestamp: entryData.timestamp,
        exitTimestamp: exitData.timestamp,
        holdingTime,
        signal: signal.type,
        signalConfidence: signal.confidence,
        signalReasons: signal.reasons,
        stopLoss,
        takeProfit,
        exitReason
      };
    } catch (error) {
      this.emit('error', new Error(`Error simulating trade for ${tokenMint}: ${error.message}`));
      return null;
    }
  }
  
  /**
   * Met à jour les métriques de simulation avec les données d'un trade
   * @param {Object} metrics - Métriques à mettre à jour
   * @param {Object} trade - Données du trade
   */
  updateSimulationMetrics(metrics, trade) {
    if (!metrics || !trade) return;
    
    metrics.totalTrades++;
    metrics.totalProfit += trade.profit;
    
    if (trade.profit > 0) {
      metrics.winningTrades++;
    } else {
      metrics.losingTrades++;
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
          : null
      }
    };
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
        failedCycles: this.processingStatus.failedCycles
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