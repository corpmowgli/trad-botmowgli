// trading/PositionManager.js
import EventEmitter from 'events';
import { v4 as uuidv4 } from 'uuid';

/**
 * Gestionnaire de positions optimisé
 * Responsable de la création, suivi et fermeture des positions de trading
 */
export class PositionManager extends EventEmitter {
  /**
   * Crée une instance de PositionManager
   * @param {Object} config - Configuration globale
   * @param {Object} [transactionManager] - Gestionnaire de transactions (optionnel)
   */
  constructor(config, transactionManager = null) {
    super();
    this.config = config;
    this.transactionManager = transactionManager;
    
    // Index de positions par token
    this.positionsByToken = new Map();
    
    // Historique des positions fermées (limité en taille)
    this.closedPositions = [];
    
    // Statistiques
    this.stats = {
      totalOpened: 0,
      totalClosed: 0,
      wins: 0,
      losses: 0,
      breakEven: 0,
      avgHoldingTime: 0,
      totalHoldingTime: 0,
      avgProfitPercentage: 0,
      avgLossPercentage: 0
    };
  }

  /**
   * Ouvre une nouvelle position de trading
   * @param {string} token - Adresse du token
   * @param {number} entryPrice - Prix d'entrée
   * @param {number} amount - Quantité
   * @param {Object} [signal={}] - Signal de trading ayant généré la position
   * @returns {Promise<Object>} Position créée
   */
  async openPosition(token, entryPrice, amount, signal = {}) {
    if (!token || entryPrice <= 0 || amount <= 0) {
      throw new Error('Invalid position parameters');
    }
    
    // Vérifier si on n'a pas déjà une position pour ce token
    if (this.positionsByToken.has(token)) {
      throw new Error(`Position already exists for token ${token}`);
    }
    
    // Vérifier si on n'a pas atteint le nombre maximum de positions
    const maxPositions = this.config.trading?.maxOpenPositions || 3;
    if (this.positionsByToken.size >= maxPositions) {
      throw new Error(`Maximum number of positions (${maxPositions}) already reached`);
    }
    
    // Calculer les niveaux de stop loss et take profit
    const stopLossPercentage = signal.stopLoss || this.config.trading?.stopLoss || 5;
    const takeProfitPercentage = signal.takeProfit || this.config.trading?.takeProfit || 15;
    
    const stopLossPrice = entryPrice * (1 - stopLossPercentage / 100);
    const takeProfitPrice = entryPrice * (1 + takeProfitPercentage / 100);
    
    // Créer la position
    const position = {
      id: uuidv4(),
      token,
      entryPrice,
      amount,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      stopLossPercentage,
      takeProfitPercentage,
      currentPrice: entryPrice,
      openTime: Date.now(),
      updatedAt: Date.now(),
      status: 'OPEN',
      unrealizedProfit: 0,
      unrealizedProfitPercentage: 0,
      signal: {
        type: signal.type || 'UNKNOWN',
        confidence: signal.confidence || 0,
        reasons: signal.reasons || []
      },
      trades: []
    };
    
    // Si un transaction manager est disponible, exécuter la transaction
    if (this.transactionManager) {
      try {
        const transaction = await this.transactionManager.executeBuy(
          token,
          amount,
          entryPrice,
          {
            slippageTolerance: this.config.trading?.slippageTolerance || 0.01,
            priority: 'high'
          }
        );
        
        // Mettre à jour la position avec les détails de la transaction
        position.entryPrice = transaction.executedPrice;
        position.trades.push({
          type: 'OPEN',
          price: transaction.executedPrice,
          amount: transaction.amount,
          timestamp: transaction.timestamp,
          txHash: transaction.txHash,
          fee: transaction.fee
        });
      } catch (error) {
        throw new Error(`Failed to execute buy transaction: ${error.message}`);
      }
    }
    
    // Ajouter à l'index des positions
    this.positionsByToken.set(token, position);
    
    // Mettre à jour les statistiques
    this.stats.totalOpened++;
    
    // Émettre un événement
    this.emit('position_opened', position);
    
    return position;
  }

  /**
   * Ferme une position existante
   * @param {string} token - Adresse du token
   * @param {number} exitPrice - Prix de sortie
   * @param {string} [reason='MANUAL'] - Raison de la fermeture
   * @returns {Promise<Object>} Position fermée
   */
  async closePosition(token, exitPrice, reason = 'MANUAL') {
    if (!token || !this.positionsByToken.has(token)) {
      throw new Error(`No open position found for token ${token}`);
    }
    
    // Récupérer la position
    const position = this.positionsByToken.get(token);
    
    // Si déjà fermée, retourner erreur
    if (position.status !== 'OPEN') {
      throw new Error(`Position for token ${token} is already ${position.status}`);
    }
    
    // Si pas de prix de sortie fourni, vérifier le prix actuel
    if (!exitPrice && exitPrice !== 0) {
      throw new Error('Exit price is required');
    }
    
    // Si un transaction manager est disponible, exécuter la transaction
    let executedPrice = exitPrice;
    if (this.transactionManager) {
      try {
        const transaction = await this.transactionManager.executeSell(
          token,
          position.amount,
          exitPrice,
          {
            slippageTolerance: this.config.trading?.slippageTolerance || 0.01,
            priority: 'high'
          }
        );
        
        // Utiliser le prix réellement exécuté
        executedPrice = transaction.executedPrice;
        
        // Ajouter les détails de la transaction
        position.trades.push({
          type: 'CLOSE',
          price: transaction.executedPrice,
          amount: transaction.amount,
          timestamp: transaction.timestamp,
          txHash: transaction.txHash,
          fee: transaction.fee
        });
      } catch (error) {
        throw new Error(`Failed to execute sell transaction: ${error.message}`);
      }
    }
    
    // Calculer le profit/perte
    const profit = (executedPrice - position.entryPrice) * position.amount;
    const profitPercentage = ((executedPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Mettre à jour la position
    position.exitPrice = executedPrice;
    position.closeTime = Date.now();
    position.status = 'CLOSED';
    position.profit = profit;
    position.profitPercentage = profitPercentage;
    position.holdingTime = position.closeTime - position.openTime;
    position.closeReason = reason;
    
    // Supprimer de l'index des positions ouvertes
    this.positionsByToken.delete(token);
    
    // Ajouter à l'historique des positions fermées
    this.closedPositions.unshift(position);
    
    // Limiter la taille de l'historique
    if (this.closedPositions.length > 100) {
      this.closedPositions.pop();
    }
    
    // Mettre à jour les statistiques
    this.stats.totalClosed++;
    this.stats.totalHoldingTime += position.holdingTime;
    this.stats.avgHoldingTime = this.stats.totalHoldingTime / this.stats.totalClosed;
    
    if (profitPercentage > 0) {
      this.stats.wins++;
      this.stats.avgProfitPercentage = (this.stats.avgProfitPercentage * (this.stats.wins - 1) + profitPercentage) / this.stats.wins;
    } else if (profitPercentage < 0) {
      this.stats.losses++;
      this.stats.avgLossPercentage = (this.stats.avgLossPercentage * (this.stats.losses - 1) + profitPercentage) / this.stats.losses;
    } else {
      this.stats.breakEven++;
    }
    
    // Émettre un événement
    this.emit('position_closed', position);
    
    return position;
  }

  /**
   * Vérifie toutes les positions ouvertes et ferme celles qui ont atteint
   * leur stop loss ou take profit
   * @param {Map<string,number>} currentPrices - Map des prix actuels par token
   * @returns {Promise<Array>} Positions fermées
   */
  async checkPositions(currentPrices) {
    if (!currentPrices || !(currentPrices instanceof Map)) {
      throw new Error('Current prices must be provided as a Map');
    }
    
    const closedPositions = [];
    const positionsToCheck = Array.from(this.positionsByToken.entries());
    
    // Vérifier chaque position
    for (const [token, position] of positionsToCheck) {
      try {
        // Récupérer le prix actuel
        const currentPrice = currentPrices.get(token);
        
        // Si pas de prix, continuer
        if (!currentPrice) continue;
        
        // Mettre à jour le prix actuel et le profit non réalisé
        position.currentPrice = currentPrice;
        position.updatedAt = Date.now();
        position.unrealizedProfit = (currentPrice - position.entryPrice) * position.amount;
        position.unrealizedProfitPercentage = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        
        // Vérifier si la position a atteint son stop loss ou take profit
        let closeReason = null;
        
        if (currentPrice <= position.stopLoss) {
          closeReason = 'STOP_LOSS';
        } else if (currentPrice >= position.takeProfit) {
          closeReason = 'TAKE_PROFIT';
        }
        
        // Si doit être fermée, la fermer
        if (closeReason) {
          const closedPosition = await this.closePosition(token, currentPrice, closeReason);
          closedPositions.push(closedPosition);
        }
      } catch (error) {
        this.emit('error', new Error(`Error checking position for ${token}: ${error.message}`));
      }
    }
    
    return closedPositions;
  }

  /**
   * Ferme toutes les positions ouvertes
   * @param {Map<string,number>} currentPrices - Map des prix actuels par token
   * @returns {Promise<Array>} Positions fermées
   */
  async closeAllPositions(currentPrices) {
    const closedPositions = [];
    const positionsToClose = Array.from(this.positionsByToken.entries());
    
    for (const [token, position] of positionsToClose) {
      try {
        // Récupérer le prix actuel
        const currentPrice = currentPrices?.get(token);
        
        // Si pas de prix, utiliser le dernier prix connu
        const exitPrice = currentPrice || position.currentPrice || position.entryPrice;
        
        // Fermer la position
        const closedPosition = await this.closePosition(token, exitPrice, 'MANUAL_CLOSE_ALL');
        closedPositions.push(closedPosition);
      } catch (error) {
        this.emit('error', new Error(`Error closing position for ${token}: ${error.message}`));
      }
    }
    
    return closedPositions;
  }

  /**
   * Met à jour les stop loss et take profit d'une position
   * @param {string} token - Adresse du token
   * @param {Object} updates - Mises à jour à appliquer
   * @returns {Object} Position mise à jour
   */
  updatePosition(token, updates) {
    if (!token || !this.positionsByToken.has(token)) {
      throw new Error(`No open position found for token ${token}`);
    }
    
    // Récupérer la position
    const position = this.positionsByToken.get(token);
    
    // Mettre à jour les niveaux de stop loss et take profit si fournis
    if (updates.stopLoss) {
      position.stopLoss = updates.stopLoss;
      position.stopLossPercentage = ((position.entryPrice - updates.stopLoss) / position.entryPrice) * 100;
    } else if (updates.stopLossPercentage) {
      position.stopLossPercentage = updates.stopLossPercentage;
      position.stopLoss = position.entryPrice * (1 - updates.stopLossPercentage / 100);
    }
    
    if (updates.takeProfit) {
      position.takeProfit = updates.takeProfit;
      position.takeProfitPercentage = ((updates.takeProfit - position.entryPrice) / position.entryPrice) * 100;
    } else if (updates.takeProfitPercentage) {
      position.takeProfitPercentage = updates.takeProfitPercentage;
      position.takeProfit = position.entryPrice * (1 + updates.takeProfitPercentage / 100);
    }
    
    // Mettre à jour d'autres champs si nécessaire
    if (updates.notes) {
      position.notes = updates.notes;
    }
    
    position.updatedAt = Date.now();
    
    // Émettre un événement
    this.emit('position_updated', position);
    
    return position;
  }

  /**
   * Récupère toutes les positions ouvertes
   * @returns {Array<Object>} Positions ouvertes
   */
  getOpenPositions() {
    return Array.from(this.positionsByToken.values());
  }

  /**
   * Récupère une position spécifique
   * @param {string} token - Adresse du token
   * @returns {Object|null} Position ou null si non trouvée
   */
  getPosition(token) {
    return this.positionsByToken.get(token) || null;
  }

  /**
   * Récupère l'historique des positions fermées
   * @param {number} [limit=10] - Nombre maximum de positions à retourner
   * @returns {Array<Object>} Positions fermées
   */
  getClosedPositions(limit = 10) {
    return this.closedPositions.slice(0, limit);
  }

  /**
   * Calcule le total de l'exposition actuelle
   * @returns {Object} Exposition totale et détails
   */
  calculateExposure() {
    let totalValue = 0;
    let totalProfit = 0;
    let totalProfitPercentage = 0;
    
    const positions = this.getOpenPositions();
    
    for (const position of positions) {
      const positionValue = position.amount * position.currentPrice;
      totalValue += positionValue;
      totalProfit += position.unrealizedProfit;
    }
    
    if (totalValue > 0) {
      totalProfitPercentage = (totalProfit / totalValue) * 100;
    }
    
    return {
      totalValue,
      totalProfit,
      totalProfitPercentage,
      positionCount: positions.length
    };
  }
  
  /**
   * Récupère les statistiques du gestionnaire de positions
   * @returns {Object} Statistiques
   */
  getStats() {
    const winRate = this.stats.totalClosed > 0 
      ? (this.stats.wins / this.stats.totalClosed) * 100 
      : 0;
    
    const exposure = this.calculateExposure();
    
    return {
      ...this.stats,
      winRate,
      openPositions: this.positionsByToken.size,
      exposure
    };
  }

  /**
   * Met à jour la configuration du gestionnaire de positions
   * @param {Object} newConfig - Nouvelle configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Mettre à jour les positions existantes si nécessaire
    if (newConfig.trading) {
      // Mettre à jour les stop loss et take profit par défaut si nécessaire
      const positions = this.getOpenPositions();
      
      for (const position of positions) {
        // Ne mettre à jour que si la position utilise les valeurs par défaut
        const isDefaultStopLoss = Math.abs(position.stopLossPercentage - this.config.trading.stopLoss) < 0.01;
        const isDefaultTakeProfit = Math.abs(position.takeProfitPercentage - this.config.trading.takeProfit) < 0.01;
        
        if (isDefaultStopLoss && newConfig.trading.stopLoss) {
          this.updatePosition(position.token, { stopLossPercentage: newConfig.trading.stopLoss });
        }
        
        if (isDefaultTakeProfit && newConfig.trading.takeProfit) {
          this.updatePosition(position.token, { takeProfitPercentage: newConfig.trading.takeProfit });
        }
      }
    }
  }
}

export default PositionManager;