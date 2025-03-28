// CycleManager.js
import EventEmitter from 'events';
import { delay } from '../utils/helpers.js';

/**
 * Gère les cycles de trading du bot
 * Responsable du timing, de l'orchestration et de l'exécution des cycles
 */
export class CycleManager extends EventEmitter {
  /**
   * Crée une instance de CycleManager
   * @param {Object} config - Configuration globale
   * @param {Object} marketData - Service de données de marché
   * @param {Object} strategy - Stratégie de trading
   * @param {Object} riskManager - Gestionnaire de risque
   * @param {Object} positionManager - Gestionnaire de positions
   * @param {Object} portfolioManager - Gestionnaire de portefeuille
   * @param {Object} logger - Service de journalisation
   */
  constructor(
    config,
    marketData,
    strategy,
    riskManager,
    positionManager,
    portfolioManager,
    logger
  ) {
    super();
    this.config = config;
    this.marketData = marketData;
    this.strategy = strategy;
    this.riskManager = riskManager;
    this.positionManager = positionManager;
    this.portfolioManager = portfolioManager;
    this.logger = logger;

    // État du gestionnaire de cycles
    this.isRunning = false;
    this.isStopping = false;
    this.cycleInterval = null;
    this.lastCycleTime = null;
    
    // Métriques de cycle
    this.metrics = {
      cycleCount: 0,
      successfulCycles: 0,
      failedCycles: 0,
      lastCycleTime: null,
      avgCycleDuration: 0,
      totalCycleDuration: 0
    };

    // État du circuit breaker
    this.circuitBreaker = {
      tripped: false,
      consecutiveErrors: 0,
      lastError: null,
      cooldownUntil: null,
      maxConsecutiveErrors: config.errorHandling?.maxConsecutiveErrors || 3
    };
  }

  /**
   * Démarre le gestionnaire de cycles
   * @returns {Promise<boolean>} Succès ou échec
   */
  async start() {
    if (this.isRunning) {
      this.emit('warning', 'Cycle manager is already running');
      return false;
    }

    try {
      this.isRunning = true;
      this.isStopping = false;
      this.emit('info', 'Cycle manager started');

      // Exécuter immédiatement un premier cycle
      await this.runTradingCycle();

      // Configurer l'intervalle pour les cycles suivants
      const interval = this.config.trading.cycleInterval || 60000; // Défaut: 1 minute
      this.cycleInterval = setInterval(() => this.runTradingCycle(), interval);

      return true;
    } catch (error) {
      this.isRunning = false;
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Arrête le gestionnaire de cycles
   * @returns {Promise<boolean>} Succès ou échec
   */
  async stop() {
    if (!this.isRunning) {
      this.emit('warning', 'Cycle manager is not running');
      return false;
    }

    try {
      this.isStopping = true;
      this.emit('info', 'Stopping cycle manager...');

      // Nettoyer l'intervalle
      if (this.cycleInterval) {
        clearInterval(this.cycleInterval);
        this.cycleInterval = null;
      }

      this.isRunning = false;
      this.isStopping = false;
      this.emit('info', 'Cycle manager stopped');
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Exécute un cycle de trading
   * @returns {Promise<boolean>} Succès ou échec du cycle
   */
  async runTradingCycle() {
    // Si le système est en cours d'arrêt ou le circuit breaker est déclenché, ignorer ce cycle
    if (this.isStopping || this.checkCircuitBreaker()) {
      return false;
    }

    const cycleStartTime = Date.now();
    this.metrics.cycleCount++;
    this.metrics.lastCycleTime = cycleStartTime;
    
    try {
      this.emit('debug', `Starting trading cycle #${this.metrics.cycleCount}`);

      // Étape 1: Obtenir des tokens qualifiés à analyser
      const tokens = await this.getQualifiedTokens();
      if (!tokens || tokens.length === 0) {
        this.emit('info', 'No qualified tokens found in this cycle');
        return this.completeCycle(cycleStartTime, true);
      }

      // Étape 2: Analyser chaque token pour des signaux de trading
      for (const token of tokens) {
        // Si on est en train d'arrêter, ne pas traiter les tokens restants
        if (this.isStopping) break;

        await this.processToken(token);
      }

      // Étape 3: Vérifier les positions existantes
      await this.checkPositions();

      // Marquer le cycle comme réussi
      this.metrics.successfulCycles++;
      this.resetCircuitBreaker(); // Réinitialiser le circuit breaker après un cycle réussi
      
      return this.completeCycle(cycleStartTime, true);
    } catch (error) {
      this.metrics.failedCycles++;
      this.incrementCircuitBreaker(error);
      this.emit('error', new Error(`Cycle error: ${error.message}`));
      
      return this.completeCycle(cycleStartTime, false);
    }
  }

  /**
   * Récupère les tokens qualifiés pour analyse
   * @private
   * @returns {Promise<Array>} Liste de tokens qualifiés
   */
  async getQualifiedTokens() {
    try {
      // Récupérer les données du marché
      const marketData = await this.marketData.getTopTokens(
        this.config.trading.maxTokensToAnalyze || 50
      );

      // Filtrer selon les critères de liquidité et volume
      const qualifiedTokens = marketData.filter(token => {
        return (
          token.liquidity >= this.config.trading.minLiquidity &&
          token.volume24h >= this.config.trading.minVolume24h
        );
      });

      return qualifiedTokens;
    } catch (error) {
      this.emit('error', new Error(`Error getting qualified tokens: ${error.message}`));
      return [];
    }
  }

  /**
   * Traite un token pour analyse et trading potentiel
   * @private
   * @param {Object} token - Objet token à analyser
   */
  async processToken(token) {
    try {
      // Vérifier si une position est déjà ouverte pour ce token
      const openPositions = this.positionManager.getOpenPositions();
      const hasOpenPosition = openPositions.some(p => p.token === token.token_mint);
      
      if (hasOpenPosition) {
        this.emit('debug', `Already have a position for ${token.token_mint}, skipping`);
        return;
      }

      // Obtenir les données historiques pour analyse
      const prices = await this.getHistoricalPrices(token.token_mint);
      const volumes = await this.getHistoricalVolumes(token.token_mint);
      
      if (!prices || prices.length < 20) {
        this.emit('debug', `Insufficient price data for ${token.token_mint}`);
        return;
      }

      // Analyser avec la stratégie
      const signal = await this.strategy.analyze(token.token_mint, prices, volumes, token);

      // Si on a un signal clair et que le risk manager autorise
      if (signal.type !== 'NONE' && signal.confidence >= this.config.trading.minConfidenceThreshold) {
        if (this.riskManager.canTrade(this.portfolioManager)) {
          // Calculer la taille de position
          const currentPrice = prices[prices.length - 1];
          const positionSize = this.riskManager.calculatePositionSize(currentPrice, this.portfolioManager);
          
          // Ouvrir la position
          const position = await this.positionManager.openPosition(
            token.token_mint,
            currentPrice,
            positionSize
          );

          if (position) {
            this.emit('info', `Opened position for ${token.token_mint} at ${currentPrice}`);
          }
        } else {
          this.emit('debug', `Risk manager rejected trade for ${token.token_mint}`);
        }
      }
    } catch (error) {
      this.emit('error', new Error(`Error processing token ${token.token_mint}: ${error.message}`));
    }
  }

  /**
   * Vérifie les positions ouvertes pour fermeture potentielle
   * @private
   */
  async checkPositions() {
    try {
      // Récupérer les prix actuels
      const currentPrices = await this.getCurrentPrices();
      
      // Pas de prix, pas de vérification
      if (!currentPrices || currentPrices.size === 0) return;

      // Vérifier les positions
      const closedPositions = await this.positionManager.checkPositions(currentPrices);
      
      // Traiter les positions fermées
      for (const position of closedPositions) {
        // Mettre à jour le portfolio
        this.portfolioManager.updatePortfolio(position);
        
        // Logger la transaction
        const tradeLog = this.logger.logTrade(position);
        this.emit('trade', tradeLog);
      }

      if (closedPositions.length > 0) {
        this.emit('info', `Closed ${closedPositions.length} positions`);
      }
    } catch (error) {
      this.emit('error', new Error(`Error checking positions: ${error.message}`));
    }
  }

  /**
   * Récupère les prix actuels pour tous les tokens en position ouverte
   * @private
   * @returns {Promise<Map>} Map des prix actuels
   */
  async getCurrentPrices() {
    try {
      const positions = this.positionManager.getOpenPositions();
      if (positions.length === 0) return new Map();

      const tokens = positions.map(p => p.token);
      const priceMap = new Map();

      for (const token of tokens) {
        const price = await this.marketData.getTokenPrice(token);
        if (price) {
          priceMap.set(token, price);
        }
      }

      return priceMap;
    } catch (error) {
      this.emit('error', new Error(`Error getting current prices: ${error.message}`));
      return new Map();
    }
  }

  /**
   * Récupère les données historiques de prix pour un token
   * @private
   * @param {string} tokenMint - Adresse du token
   * @returns {Promise<Array>} Historique des prix
   */
  async getHistoricalPrices(tokenMint) {
    try {
      // Récupérer l'historique des 7 derniers jours avec intervalle de 1h
      const endTime = Date.now();
      const startTime = endTime - (7 * 24 * 60 * 60 * 1000);
      
      const priceData = await this.marketData.getHistoricalPrices(
        tokenMint,
        startTime,
        endTime,
        '1h'
      );

      return priceData.map(d => d.price);
    } catch (error) {
      this.emit('error', new Error(`Error getting historical prices for ${tokenMint}: ${error.message}`));
      return [];
    }
  }

  /**
   * Récupère les données historiques de volume pour un token
   * @private
   * @param {string} tokenMint - Adresse du token
   * @returns {Promise<Array>} Historique des volumes
   */
  async getHistoricalVolumes(tokenMint) {
    try {
      // Récupérer l'historique des 7 derniers jours avec intervalle de 1h
      const endTime = Date.now();
      const startTime = endTime - (7 * 24 * 60 * 60 * 1000);
      
      const volumeData = await this.marketData.getHistoricalVolumes(
        tokenMint,
        startTime,
        endTime,
        '1h'
      );

      return volumeData.map(d => d.volume);
    } catch (error) {
      this.emit('error', new Error(`Error getting historical volumes for ${tokenMint}: ${error.message}`));
      return [];
    }
  }

  /**
   * Vérifie si le circuit breaker est déclenché
   * @private
   * @returns {boolean} Vrai si le circuit breaker est déclenché
   */
  checkCircuitBreaker() {
    if (!this.circuitBreaker.tripped) return false;

    // Vérifier si le temps de cooldown est écoulé
    if (this.circuitBreaker.cooldownUntil && Date.now() > this.circuitBreaker.cooldownUntil) {
      this.resetCircuitBreaker();
      this.emit('info', 'Circuit breaker reset after cooldown period');
      return false;
    }

    return true;
  }

  /**
   * Incrémente le compteur d'erreurs du circuit breaker
   * @private
   * @param {Error} error - Erreur rencontrée
   */
  incrementCircuitBreaker(error) {
    this.circuitBreaker.consecutiveErrors++;
    this.circuitBreaker.lastError = error;

    // Si seuil atteint, déclencher le circuit breaker
    if (this.circuitBreaker.consecutiveErrors >= this.circuitBreaker.maxConsecutiveErrors) {
      this.circuitBreaker.tripped = true;
      
      // Définir le temps de cooldown
      const cooldownMs = this.config.errorHandling?.circuitBreakerTimeout || 300000; // 5 minutes par défaut
      this.circuitBreaker.cooldownUntil = Date.now() + cooldownMs;
      
      this.emit('warning', `Circuit breaker tripped after ${this.circuitBreaker.consecutiveErrors} consecutive errors. Cooling down for ${cooldownMs/1000} seconds`);
    }
  }

  /**
   * Réinitialise le circuit breaker
   * @private
   */
  resetCircuitBreaker() {
    this.circuitBreaker.tripped = false;
    this.circuitBreaker.consecutiveErrors = 0;
    this.circuitBreaker.lastError = null;
    this.circuitBreaker.cooldownUntil = null;
  }

  /**
   * Termine et enregistre les métriques d'un cycle
   * @private
   * @param {number} startTime - Temps de début du cycle
   * @param {boolean} success - Si le cycle a réussi
   * @returns {boolean} Succès ou échec
   */
  completeCycle(startTime, success) {
    const cycleDuration = Date.now() - startTime;
    
    // Mettre à jour les métriques de durée
    this.metrics.totalCycleDuration += cycleDuration;
    this.metrics.avgCycleDuration = this.metrics.totalCycleDuration / this.metrics.cycleCount;
    
    this.emit('debug', `Completed trading cycle in ${cycleDuration}ms`);
    return success;
  }

  /**
   * Retourne les métriques de cycle
   * @returns {Object} Métriques de cycle
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Nettoie les ressources du gestionnaire de cycles
   */
  cleanup() {
    if (this.cycleInterval) {
      clearInterval(this.cycleInterval);
      this.cycleInterval = null;
    }
  }
}

export default CycleManager;//CycleManager.js
