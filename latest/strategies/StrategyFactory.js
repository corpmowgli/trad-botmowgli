// strategies/StrategyFactory.js
import { BaseStrategy } from './BaseStrategy.js';
import { MomentumStrategy } from './momentumStrategy.js';
import { EnhancedMomentumStrategy } from './enhancedMomentumStrategy.js';

/**
 * Factory de stratégies de trading
 * Permet de créer différentes stratégies de trading selon les besoins
 */
export class StrategyFactory {
  /**
   * Crée une stratégie de trading selon le type spécifié
   * @static
   * @param {string} type - Type de stratégie
   * @param {Object} config - Configuration de la stratégie
   * @returns {BaseStrategy} Instance de stratégie
   */
  static createStrategy(type, config) {
    switch (type.toUpperCase()) {
      case 'MOMENTUM':
        return new MomentumStrategy(config);
        
      case 'ENHANCED_MOMENTUM':
      case 'MOMENTUM_ENHANCED':
        return new EnhancedMomentumStrategy(config);
        
      case 'MEAN_REVERSION':
        // Implémentations futures
        throw new Error('La stratégie Mean Reversion n\'est pas encore implémentée');
        
      case 'BREAKOUT':
        // Implémentations futures
        throw new Error('La stratégie Breakout n\'est pas encore implémentée');
        
      case 'TREND_FOLLOWING':
        // Implémentations futures
        throw new Error('La stratégie Trend Following n\'est pas encore implémentée');
        
      default:
        // Si le type n'est pas reconnu, utiliser la stratégie améliorée par défaut
        console.warn(`Type de stratégie "${type}" non reconnu, utilisation de Enhanced Momentum par défaut`);
        return new EnhancedMomentumStrategy(config);
    }
  }
  
  /**
   * Liste toutes les stratégies disponibles
   * @static
   * @returns {Array<Object>} Liste des stratégies avec leur description
   */
  static getAvailableStrategies() {
    return [
      {
        id: 'MOMENTUM',
        name: 'Momentum Strategy',
        description: 'Stratégie basique de momentum qui suit la tendance des prix',
        indicators: ['RSI', 'MACD', 'Bollinger Bands'],
        risk: 'Medium'
      },
      {
        id: 'ENHANCED_MOMENTUM',
        name: 'Enhanced Momentum Strategy',
        description: 'Version améliorée de la stratégie Momentum avec analyse technique avancée',
        indicators: ['RSI', 'MACD', 'Bollinger Bands', 'Volume Profile', 'Support/Resistance'],
        risk: 'Medium'
      },
      {
        id: 'MEAN_REVERSION',
        name: 'Mean Reversion Strategy',
        description: 'Stratégie basée sur le retour à la moyenne (non implémentée)',
        indicators: ['RSI', 'Bollinger Bands', 'Standard Deviation'],
        risk: 'Medium',
        available: false
      },
      {
        id: 'BREAKOUT',
        name: 'Breakout Strategy',
        description: 'Recherche les ruptures de support/résistance (non implémentée)',
        indicators: ['Support/Resistance', 'Volume', 'ATR'],
        risk: 'High',
        available: false
      },
      {
        id: 'TREND_FOLLOWING',
        name: 'Trend Following Strategy',
        description: 'Suit les tendances fortes des prix (non implémentée)',
        indicators: ['Moving Averages', 'ADX', 'Parabolic SAR'],
        risk: 'Medium',
        available: false
      }
    ];
  }
  
  /**
   * Obtient des informations sur une stratégie spécifique
   * @static
   * @param {string} type - Type de stratégie
   * @returns {Object|null} Informations sur la stratégie ou null si non trouvée
   */
  static getStrategyInfo(type) {
    const strategies = this.getAvailableStrategies();
    return strategies.find(s => s.id === type.toUpperCase()) || null;
  }
  
  /**
   * Vérifie si une stratégie est disponible
   * @static
   * @param {string} type - Type de stratégie
   * @returns {boolean} True si la stratégie est disponible
   */
  static isStrategyAvailable(type) {
    const info = this.getStrategyInfo(type);
    return info ? (info.available !== false) : false;
  }
  
  /**
   * Obtient la configuration recommandée pour une stratégie
   * @static
   * @param {string} type - Type de stratégie
   * @returns {Object} Configuration recommandée
   */
  static getRecommendedConfig(type) {
    switch (type.toUpperCase()) {
      case 'MOMENTUM':
        return {
          indicators: {
            rsi: {
              period: 14,
              oversold: 30,
              overbought: 70
            },
            macd: {
              fastPeriod: 12,
              slowPeriod: 26,
              signalPeriod: 9
            },
            bollingerBands: {
              period: 20,
              stdDev: 2
            }
          },
          trading: {
            tradeSize: 2,
            stopLoss: 5,
            takeProfit: 15,
            maxOpenPositions: 3
          }
        };
        
      case 'ENHANCED_MOMENTUM':
      case 'MOMENTUM_ENHANCED':
        return {
          indicators: {
            rsi: {
              period: 14,
              oversold: 30,
              overbought: 70
            },
            macd: {
              fastPeriod: 12,
              slowPeriod: 26,
              signalPeriod: 9
            },
            bollingerBands: {
              period: 20,
              stdDev: 2
            },
            volumeProfile: {
              lookback: 24,
              threshold: 1.2
            }
          },
          trading: {
            tradeSize: 2,
            stopLoss: 5,
            takeProfit: 15,
            maxOpenPositions: 3,
            minConfidenceThreshold: 0.6
          }
        };
        
      default:
        // Configuration par défaut
        return {
          indicators: {
            rsi: {
              period: 14,
              oversold: 30,
              overbought: 70
            },
            macd: {
              fastPeriod: 12,
              slowPeriod: 26,
              signalPeriod: 9
            },
            bollingerBands: {
              period: 20,
              stdDev: 2
            }
          },
          trading: {
            tradeSize: 2,
            stopLoss: 5,
            takeProfit: 15,
            maxOpenPositions: 3
          }
        };
    }
  }
}

export default StrategyFactory;