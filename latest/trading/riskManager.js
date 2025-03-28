// trading/RiskManager.js
import EventEmitter from 'events';

/**
 * Gestionnaire de risque optimisé
 * Responsable de l'évaluation et de la gestion du risque pour les décisions de trading
 */
export class RiskManager extends EventEmitter {
  /**
   * Crée une instance de RiskManager
   * @param {Object} config - Configuration globale
   */
  constructor(config) {
    super();
    this.config = config;
    
    // Paramètres de risque principaux
    this.maxDrawdown = config.risk?.maxDrawdown || -15; // Maximum drawdown percentage allowed
    this.maxDailyLoss = config.risk?.maxDailyLoss || -5; // Maximum daily loss percentage
    this.maxExposure = config.risk?.maxExposure || 40; // Maximum portfolio exposure percentage
    this.minLiquidity = config.trading?.minLiquidity || 100000; // Minimum token liquidity
    
    // Paramètres de taille de position
    this.baseTradeSizePercent = config.trading?.tradeSize || 2; // Base trade size as percentage of portfolio
    this.maxPositionSize = config.risk?.maxPositionSize || 10; // Maximum position size as percentage
    this.positionSizeScaling = config.risk?.positionSizeScaling || 'fixed'; // 'fixed', 'kelly', 'volatility'
    
    // Limites de volatilité
    this.maxVolatility = config.risk?.maxVolatility || 50; // Maximum acceptable volatility (%)
    this.volatilityMultiplier = config.risk?.volatilityMultiplier || 0.5; // Reduce position size based on volatility
    
    // Paramètres de corrélation
    this.maxCorrelation = config.risk?.maxCorrelation || 0.8; // Maximum correlation between positions
    this.sectorExposureLimit = config.risk?.sectorExposureLimit || 25; // Max exposure per sector (%)
    
    // Statistiques journalières
    this.dailyStats = {
      date: new Date().toISOString().split('T')[0],
      trades: 0,
      profit: 0,
      losses: 0,
      highestProfit: 0,
      biggestLoss: 0,
      riskTaken: 0,
      exposurePeak: 0
    };
    
    // Historique des trades pour analyse
    this.tradeHistory = [];
    
    // État de marché
    this.marketState = 'NORMAL'; // 'NORMAL', 'VOLATILE', 'BEARISH', 'BULLISH'
    
    // Statistiques du gestionnaire
    this.stats = {
      tradesRejected: 0,
      tradesAccepted: 0,
      riskAdjustments: 0
    };
    
    // Initialiser le reset automatique des stats journalières
    this._setupDailyReset();
  }

  /**
   * Vérifie si un trade est autorisé par les règles de gestion du risque
   * @param {Object} portfolio - État du portefeuille
   * @param {Object} [token={}] - Données du token (optionnel)
   * @param {Object} [signal={}] - Signal de trading (optionnel)
   * @returns {boolean} True si le trade est autorisé
   */
  canTrade(portfolio, token = {}, signal = {}) {
    // Vérifications essentielles
    if (!portfolio) {
      this._rejectTrade('PORTFOLIO_DATA_MISSING');
      return false;
    }
    
    // Vérifier les limites quotidiennes
    if (!this.checkDailyLimits()) {
      this._rejectTrade('DAILY_RISK_LIMIT_REACHED');
      return false;
    }
    
    // Vérifier le drawdown
    if (!this.checkDrawdown(portfolio)) {
      this._rejectTrade('MAX_DRAWDOWN_REACHED');
      return false;
    }
    
    // Vérifier l'exposition maximale
    if (!this.checkExposure(portfolio)) {
      this._rejectTrade('MAX_EXPOSURE_REACHED');
      return false;
    }
    
    // Vérifier les conditions spécifiques au token si disponibles
    if (token && Object.keys(token).length > 0) {
      if (!this.checkTokenRisk(token, signal)) {
        this._rejectTrade('TOKEN_RISK_TOO_HIGH');
        return false;
      }
    }
    
    // Vérifier les conditions de marché
    if (this.marketState === 'VOLATILE' && !this.config.risk?.allowVolatileMarket) {
      this._rejectTrade('MARKET_TOO_VOLATILE');
      return false;
    }
    
    // Si toutes les vérifications sont passées
    this.stats.tradesAccepted++;
    return true;
  }

  /**
   * Calcule la taille optimale de la position
   * @param {number} price - Prix d'entrée
   * @param {Object} portfolio - État du portefeuille
   * @param {Object} [token={}] - Données du token (optionnel)
   * @param {Object} [signal={}] - Signal de trading (optionnel)
   * @returns {number} Taille de position calculée
   */
  calculatePositionSize(price, portfolio, token = {}, signal = {}) {
    if (!price || !portfolio) {
      return 0;
    }
    
    // Récupérer le capital total disponible
    const availableCapital = portfolio.currentCapital;
    
    // Calculer la taille de base (% du portefeuille)
    let baseAmount = availableCapital * (this.baseTradeSizePercent / 100);
    
    // Ajuster selon la méthode sélectionnée
    switch (this.positionSizeScaling) {
      case 'kelly':
        // Appliquer la formule du critère de Kelly (simplifié)
        if (signal && signal.confidence) {
          // Calculer le ratio gain/perte
          const takeProfit = this.config.trading.takeProfit / 100;
          const stopLoss = this.config.trading.stopLoss / 100;
          const winRate = signal.confidence;
          
          // K% = (BP - Q) / B
          // B = ratio gain/perte, P = probabilité de gain, Q = (1-P) probabilité de perte
          const kellyPercentage = ((takeProfit / stopLoss) * winRate - (1 - winRate)) / (takeProfit / stopLoss);
          
          // Limiter à un maximum raisonnable et éviter les valeurs négatives
          const adjustedKelly = Math.max(0, Math.min(kellyPercentage, this.maxPositionSize / 100));
          
          baseAmount = availableCapital * adjustedKelly;
        }
        break;
        
      case 'volatility':
        // Ajuster en fonction de la volatilité si disponible
        if (token && token.volatility) {
          // Réduire la taille pour les tokens très volatils
          const volatilityFactor = Math.max(0.2, 1 - (token.volatility / this.maxVolatility) * this.volatilityMultiplier);
          baseAmount *= volatilityFactor;
          
          this.stats.riskAdjustments++;
        }
        break;
        
      case 'adaptive':
        // Ajuster en fonction de la taille du portefeuille
        // Plus le portefeuille est grand, plus les positions sont petites en %
        if (availableCapital > 50000) {
          const scaleFactor = 1 - Math.log10(availableCapital / 10000) * 0.1;
          baseAmount = availableCapital * (this.baseTradeSizePercent / 100) * Math.max(0.5, scaleFactor);
        }
        
        // Ajuster en fonction de la confiance du signal
        if (signal && signal.confidence) {
          baseAmount *= 0.5 + (signal.confidence * 0.5);
        }
        break;
        
      case 'fixed':
      default:
        // Utiliser la taille fixe configurée
        baseAmount = availableCapital * (this.baseTradeSizePercent / 100);
    }
    
    // Calculer le nombre d'unités en fonction du prix
    const units = baseAmount / price;
    
    // Mettre à jour les statistiques
    this.dailyStats.riskTaken += baseAmount / availableCapital * 100;
    
    return units;
  }

  /**
   * Vérifie les limites quotidiennes de perte
   * @returns {boolean} True si les limites ne sont pas dépassées
   */
  checkDailyLimits() {
    // Calculer le P&L quotidien
    const dailyPnL = this.dailyStats.profit + this.dailyStats.losses;
    
    // Vérifier si la perte quotidienne dépasse la limite
    if (dailyPnL / 100 < this.maxDailyLoss) {
      this.emit('risk_limit_reached', {
        type: 'DAILY_LOSS_LIMIT',
        current: dailyPnL,
        limit: this.maxDailyLoss,
        reason: 'Daily loss limit reached'
      });
      return false;
    }
    
    return true;
  }

  /**
   * Vérifie si le drawdown est dans les limites acceptables
   * @param {Object} portfolio - État du portefeuille
   * @returns {boolean} True si le drawdown est acceptable
   */
  checkDrawdown(portfolio) {
    // Calculer le drawdown actuel
    const peakCapital = portfolio.peakCapital || portfolio.initialCapital;
    const currentCapital = portfolio.currentCapital;
    
    const drawdown = ((currentCapital - peakCapital) / peakCapital) * 100;
    
    // Vérifier si le drawdown dépasse la limite
    if (drawdown < this.maxDrawdown) {
      this.emit('risk_limit_reached', {
        type: 'MAX_DRAWDOWN',
        current: drawdown,
        limit: this.maxDrawdown,
        reason: 'Maximum drawdown reached'
      });
      return false;
    }
    
    return true;
  }

  /**
   * Vérifie l'exposition totale du portefeuille
   * @param {Object} portfolio - État du portefeuille
   * @returns {boolean} True si l'exposition est acceptable
   */
  checkExposure(portfolio) {
    // Calculer l'exposition actuelle
    const openPositions = portfolio.positions || [];
    let totalExposure = 0;
    
    for (const position of openPositions) {
      totalExposure += position.amount * position.entryPrice;
    }
    
    const exposurePercent = (totalExposure / portfolio.currentCapital) * 100;
    
    // Mettre à jour le pic d'exposition journalier
    this.dailyStats.exposurePeak = Math.max(this.dailyStats.exposurePeak, exposurePercent);
    
    // Vérifier si l'exposition dépasse la limite
    if (exposurePercent > this.maxExposure) {
      this.emit('risk_limit_reached', {
        type: 'MAX_EXPOSURE',
        current: exposurePercent,
        limit: this.maxExposure,
        reason: 'Maximum portfolio exposure reached'
      });
      return false;
    }
    
    return true;
  }

  /**
   * Vérifie les risques spécifiques au token
   * @param {Object} token - Données du token
   * @param {Object} signal - Signal de trading
   * @returns {boolean} True si le risque est acceptable
   */
  checkTokenRisk(token, signal = {}) {
    // Vérifier la liquidité minimale
    if (token.liquidity && token.liquidity < this.minLiquidity) {
      this.emit('risk_warning', {
        type: 'LOW_LIQUIDITY',
        token: token.token_mint || token.symbol,
        liquidity: token.liquidity,
        minRequired: this.minLiquidity
      });
      return false;
    }
    
    // Vérifier la volatilité si disponible
    if (token.volatility && token.volatility > this.maxVolatility) {
      this.emit('risk_warning', {
        type: 'HIGH_VOLATILITY',
        token: token.token_mint || token.symbol,
        volatility: token.volatility,
        maxAllowed: this.maxVolatility
      });
      return false;
    }
    
    // Si signal disponible, vérifier la confiance minimale
    const minConfidence = this.config.trading?.minConfidenceThreshold || 0.6;
    if (signal && signal.confidence && signal.confidence < minConfidence) {
      return false;
    }
    
    return true;
  }

  /**
   * Met à jour les statistiques avec un trade réalisé
   * @param {Object} trade - Données du trade
   */
  updateStats(trade) {
    if (!trade) return;
    
    // S'assurer que les stats sont pour le jour courant
    this.checkAndResetDaily();
    
    this.dailyStats.trades++;
    
    // Mettre à jour profits/pertes
    if (trade.profit > 0) {
      this.dailyStats.profit += trade.profit;
      this.dailyStats.highestProfit = Math.max(this.dailyStats.highestProfit, trade.profit);
    } else {
      this.dailyStats.losses += trade.profit;
      this.dailyStats.biggestLoss = Math.min(this.dailyStats.biggestLoss, trade.profit);
    }
    
    // Ajouter au historique limité (garder les 100 derniers)
    this.tradeHistory.unshift({
      token: trade.token,
      profit: trade.profit,
      profitPercentage: trade.profitPercentage,
      timestamp: trade.timestamp || Date.now()
    });
    
    if (this.tradeHistory.length > 100) {
      this.tradeHistory.pop();
    }
    
    // Vérifier si les limites ont été atteintes
    this.checkDailyLimits();
  }

  /**
   * Vérifie si les stats journalières doivent être réinitialisées
   * @private
   */
  checkAndResetDaily() {
    const today = new Date().toISOString().split('T')[0];
    
    if (this.dailyStats.date !== today) {
      this.resetDailyStats();
    }
  }

  /**
   * Réinitialise les statistiques journalières
   */
  resetDailyStats() {
    this.dailyStats = {
      date: new Date().toISOString().split('T')[0],
      trades: 0,
      profit: 0,
      losses: 0,
      highestProfit: 0,
      biggestLoss: 0,
      riskTaken: 0,
      exposurePeak: 0
    };
  }

  /**
   * Configure la réinitialisation automatique des stats journalières
   * @private
   */
  _setupDailyReset() {
    // Vérifier toutes les heures si nous avons changé de jour
    setInterval(() => {
      this.checkAndResetDaily();
    }, 60 * 60 * 1000); // 1 heure
  }

  /**
   * Rejette un trade et met à jour les statistiques
   * @private
   * @param {string} reason - Raison du rejet
   */
  _rejectTrade(reason) {
    this.stats.tradesRejected++;
    
    // Émettre un événement détaillant la raison du rejet
    this.emit('trade_rejected', {
      reason,
      timestamp: Date.now(),
      stats: { ...this.stats }
    });
  }

  /**
   * Met à jour la configuration du gestionnaire de risque
   * @param {Object} newConfig - Nouvelle configuration
   */
  updateConfig(newConfig) {
    // Mettre à jour uniquement les paramètres de risque
    if (newConfig.risk) {
      this.maxDrawdown = newConfig.risk.maxDrawdown || this.maxDrawdown;
      this.maxDailyLoss = newConfig.risk.maxDailyLoss || this.maxDailyLoss;
      this.maxExposure = newConfig.risk.maxExposure || this.maxExposure;
      this.maxVolatility = newConfig.risk.maxVolatility || this.maxVolatility;
      this.volatilityMultiplier = newConfig.risk.volatilityMultiplier || this.volatilityMultiplier;
      this.maxCorrelation = newConfig.risk.maxCorrelation || this.maxCorrelation;
      this.sectorExposureLimit = newConfig.risk.sectorExposureLimit || this.sectorExposureLimit;
      this.positionSizeScaling = newConfig.risk.positionSizeScaling || this.positionSizeScaling;
      this.maxPositionSize = newConfig.risk.maxPositionSize || this.maxPositionSize;
    }
    
    // Mettre à jour les paramètres de trading pertinents
    if (newConfig.trading) {
      this.baseTradeSizePercent = newConfig.trading.tradeSize || this.baseTradeSizePercent;
      this.minLiquidity = newConfig.trading.minLiquidity || this.minLiquidity;
    }
    
    // Mettre à jour la configuration complète
    this.config = { ...this.config, ...newConfig };
    
    this.emit('config_updated', {
      riskParams: {
        maxDrawdown: this.maxDrawdown,
        maxDailyLoss: this.maxDailyLoss,
        maxExposure: this.maxExposure,
        baseTradeSizePercent: this.baseTradeSizePercent
      }
    });
  }

  /**
   * Met à jour l'état du marché pour ajuster la gestion du risque
   * @param {string} state - État du marché ('NORMAL', 'VOLATILE', 'BEARISH', 'BULLISH')
   * @param {Object} [marketData={}] - Données de marché supplémentaires
   */
  updateMarketState(state, marketData = {}) {
    if (!['NORMAL', 'VOLATILE', 'BEARISH', 'BULLISH'].includes(state)) {
      return;
    }
    
    const previousState = this.marketState;
    this.marketState = state;
    
    // Si changement d'état, adapter les paramètres de risque
    if (previousState !== state) {
      switch (state) {
        case 'VOLATILE':
          // Réduire l'exposition en marché volatil
          this.maxExposure = Math.min(this.maxExposure, 30);
          this.baseTradeSizePercent = Math.min(this.baseTradeSizePercent, 1.5);
          break;
          
        case 'BEARISH':
          // Être plus conservateur en marché baissier
          this.maxExposure = Math.min(this.maxExposure, 25);
          this.baseTradeSizePercent = Math.min(this.baseTradeSizePercent, 1);
          break;
          
        case 'BULLISH':
          // Permettre plus d'exposition en marché haussier
          this.maxExposure = Math.min(this.config.risk?.maxExposure || 40, 50);
          this.baseTradeSizePercent = this.config.trading?.tradeSize || 2;
          break;
          
        case 'NORMAL':
        default:
          // Restaurer les paramètres par défaut
          this.maxExposure = this.config.risk?.maxExposure || 40;
          this.baseTradeSizePercent = this.config.trading?.tradeSize || 2;
      }
      
      this.emit('market_state_change', {
        previousState,
        newState: state,
        adjustedRiskParams: {
          maxExposure: this.maxExposure,
          baseTradeSizePercent: this.baseTradeSizePercent
        }
      });
    }
  }

  /**
   * Récupère les statistiques du gestionnaire de risque
   * @returns {Object} Statistiques complètes
   */
  getStats() {
    return {
      dailyStats: { ...this.dailyStats },
      overallStats: { ...this.stats },
      riskParameters: {
        maxDrawdown: this.maxDrawdown,
        maxDailyLoss: this.maxDailyLoss,
        maxExposure: this.maxExposure,
        baseTradeSizePercent: this.baseTradeSizePercent,
        positionSizeScaling: this.positionSizeScaling,
        maxVolatility: this.maxVolatility
      },
      marketState: this.marketState,
      recentTrades: this.tradeHistory.slice(0, 10)
    };
  }
}

export default RiskManager;