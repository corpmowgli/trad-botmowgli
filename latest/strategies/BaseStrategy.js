// strategies/BaseStrategy.js
import { technicalAnalysis } from '../utils/indicators.js';

/**
 * Classe de base pour les stratégies de trading
 * Fournit une structure et des méthodes communes pour toutes les stratégies
 */
export class BaseStrategy {
  /**
   * Crée une nouvelle instance de stratégie
   * @param {Object} config - Configuration pour la stratégie
   */
  constructor(config) {
    this.config = config;
    
    // Configuration par défaut pour les indicateurs
    this.indicatorConfig = {
      rsi: {
        period: config.indicators?.rsi?.period || 14,
        oversold: config.indicators?.rsi?.oversold || 30,
        overbought: config.indicators?.rsi?.overbought || 70
      },
      macd: {
        fastPeriod: config.indicators?.macd?.fastPeriod || 12,
        slowPeriod: config.indicators?.macd?.slowPeriod || 26,
        signalPeriod: config.indicators?.macd?.signalPeriod || 9
      },
      bollingerBands: {
        period: config.indicators?.bollingerBands?.period || 20,
        stdDev: config.indicators?.bollingerBands?.stdDev || 2
      },
      volumeProfile: {
        lookback: config.indicators?.volumeProfile?.lookback || 24,
        threshold: config.indicators?.volumeProfile?.threshold || 1.2
      }
    };
    
    // Statistiques de performance
    this.performance = {
      totalSignals: 0,
      correctSignals: 0,
      falsePositives: 0,
      profitableTokens: new Set(),
      signalStrengthMetrics: {
        weak: { total: 0, correct: 0 },
        medium: { total: 0, correct: 0 },
        strong: { total: 0, correct: 0 }
      },
      signalHistory: []
    };
    
    // Cache des derniers signaux
    this.signalCache = new Map();
  }

  /**
   * Méthode d'analyse principale à implémenter par les classes filles
   * @abstract
   * @param {string} token - Identifiant du token
   * @param {Array<number>} prices - Historique des prix
   * @param {Array<number>} volumes - Historique des volumes
   * @param {Object} marketData - Données supplémentaires sur le marché
   * @returns {Promise<Object>} Signal de trading
   */
  async analyze(token, prices, volumes, marketData) {
    throw new Error('La méthode analyze() doit être implémentée par la classe fille');
  }

  /**
   * Calcule les indicateurs techniques
   * @param {Array<number>} prices - Historique des prix
   * @returns {Promise<Object>} Indicateurs calculés
   */
  async calculateIndicators(prices) {
    const { rsi, macd, bb } = await technicalAnalysis.calculateIndicators(prices);
    
    // Calcul de moyennes mobiles
    const ema50 = await technicalAnalysis.calculateEMA(prices, 50);
    const ema200 = await technicalAnalysis.calculateEMA(prices, 200);
    
    // Calcul de support et résistance
    const supportResistance = this.calculateSupportResistance(prices);
    
    return {
      rsi,
      macd,
      bb,
      ema50: ema50[ema50.length - 1],
      ema200: ema200[ema200.length - 1],
      supportResistance
    };
  }

  /**
   * Valide les données d'entrée
   * @param {string} token - Identifiant du token
   * @param {Array<number>} prices - Historique des prix
   * @param {Array<number>} volumes - Historique des volumes
   * @returns {boolean} Validité des données
   */
  validateInputData(token, prices, volumes) {
    // Vérifier que les tableaux ne sont pas vides
    if (!token || !prices || !volumes) {
      return false;
    }
    
    // Vérifier la longueur minimale pour l'analyse
    const minDataPoints = 30; // Au moins 30 points pour une analyse fiable
    if (prices.length < minDataPoints || volumes.length < minDataPoints) {
      return false;
    }
    
    // Vérifier la présence de valeurs nulles ou NaN
    if (prices.some(price => price === null || isNaN(price) || price <= 0) ||
        volumes.some(volume => volume === null || isNaN(volume) || volume < 0)) {
      return false;
    }
    
    return true;
  }

  /**
   * Analyser la tendance générale des prix
   * @param {Array<number>} prices - Historique des prix
   * @returns {Object} Analyse de tendance
   */
  analyzeTrend(prices) {
    if (prices.length < 10) {
      return { 
        direction: 'NEUTRAL', 
        strength: 0, 
        description: 'Données insuffisantes pour l\'analyse de tendance'
      };
    }
    
    // Calculer les tendances à court, moyen et long terme
    const shortTerm = this.calculateTrendStrength(prices.slice(-10));
    const mediumTerm = this.calculateTrendStrength(prices.slice(-20));
    const longTerm = prices.length >= 50 ? this.calculateTrendStrength(prices.slice(-50)) : 0;
    
    // Calculer EMA50 et EMA200 pour confirmation
    const ema50 = technicalAnalysis.calculateEMA(prices, 50);
    const ema200 = prices.length >= 200 ? technicalAnalysis.calculateEMA(prices, 200) : null;
    
    const lastEma50 = ema50[ema50.length - 1];
    
    // Calculer la tendance globale
    let direction = 'NEUTRAL';
    let strength = 0;
    let description = 'Tendance neutre';
    
    // Si EMA200 est disponible, vérifier les croisements
    if (ema200 && ema200.length > 0) {
      const lastEma200 = ema200[ema200.length - 1];
      
      // Golden cross (EMA50 croise au-dessus EMA200)
      const isGoldenCross = ema50[ema50.length - 2] <= ema200[ema200.length - 2] && 
                            lastEma50 > lastEma200;
                            
      // Death cross (EMA50 croise au-dessous EMA200)
      const isDeathCross = ema50[ema50.length - 2] >= ema200[ema200.length - 2] && 
                           lastEma50 < lastEma200;
      
      if (isGoldenCross) {
        direction = 'UP';
        strength = 0.8;
        description = 'Golden Cross détecté (EMA50 croise au-dessus EMA200)';
      } else if (isDeathCross) {
        direction = 'DOWN';
        strength = 0.8;
        description = 'Death Cross détecté (EMA50 croise au-dessous EMA200)';
      } else if (lastEma50 > lastEma200) {
        // Prix au-dessus des EMAs - tendance haussière
        strength = 0.6;
        direction = 'UP';
        description = 'Tendance haussière (prix au-dessus des EMAs)';
      } else {
        // Prix au-dessous des EMAs - tendance baissière
        strength = 0.6;
        direction = 'DOWN';
        description = 'Tendance baissière (prix au-dessous des EMAs)';
      }
    }
    
    // Si pas d'EMA200, utiliser les calculs de force de tendance
    if (direction === 'NEUTRAL') {
      const netStrength = (shortTerm * 0.5) + (mediumTerm * 0.3) + (longTerm * 0.2);
      
      if (netStrength > 0.3) {
        direction = 'UP';
        strength = netStrength;
        description = `Tendance haussière (force: ${(netStrength * 100).toFixed(1)}%)`;
      } else if (netStrength < -0.3) {
        direction = 'DOWN';
        strength = Math.abs(netStrength);
        description = `Tendance baissière (force: ${(Math.abs(netStrength) * 100).toFixed(1)}%)`;
      }
    }
    
    return {
      direction,
      strength,
      description,
      shortTerm,
      mediumTerm,
      longTerm
    };
  }

  /**
   * Calcule la force de la tendance pour une série de prix
   * @private
   * @param {Array<number>} prices - Série de prix
   * @returns {number} Force de la tendance (-1 à 1)
   */
  calculateTrendStrength(prices) {
    if (prices.length < 2) return 0;
    
    // Calculer la pente de régression linéaire
    const n = prices.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += prices[i];
      sumXY += i * prices[i];
      sumX2 += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // Normaliser la pente par rapport au prix moyen
    const avgPrice = sumY / n;
    const normalizedSlope = (slope / avgPrice) * 100;
    
    // Convertir en score de tendance entre -1 et 1
    return Math.max(-1, Math.min(1, normalizedSlope / 10));
  }

  /**
   * Analyse le profil de volume
   * @param {Array<number>} volumes - Historique des volumes
   * @param {Array<number>} [prices] - Historique des prix optionnel
   * @returns {Object} Analyse du profil de volume
   */
  analyzeVolumeProfile(volumes, prices = null) {
    if (volumes.length < 10) {
      return {
        increasing: false,
        volumeRatio: 1,
        strength: 0,
        description: 'Données de volume insuffisantes'
      };
    }
    
    // Utiliser la période de lookback configurée
    const lookback = Math.min(this.indicatorConfig.volumeProfile.lookback, volumes.length);
    const recentVolumes = volumes.slice(-lookback);
    
    // Calculer le volume moyen
    const avgVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
    
    // Comparer les volumes récents avec la moyenne
    const latestVolume = volumes[volumes.length - 1];
    const volumeRatio = latestVolume / avgVolume;
    
    // Calculer la tendance du volume
    const halfPoint = Math.floor(recentVolumes.length / 2);
    const firstHalf = recentVolumes.slice(0, halfPoint);
    const secondHalf = recentVolumes.slice(halfPoint);
    
    const firstHalfAvg = firstHalf.reduce((sum, vol) => sum + vol, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, vol) => sum + vol, 0) / secondHalf.length;
    
    const volumeTrend = secondHalfAvg / firstHalfAvg;
    const increasing = volumeTrend > 1.05; // Plus de 5% d'augmentation
    
    // Si les prix sont fournis, analyser la corrélation volume-prix
    let priceVolumeCorrelation = 0;
    if (prices && prices.length === volumes.length && prices.length > 5) {
      // Calculer les variations de prix et volume
      const priceChanges = [];
      const volumeChanges = [];
      
      for (let i = 1; i < prices.length; i++) {
        priceChanges.push((prices[i] - prices[i-1]) / prices[i-1]);
        volumeChanges.push((volumes[i] - volumes[i-1]) / volumes[i-1]);
      }
      
      // Calculer la corrélation
      priceVolumeCorrelation = this.calculateCorrelation(priceChanges, volumeChanges);
    }
    
    // Déterminer la force du signal de volume
    let strength = 0;
    let description = 'Volume normal';
    
    if (volumeRatio > this.indicatorConfig.volumeProfile.threshold) {
      strength = Math.min(1, (volumeRatio - 1) / 2);
      description = `Volume élevé (${volumeRatio.toFixed(2)}x la moyenne)`;
    } else if (volumeRatio < 0.7) {
      strength = 0.3;
      description = `Volume faible (${volumeRatio.toFixed(2)}x la moyenne)`;
    }
    
    if (increasing) {
      strength += 0.2;
      description += ', tendance à la hausse';
    }
    
    return {
      increasing,
      volumeRatio,
      volumeTrend,
      latestVolume,
      avgVolume,
      strength,
      description,
      priceVolumeCorrelation
    };
  }

  /**
   * Calcule la corrélation entre deux séries
   * @private
   * @param {Array<number>} series1 - Première série de données
   * @param {Array<number>} series2 - Deuxième série de données
   * @returns {number} Coefficient de corrélation (-1 à 1)
   */
  calculateCorrelation(series1, series2) {
    if (series1.length !== series2.length || series1.length === 0) {
      return 0;
    }
    
    const n = series1.length;
    let sum1 = 0;
    let sum2 = 0;
    let sum1Sq = 0;
    let sum2Sq = 0;
    let pSum = 0;
    
    for (let i = 0; i < n; i++) {
      sum1 += series1[i];
      sum2 += series2[i];
      sum1Sq += series1[i] ** 2;
      sum2Sq += series2[i] ** 2;
      pSum += series1[i] * series2[i];
    }
    
    const num = pSum - (sum1 * sum2 / n);
    const den = Math.sqrt((sum1Sq - (sum1 ** 2) / n) * (sum2Sq - (sum2 ** 2) / n));
    
    if (den === 0) return 0;
    return num / den;
  }

  /**
   * Calculer les niveaux de support et résistance
   * @param {Array<number>} prices - Historique des prix
   * @returns {Object} Niveaux de support et résistance
   */
  calculateSupportResistance(prices) {
    if (prices.length < 20) {
      return {
        supports: [],
        resistances: []
      };
    }
    
    // Trouver les points pivots (maximums et minimums locaux)
    const pivots = [];
    for (let i = 2; i < prices.length - 2; i++) {
      // Maximum local
      if (prices[i] > prices[i-1] && prices[i] > prices[i-2] && 
          prices[i] > prices[i+1] && prices[i] > prices[i+2]) {
        pivots.push({ price: prices[i], type: 'resistance', index: i });
      }
      // Minimum local
      else if (prices[i] < prices[i-1] && prices[i] < prices[i-2] && 
               prices[i] < prices[i+1] && prices[i] < prices[i+2]) {
        pivots.push({ price: prices[i], type: 'support', index: i });
      }
    }
    
    // Grouper les pivots proches
    const groupedPivots = this.groupPivots(pivots, prices);
    
    // Séparer supports et résistances
    const supports = groupedPivots
      .filter(p => p.type === 'support')
      .map(p => ({ price: p.price, strength: p.strength }));
      
    const resistances = groupedPivots
      .filter(p => p.type === 'resistance')
      .map(p => ({ price: p.price, strength: p.strength }));
    
    // Prix actuel
    const currentPrice = prices[prices.length - 1];
    
    // Identifier les supports et résistances les plus proches
    const closestSupport = supports
      .filter(s => s.price < currentPrice)
      .sort((a, b) => b.price - a.price)[0] || null;
      
    const closestResistance = resistances
      .filter(r => r.price > currentPrice)
      .sort((a, b) => a.price - b.price)[0] || null;
    
    return {
      supports,
      resistances,
      closestSupport,
      closestResistance
    };
  }

  /**
   * Groupe les pivots proches
   * @private
   * @param {Array<Object>} pivots - Points pivots
   * @param {Array<number>} prices - Historique des prix
   * @returns {Array<Object>} Pivots groupés
   */
  groupPivots(pivots, prices) {
    if (pivots.length === 0) return [];
    
    // Calculer l'écart type des prix pour déterminer la proximité
    const priceStdDev = technicalAnalysis.standardDeviation(prices);
    const proximityThreshold = priceStdDev * 0.5; // 50% de l'écart type
    
    // Trier les pivots par prix
    const sortedPivots = [...pivots].sort((a, b) => a.price - b.price);
    
    const groupedPivots = [];
    let currentGroup = [sortedPivots[0]];
    
    for (let i = 1; i < sortedPivots.length; i++) {
      const lastPivot = currentGroup[currentGroup.length - 1];
      
      // Si le pivot actuel est proche du dernier, l'ajouter au groupe actuel
      if (Math.abs(sortedPivots[i].price - lastPivot.price) < proximityThreshold &&
          sortedPivots[i].type === lastPivot.type) {
        currentGroup.push(sortedPivots[i]);
      } else {
        // Sinon, finaliser le groupe actuel et en commencer un nouveau
        const avgPrice = currentGroup.reduce((sum, p) => sum + p.price, 0) / currentGroup.length;
        const strength = Math.min(1, currentGroup.length / 3); // Force basée sur le nombre de touchers
        
        groupedPivots.push({
          price: avgPrice,
          type: currentGroup[0].type,
          strength,
          count: currentGroup.length
        });
        
        currentGroup = [sortedPivots[i]];
      }
    }
    
    // Traiter le dernier groupe
    if (currentGroup.length > 0) {
      const avgPrice = currentGroup.reduce((sum, p) => sum + p.price, 0) / currentGroup.length;
      const strength = Math.min(1, currentGroup.length / 3);
      
      groupedPivots.push({
        price: avgPrice,
        type: currentGroup[0].type,
        strength,
        count: currentGroup.length
      });
    }
    
    return groupedPivots;
  }

  /**
   * Crée un signal de trading
   * @protected
   * @param {string} type - Type de signal ('BUY', 'SELL', 'NONE')
   * @param {number} confidence - Niveau de confiance (0-1)
   * @param {Array<string>} reasons - Raisons du signal
   * @param {Object} indicators - Indicateurs utilisés pour le signal
   * @returns {Object} Signal de trading
   */
  createSignal(type, confidence, reasons, indicators = {}) {
    // Déterminer la force du signal
    let strength = 'WEAK';
    if (confidence >= 0.8) strength = 'STRONG';
    else if (confidence >= 0.6) strength = 'MEDIUM';
    
    return {
      type,
      confidence,
      strength,
      reasons,
      indicators,
      timestamp: Date.now()
    };
  }

  /**
   * Applique un filtre de persistance pour éviter les signaux contradictoires
   * @protected
   * @param {string} token - Identifiant du token
   * @param {Object} currentSignal - Signal actuel
   * @returns {Object} Signal filtré
   */
  applySignalPersistenceFilter(token, currentSignal) {
    const previousSignal = this.signalCache.get(token);
    
    // Si pas de signal précédent ou signal neutre, retourner le signal actuel
    if (!previousSignal || currentSignal.type === 'NONE') {
      this.signalCache.set(token, {
        ...currentSignal,
        createdAt: Date.now()
      });
      return currentSignal;
    }
    
    // Vérifier si le signal précédent est récent (< 1 heure)
    const signalAge = Date.now() - previousSignal.createdAt;
    const isRecent = signalAge < 3600000; // 1 heure en ms
    
    if (isRecent) {
      // Si le signal précédent était fort et le nouveau contradictoire, réduire la confiance
      if (previousSignal.confidence >= 0.7 && 
          previousSignal.type !== 'NONE' && 
          currentSignal.type !== 'NONE' && 
          currentSignal.type !== previousSignal.type) {
        
        currentSignal.confidence *= 0.7; // 30% de réduction
        currentSignal.reasons.push('CONFIDENCE_REDUCED_DUE_TO_RECENT_CONTRARY_SIGNAL');
      }
      
      // Si le signal précédent était similaire, augmenter légèrement la confiance
      if (previousSignal.type === currentSignal.type && currentSignal.type !== 'NONE') {
        currentSignal.confidence = Math.min(1, currentSignal.confidence * 1.1); // 10% d'augmentation
        currentSignal.reasons.push('CONFIDENCE_BOOSTED_BY_SIGNAL_CONSISTENCY');
      }
    }
    
    // Mettre à jour le cache
    if (currentSignal.type !== 'NONE') {
      this.signalCache.set(token, {
        ...currentSignal,
        createdAt: Date.now()
      });
    }
    
    return currentSignal;
  }

  /**
   * Suit un signal pour l'analyse de performance
   * @param {string} token - Identifiant du token
   * @param {Object} signal - Signal généré
   */
  trackSignal(token, signal) {
    // Ignorer les signaux neutres
    if (signal.type === 'NONE' || !token) return;
    
    this.performance.totalSignals++;
    
    // Suivre par force de signal
    if (signal.strength === 'WEAK') this.performance.signalStrengthMetrics.weak.total++;
    else if (signal.strength === 'MEDIUM') this.performance.signalStrengthMetrics.medium.total++;
    else if (signal.strength === 'STRONG') this.performance.signalStrengthMetrics.strong.total++;
    
    // Ajouter à l'historique
    this.performance.signalHistory.push({
      token,
      timestamp: Date.now(),
      signal: { ...signal },
      outcome: 'PENDING'
    });
    
    // Limiter la taille de l'historique
    if (this.performance.signalHistory.length > 100) {
      this.performance.signalHistory = this.performance.signalHistory.slice(-100);
    }
  }

  /**
   * Met à jour le résultat d'un signal
   * @param {string} token - Identifiant du token
   * @param {string} outcome - Résultat ('CORRECT', 'INCORRECT')
   * @param {number} profit - Profit/perte réalisé
   */
  updateSignalOutcome(token, outcome, profit) {
    // Trouver le signal le plus récent pour ce token
    const index = this.performance.signalHistory.findIndex(
      entry => entry.token === token && entry.outcome === 'PENDING'
    );
    
    if (index === -1) return;
    
    const entry = this.performance.signalHistory[index];
    
    // Mettre à jour le résultat
    entry.outcome = outcome;
    entry.profit = profit;
    entry.closedAt = Date.now();
    
    // Mettre à jour les métriques de performance
    if (outcome === 'CORRECT') {
      this.performance.correctSignals++;
      
      if (profit > 0) {
        this.performance.profitableTokens.add(token);
      }
      
      // Mettre à jour les métriques par force
      if (entry.signal.strength === 'WEAK') this.performance.signalStrengthMetrics.weak.correct++;
      else if (entry.signal.strength === 'MEDIUM') this.performance.signalStrengthMetrics.medium.correct++;
      else if (entry.signal.strength === 'STRONG') this.performance.signalStrengthMetrics.strong.correct++;
    } else {
      this.performance.falsePositives++;
    }
  }

  /**
   * Obtient les métriques de performance de la stratégie
   * @returns {Object} Métriques de performance
   */
  getPerformanceMetrics() {
    const accuracy = this.performance.totalSignals > 0
      ? (this.performance.correctSignals / this.performance.totalSignals) * 100
      : 0;
    
    // Calculer l'exactitude par force de signal
    const strengthAccuracy = {
      weak: this.performance.signalStrengthMetrics.weak.total > 0
        ? (this.performance.signalStrengthMetrics.weak.correct / this.performance.signalStrengthMetrics.weak.total) * 100
        : 0,
      medium: this.performance.signalStrengthMetrics.medium.total > 0
        ? (this.performance.signalStrengthMetrics.medium.correct / this.performance.signalStrengthMetrics.medium.total) * 100
        : 0,
      strong: this.performance.signalStrengthMetrics.strong.total > 0
        ? (this.performance.signalStrengthMetrics.strong.correct / this.performance.signalStrengthMetrics.strong.total) * 100
        : 0
    };
    
    return {
      totalSignals: this.performance.totalSignals,
      correctSignals: this.performance.correctSignals,
      falsePositives: this.performance.falsePositives,
      accuracy,
      strengthAccuracy,
      profitableTokens: Array.from(this.performance.profitableTokens),
      recentSignals: this.performance.signalHistory.slice(-10)
    };
  }
}

export default BaseStrategy;