// trading/TransactionManager.js
import EventEmitter from 'events';
import { retry, delay } from '../utils/helpers.js';

/**
 * Gestionnaire de transactions optimisé
 * Responsable de l'exécution, du suivi et de la confirmation des transactions
 */
export class TransactionManager extends EventEmitter {
  /**
   * Crée une instance de TransactionManager
   * @param {Object} config - Configuration globale
   * @param {Object} marketData - Service de données de marché
   */
  constructor(config, marketData) {
    super();
    this.config = config;
    this.marketData = marketData;
    
    // File d'attente des transactions
    this.transactionQueue = [];
    
    // Transactions en cours d'exécution
    this.pendingTransactions = new Map();
    
    // Historique des transactions
    this.transactionHistory = [];
    
    // Statistiques
    this.stats = {
      total: 0,
      successful: 0,
      failed: 0,
      aborted: 0,
      avgExecutionTime: 0,
      totalExecutionTime: 0,
      slippage: {
        buy: 0,
        sell: 0,
        count: 0
      }
    };
    
    // Limites de concurrence
    this.concurrencyLimit = config.trading?.concurrencyLimit || 3;
    this.processingTransactions = 0;
    
    // Délai entre les transactions
    this.transactionDelay = config.trading?.transactionDelay || 1000; // 1 seconde
    
    // Paramètres de timeouts et retries
    this.transactionTimeout = config.trading?.transactionTimeout || 30000; // 30 secondes
    this.maxRetries = config.trading?.maxRetries || 3;
    
    // Démarrer le processeur de file d'attente
    this._startQueueProcessor();
  }

  /**
   * Exécute une transaction d'achat de token
   * @param {string} tokenMint - Adresse du token
   * @param {number} amount - Quantité à acheter
   * @param {number} maxPrice - Prix maximum acceptable
   * @param {Object} [options={}] - Options supplémentaires
   * @returns {Promise<Object>} Détails de la transaction
   */
  async executeBuy(tokenMint, amount, maxPrice, options = {}) {
    if (!tokenMint || amount <= 0 || maxPrice <= 0) {
      throw new Error('Invalid transaction parameters');
    }
    
    // Créer la transaction
    const transaction = {
      id: this._generateTransactionId(),
      type: 'BUY',
      tokenMint,
      amount,
      price: maxPrice,
      maxPrice,
      options,
      status: 'QUEUED',
      createdAt: Date.now(),
      attempts: 0,
      priority: options.priority || 'normal'
    };
    
    // Mettre en file d'attente
    return this._queueTransaction(transaction);
  }

  /**
   * Exécute une transaction de vente de token
   * @param {string} tokenMint - Adresse du token
   * @param {number} amount - Quantité à vendre
   * @param {number} minPrice - Prix minimum acceptable
   * @param {Object} [options={}] - Options supplémentaires
   * @returns {Promise<Object>} Détails de la transaction
   */
  async executeSell(tokenMint, amount, minPrice, options = {}) {
    if (!tokenMint || amount <= 0) {
      throw new Error('Invalid transaction parameters');
    }
    
    // Créer la transaction
    const transaction = {
      id: this._generateTransactionId(),
      type: 'SELL',
      tokenMint,
      amount,
      price: minPrice,
      minPrice,
      options,
      status: 'QUEUED',
      createdAt: Date.now(),
      attempts: 0,
      priority: options.priority || 'normal'
    };
    
    // Mettre en file d'attente
    return this._queueTransaction(transaction);
  }

  /**
   * Met en file d'attente une transaction
   * @private
   * @param {Object} transaction - Transaction à mettre en file d'attente
   * @returns {Promise<Object>} Promise qui sera résolue lorsque la transaction sera traitée
   */
  _queueTransaction(transaction) {
    // Créer une promesse qui sera résolue lorsque la transaction sera terminée
    return new Promise((resolve, reject) => {
      transaction.resolve = resolve;
      transaction.reject = reject;
      
      // Mettre en file d'attente selon la priorité
      if (transaction.priority === 'high') {
        this.transactionQueue.unshift(transaction);
      } else {
        this.transactionQueue.push(transaction);
      }
      
      // Émettre un événement
      this.emit('transaction_queued', {
        id: transaction.id,
        type: transaction.type,
        tokenMint: transaction.tokenMint,
        amount: transaction.amount,
        queuePosition: this.transactionQueue.length
      });
      
      // Vérifier si le processeur de file d'attente est en cours d'exécution
      if (this.processingTransactions < this.concurrencyLimit) {
        this._processNextTransaction();
      }
    });
  }

  /**
   * Démarre le processeur de file d'attente
   * @private
   */
  _startQueueProcessor() {
    // Vérifier périodiquement s'il y a des transactions en attente
    setInterval(() => {
      if (this.transactionQueue.length > 0 && this.processingTransactions < this.concurrencyLimit) {
        this._processNextTransaction();
      }
    }, 100);
  }

  /**
   * Traite la prochaine transaction dans la file d'attente
   * @private
   */
  async _processNextTransaction() {
    if (this.transactionQueue.length === 0 || this.processingTransactions >= this.concurrencyLimit) {
      return;
    }
    
    // Incrémenter le compteur de transactions en cours
    this.processingTransactions++;
    
    // Récupérer la prochaine transaction
    const transaction = this.transactionQueue.shift();
    transaction.status = 'PROCESSING';
    transaction.startTime = Date.now();
    
    // Ajouter aux transactions en cours
    this.pendingTransactions.set(transaction.id, transaction);
    
    try {
      // Mettre à jour les statistiques
      this.stats.total++;
      
      // Exécuter la transaction avec retry
      const result = await this._executeTransaction(transaction);
      
      // Mettre à jour les statistiques
      this.stats.successful++;
      
      // Calculer le slippage
      if (transaction.type === 'BUY') {
        const slippage = ((result.executedPrice - transaction.price) / transaction.price) * 100;
        this.stats.slippage.buy += slippage;
      } else {
        const slippage = ((transaction.price - result.executedPrice) / transaction.price) * 100;
        this.stats.slippage.sell += slippage;
      }
      this.stats.slippage.count++;
      
      // Mettre à jour l'historique
      this.transactionHistory.unshift(result);
      if (this.transactionHistory.length > 100) {
        this.transactionHistory.pop();
      }
      
      // Résoudre la promesse
      transaction.resolve(result);
      
      // Émettre un événement
      this.emit('transaction_completed', result);
    } catch (error) {
      // Mettre à jour les statistiques
      this.stats.failed++;
      
      // Rejeter la promesse
      transaction.reject(error);
      
      // Émettre un événement
      this.emit('transaction_failed', {
        id: transaction.id,
        type: transaction.type,
        tokenMint: transaction.tokenMint,
        error: error.message
      });
    } finally {
      // Décrémenter le compteur de transactions en cours
      this.processingTransactions--;
      
      // Retirer des transactions en cours
      this.pendingTransactions.delete(transaction.id);
      
      // Attendre avant de traiter la prochaine transaction
      await delay(this.transactionDelay);
      
      // Vérifier s'il y a d'autres transactions à traiter
      if (this.transactionQueue.length > 0 && this.processingTransactions < this.concurrencyLimit) {
        this._processNextTransaction();
      }
    }
  }

  /**
   * Exécute une transaction avec retries
   * @private
   * @param {Object} transaction - Transaction à exécuter
   * @returns {Promise<Object>} Détails de la transaction exécutée
   */
  async _executeTransaction(transaction) {
    // Initialiser le temps d'exécution
    const startTime = Date.now();
    
    // Configurer les options de retry
    const retryOptions = {
      retries: this.maxRetries,
      minTimeout: 1000,
      maxTimeout: 5000,
      factor: 2,
      randomize: true
    };
    
    try {
      // Exécuter la transaction avec retry
      const result = await retry(
        async () => {
          transaction.attempts++;
          
          // Vérifier si la transaction est toujours valide
          await this._validateTransaction(transaction);
          
          // Simuler l'exécution de la transaction (à remplacer par l'implémentation réelle)
          return this._simulateTransactionExecution(transaction);
        },
        retryOptions
      );
      
      // Calculer le temps d'exécution
      const executionTime = Date.now() - startTime;
      
      // Mettre à jour les statistiques de temps d'exécution
      this.stats.totalExecutionTime += executionTime;
      this.stats.avgExecutionTime = this.stats.totalExecutionTime / this.stats.successful;
      
      // Retourner le résultat
      return {
        ...result,
        executionTime
      };
    } catch (error) {
      // Si l'erreur est due à une validation, c'est un abandon et non un échec
      if (error.message.includes('validation')) {
        this.stats.aborted++;
      }
      
      throw error;
    }
  }

  /**
   * Valide si une transaction est toujours valide avant exécution
   * @private
   * @param {Object} transaction - Transaction à valider
   * @throws {Error} Si la transaction n'est plus valide
   */
  async _validateTransaction(transaction) {
    // Obtenir le prix actuel du token
    const currentPrice = await this.marketData.getTokenPrice(transaction.tokenMint);
    
    if (!currentPrice) {
      throw new Error(`Cannot get current price for ${transaction.tokenMint}`);
    }
    
    // Valider selon le type de transaction
    if (transaction.type === 'BUY') {
      // Vérifier si le prix actuel est inférieur au prix maximum
      const maxAllowedPrice = transaction.maxPrice * (1 + (transaction.options.slippageTolerance || 0.01));
      
      if (currentPrice > maxAllowedPrice) {
        throw new Error(`Validation failed: Current price (${currentPrice}) exceeds maximum price (${maxAllowedPrice})`);
      }
    } else if (transaction.type === 'SELL') {
      // Vérifier si le prix actuel est supérieur au prix minimum
      const minAllowedPrice = transaction.minPrice * (1 - (transaction.options.slippageTolerance || 0.01));
      
      if (currentPrice < minAllowedPrice) {
        throw new Error(`Validation failed: Current price (${currentPrice}) below minimum price (${minAllowedPrice})`);
      }
    }
    
    // Vérifier le timeout
    if (Date.now() - transaction.startTime > this.transactionTimeout) {
      throw new Error(`Transaction timeout after ${this.transactionTimeout / 1000}s`);
    }
  }

  /**
   * Simule l'exécution d'une transaction (à remplacer par l'implémentation réelle)
   * @private
   * @param {Object} transaction - Transaction à exécuter
   * @returns {Promise<Object>} Détails de la transaction exécutée
   */
  async _simulateTransactionExecution(transaction) {
    // Simuler un délai d'exécution
    await delay(500 + Math.random() * 1000);
    
    // Obtenir le prix actuel du token
    const currentPrice = await this.marketData.getTokenPrice(transaction.tokenMint);
    
    if (!currentPrice) {
      throw new Error(`Cannot get current price for ${transaction.tokenMint}`);
    }
    
    // Appliquer un léger slippage aléatoire
    const slippage = (Math.random() * 0.01) - 0.005; // +/- 0.5%
    const executedPrice = currentPrice * (1 + slippage);
    
    // En conditions réelles, ici on exécuterait la transaction sur la blockchain
    
    // Retourner les détails de la transaction exécutée
    return {
      id: transaction.id,
      type: transaction.type,
      tokenMint: transaction.tokenMint,
      amount: transaction.amount,
      requestedPrice: transaction.price,
      executedPrice,
      slippage: slippage * 100, // en pourcentage
      fee: executedPrice * transaction.amount * 0.001, // Simuler des frais de 0.1%
      status: 'COMPLETED',
      timestamp: Date.now(),
      txHash: `sim_${Date.now()}_${Math.floor(Math.random() * 1000000)}` // Simuler un hash de transaction
    };
  }
  
  /**
   * Annule une transaction en attente
   * @param {string} transactionId - ID de la transaction à annuler
   * @returns {boolean} True si la transaction a été annulée
   */
  cancelTransaction(transactionId) {
    // Chercher dans la file d'attente
    const queueIndex = this.transactionQueue.findIndex(tx => tx.id === transactionId);
    
    if (queueIndex >= 0) {
      // Récupérer la transaction
      const transaction = this.transactionQueue[queueIndex];
      
      // Retirer de la file d'attente
      this.transactionQueue.splice(queueIndex, 1);
      
      // Rejeter la promesse
      transaction.reject(new Error('Transaction cancelled by user'));
      
      // Émettre un événement
      this.emit('transaction_cancelled', {
        id: transaction.id,
        type: transaction.type,
        tokenMint: transaction.tokenMint
      });
      
      return true;
    }
    
    // Vérifier dans les transactions en cours
    if (this.pendingTransactions.has(transactionId)) {
      // Marquer comme à annuler (sera annulée lors du prochain retry si possible)
      const transaction = this.pendingTransactions.get(transactionId);
      transaction.options.cancelled = true;
      
      // Émettre un événement
      this.emit('transaction_cancellation_requested', {
        id: transaction.id,
        type: transaction.type,
        tokenMint: transaction.tokenMint,
        message: 'Transaction cancellation requested, will be cancelled if possible'
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Génère un identifiant unique pour une transaction
   * @private
   * @returns {string} Identifiant de transaction
   */
  _generateTransactionId() {
    return `tx_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  }

  /**
   * Récupère toutes les transactions en attente
   * @returns {Array<Object>} Liste des transactions en attente
   */
  getPendingTransactions() {
    return [
      ...this.transactionQueue,
      ...Array.from(this.pendingTransactions.values())
    ];
  }

  /**
   * Récupère l'historique des transactions
   * @param {number} [limit=10] - Nombre maximum de transactions à retourner
   * @returns {Array<Object>} Historique des transactions
   */
  getTransactionHistory(limit = 10) {
    return this.transactionHistory.slice(0, limit);
  }

  /**
   * Récupère les statistiques du gestionnaire de transactions
   * @returns {Object} Statistiques
   */
  getStats() {
    return {
      ...this.stats,
      pendingCount: this.pendingTransactions.size,
      queueLength: this.transactionQueue.length,
      avgSlippage: {
        buy: this.stats.slippage.count > 0 ? this.stats.slippage.buy / this.stats.slippage.count : 0,
        sell: this.stats.slippage.count > 0 ? this.stats.slippage.sell / this.stats.slippage.count : 0
      }
    };
  }

  /**
   * Mets à jour la configuration du gestionnaire de transactions
   * @param {Object} newConfig - Nouvelle configuration
   */
  updateConfig(newConfig) {
    if (newConfig.trading) {
      this.concurrencyLimit = newConfig.trading.concurrencyLimit || this.concurrencyLimit;
      this.transactionDelay = newConfig.trading.transactionDelay || this.transactionDelay;
      this.transactionTimeout = newConfig.trading.transactionTimeout || this.transactionTimeout;
      this.maxRetries = newConfig.trading.maxRetries || this.maxRetries;
    }
    
    this.config = { ...this.config, ...newConfig };
    
    this.emit('config_updated', {
      concurrencyLimit: this.concurrencyLimit,
      transactionDelay: this.transactionDelay,
      transactionTimeout: this.transactionTimeout,
      maxRetries: this.maxRetries
    });
  }
}

export default TransactionManager;