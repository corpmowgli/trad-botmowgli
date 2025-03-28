
corpmowgli/trad-botmowgli
main

GITHUB

Complete the empty scripts

I'll complete the empty script files based on the provided codebase. Let me implement the missing files for your trading bot project.

apiConfig.js
Let me create the API configuration file:


apiConfig.js
Code 
securityConfig.js
Now, let me implement the security configuration file:


securityConfig.js
Code 
LogService.js
Let's implement the LogService class:


LogService.js
Code 

continue

Let me continue implementing the LogService.js file:


LogService.js
Code 
NotificationService.js
Now, let me implement the NotificationService:


NotificationService.js
Code 
BaseStrategy.js
Now, let me implement the BaseStrategy:


BaseStrategy.js
Code 






// services/NotificationService.js
import EventEmitter from 'events';
import { formatCurrency, formatPercentage } from '../utils/helpers.js';

/**
 * Service de notifications pour le trading bot
 * Gère les alertes, notifications et communications en temps réel
 */
export class NotificationService extends EventEmitter {
  /**
   * Crée une nouvelle instance du service de notifications
   * @param {Object} config - Configuration de l'application
   * @param {Object} [options={}] - Options spécifiques aux notifications
   */
  constructor(config, options = {}) {
    super();
    this.config = config;
    
    // Initialiser les options avec valeurs par défaut
    this.options = {
      enabled: true,
      channels: {
        console: true,
        email: false,
        slack: false,
        telegram: false,
        push: false,
        ...options.channels
      },
      priorityThreshold: options.priorityThreshold || 'high',
      throttle: options.throttle || {
        enabled: true,
        period: 300000, // 5 minutes
        maxPerPeriod: 10
      },
      templates: {
        ...this.getDefaultTemplates(),
        ...options.templates
      }
    };
    
    // Statistiques des notifications
    this.stats = {
      totalSent: 0,
      byType: {},
      byChannel: {},
      lastSent: null,
      recentNotifications: []
    };
    
    // File d'attente pour les notifications
    this.queue = [];
    
    // Suivi du throttling
    this.throttling = {
      history: [],
      periodStart: Date.now()
    };
    
    // Lancer le traitement de la file d'attente
    this.processQueue();
  }

  /**
   * Obtient les modèles de notifications par défaut
   * @private
   * @returns {Object} Modèles de notifications
   */
  getDefaultTemplates() {
    return {
      trade: {
        title: 'Transaction exécutée',
        template: 'Transaction {{type}} pour {{token}} - Profit: {{profit}}'
      },
      alert: {
        title: 'Alerte de trading',
        template: 'Alerte: {{message}}'
      },
      error: {
        title: 'Erreur système',
        template: 'Une erreur est survenue: {{message}}'
      },
      system: {
        title: 'Notification système',
        template: '{{message}}'
      },
      performance: {
        title: 'Rapport de performance',
        template: 'Rapport quotidien: {{totalProfit}} ({{winRate}} win rate)'
      }
    };
  }

  /**
   * Notifie un événement de transaction
   * @param {Object} trade - Données de la transaction
   * @param {Object} [options={}] - Options de notification
   * @returns {Promise<boolean>} Succès ou échec
   */
  async notifyTrade(trade, options = {}) {
    if (!this.options.enabled || !trade) return false;
    
    const type = trade.profit >= 0 ? 'achat' : 'vente';
    const priority = trade.profit >= 0 ? 'medium' : (Math.abs(trade.profit) > 100 ? 'high' : 'medium');
    
    return this.notify({
      type: 'trade',
      title: options.title || this.options.templates.trade.title,
      message: this.formatMessage(this.options.templates.trade.template, {
        type,
        token: trade.token,
        profit: formatCurrency(trade.profit),
        profitPercentage: formatPercentage(trade.profitPercentage),
        price: formatCurrency(trade.exitPrice)
      }),
      priority,
      data: trade,
      channels: options.channels || Object.keys(this.options.channels).filter(c => this.options.channels[c])
    });
  }

  /**
   * Notifie une alerte
   * @param {string} message - Message d'alerte
   * @param {string} [priority='medium'] - Priorité (low, medium, high)
   * @param {Object} [data={}] - Données supplémentaires
   * @returns {Promise<boolean>} Succès ou échec
   */
  async notifyAlert(message, priority = 'medium', data = {}) {
    if (!this.options.enabled || !message) return false;
    
    return this.notify({
      type: 'alert',
      title: this.options.templates.alert.title,
      message: this.formatMessage(this.options.templates.alert.template, {
        message,
        ...data
      }),
      priority,
      data,
      channels: Object.keys(this.options.channels).filter(c => this.options.channels[c])
    });
  }

  /**
   * Notifie une erreur
   * @param {string|Error} error - Message d'erreur ou objet Error
   * @param {string} [priority='high'] - Priorité (low, medium, high)
   * @param {Object} [data={}] - Données supplémentaires
   * @returns {Promise<boolean>} Succès ou échec
   */
  async notifyError(error, priority = 'high', data = {}) {
    if (!this.options.enabled) return false;
    
    let errorMessage = error;
    let errorData = { ...data };
    
    if (error instanceof Error) {
      errorMessage = error.message;
      errorData = {
        ...errorData,
        name: error.name,
        stack: error.stack,
        code: error.code
      };
    }
    
    return this.notify({
      type: 'error',
      title: this.options.templates.error.title,
      message: this.formatMessage(this.options.templates.error.template, {
        message: errorMessage
      }),
      priority,
      data: errorData,
      channels: Object.keys(this.options.channels).filter(c => this.options.channels[c])
    });
  }

  /**
   * Notifie un rapport de performance
   * @param {Object} metrics - Métriques de performance
   * @param {string} [priority='low'] - Priorité (low, medium, high)
   * @returns {Promise<boolean>} Succès ou échec
   */
  async notifyPerformance(metrics, priority = 'low') {
    if (!this.options.enabled || !metrics) return false;
    
    return this.notify({
      type: 'performance',
      title: this.options.templates.performance.title,
      message: this.formatMessage(this.options.templates.performance.template, {
        totalProfit: formatCurrency(metrics.totalProfit || 0),
        winRate: formatPercentage(metrics.winRate || 0),
        trades: metrics.totalTrades || 0,
        wins: metrics.winningTrades || 0,
        losses: metrics.losingTrades || 0
      }),
      priority,
      data: metrics,
      channels: Object.keys(this.options.channels).filter(c => this.options.channels[c])
    });
  }

  /**
   * Méthode générique pour envoyer une notification
   * @param {Object} notification - Notification à envoyer
   * @returns {Promise<boolean>} Succès ou échec
   */
  async notify(notification) {
    if (!this.options.enabled) return false;
    
    // Valider la notification
    if (!notification.message) {
      console.error('Notification sans message');
      return false;
    }
    
    // Vérifier si priorité suffisante selon le seuil configuré
    const priorityValues = { low: 1, medium: 2, high: 3 };
    const thresholdValue = priorityValues[this.options.priorityThreshold] || 1;
    const priorityValue = priorityValues[notification.priority] || 1;
    
    if (priorityValue < thresholdValue) {
      return false;
    }
    
    // Vérifier le throttling
    if (this.options.throttle.enabled && !this.canSendNotification(notification)) {
      // Ajouter à la file d'attente si c'est une notification importante
      if (notification.priority === 'high') {
        this.queue.push({
          ...notification,
          timestamp: Date.now()
        });
      }
      return false;
    }
    
    // Préparer la notification complète
    const completeNotification = {
      id: this.generateNotificationId(),
      timestamp: Date.now(),
      ...notification,
      channels: notification.channels || ['console']
    };
    
    // Mettre à jour les statistiques
    this.updateStats(completeNotification);
    
    // Émettre l'événement de notification
    this.emit('notification', completeNotification);
    
    // Envoyer sur tous les canaux configurés
    const results = await Promise.all(
      completeNotification.channels.map(channel => this.sendToChannel(channel, completeNotification))
    );
    
    // Retourner true si au moins un canal a réussi
    return results.some(result => result);
  }

  /**
   * Vérifie si une notification peut être envoyée selon les règles de throttling
   * @private
   * @param {Object} notification - Notification à vérifier
   * @returns {boolean} True si la notification peut être envoyée
   */
  canSendNotification(notification) {
    const now = Date.now();
    const throttle = this.options.throttle;
    
    // Toujours autoriser les notifications de haute priorité
    if (notification.priority === 'high') {
      return true;
    }
    
    // Nettoyer l'historique des notifications trop anciennes
    this.throttling.history = this.throttling.history.filter(ts => 
      (now - ts) < throttle.period
    );
    
    // Réinitialiser la période si nécessaire
    if (now - this.throttling.periodStart > throttle.period) {
      this.throttling.periodStart = now;
      this.throttling.history = [];
    }
    
    // Vérifier si le nombre max de notifications est atteint
    if (this.throttling.history.length >= throttle.maxPerPeriod) {
      return false;
    }
    
    // Ajouter à l'historique et autoriser
    this.throttling.history.push(now);
    return true;
  }

  /**
   * Envoie une notification sur un canal spécifique
   * @private
   * @param {string} channel - Canal de notification
   * @param {Object} notification - Notification à envoyer
   * @returns {Promise<boolean>} Succès ou échec
   */
  async sendToChannel(channel, notification) {
    try {
      switch (channel) {
        case 'console':
          this.sendToConsole(notification);
          return true;
          
        case 'email':
          return await this.sendToEmail(notification);
          
        case 'slack':
          return await this.sendToSlack(notification);
          
        case 'telegram':
          return await this.sendToTelegram(notification);
          
        case 'push':
          return await this.sendPushNotification(notification);
          
        default:
          console.warn(`Canal de notification non supporté: ${channel}`);
          return false;
      }
    } catch (error) {
      console.error(`Erreur lors de l'envoi de notification sur ${channel}:`, error);
      return false;
    }
  }

  /**
   * Envoie une notification à la console
   * @private
   * @param {Object} notification - Notification à envoyer
   */
  sendToConsole(notification) {
    const { type, title, message, priority } = notification;
    
    // Formater le message avec des couleurs selon la priorité
    let coloredMessage;
    switch (priority) {
      case 'high':
        coloredMessage = `\x1b[31m${message}\x1b[0m`; // Rouge
        break;
      case 'medium':
        coloredMessage = `\x1b[33m${message}\x1b[0m`; // Jaune
        break;
      default:
        coloredMessage = `\x1b[36m${message}\x1b[0m`; // Cyan
    }
    
    // Afficher la notification
    console.log(`[${new Date().toISOString()}] [${type.toUpperCase()}] ${title}: ${coloredMessage}`);
  }

  /**
   * Envoie une notification par email
   * @private
   * @param {Object} notification - Notification à envoyer
   * @returns {Promise<boolean>} Succès ou échec
   */
  async sendToEmail(notification) {
    // Note: Cette implémentation est un placeholder
    // Une vraie implémentation utiliserait une bibliothèque comme nodemailer
    
    console.log(`[EMAIL] Would send email: ${notification.title} - ${notification.message}`);
    return true;
  }

  /**
   * Envoie une notification à Slack
   * @private
   * @param {Object} notification - Notification à envoyer
   * @returns {Promise<boolean>} Succès ou échec
   */
  async sendToSlack(notification) {
    // Note: Cette implémentation est un placeholder
    
    console.log(`[SLACK] Would send to Slack: ${notification.title} - ${notification.message}`);
    return true;
  }

  /**
   * Envoie une notification à Telegram
   * @private
   * @param {Object} notification - Notification à envoyer
   * @returns {Promise<boolean>} Succès ou échec
   */
  async sendToTelegram(notification) {
    // Note: Cette implémentation est un placeholder
    
    console.log(`[TELEGRAM] Would send to Telegram: ${notification.title} - ${notification.message}`);
    return true;
  }

  /**
   * Envoie une notification push
   * @private
   * @param {Object} notification - Notification à envoyer
   * @returns {Promise<boolean>} Succès ou échec
   */
  async sendPushNotification(notification) {
    // Note: Cette implémentation est un placeholder
    
    console.log(`[PUSH] Would send push notification: ${notification.title} - ${notification.message}`);
    return true;
  }

  /**
   * Traite la file d'attente de notifications
   * @private
   */
  processQueue() {
    // Traiter les notifications en attente toutes les 5 secondes
    setInterval(() => {
      if (this.queue.length > 0) {
        const now = Date.now();
        
        // Vérifier si on peut envoyer de nouvelles notifications
        if (this.throttling.history.length < this.options.throttle.maxPerPeriod) {
          // Traiter au plus 5 notifications à la fois
          const toProcess = Math.min(5, this.queue.length, 
            this.options.throttle.maxPerPeriod - this.throttling.history.length);
          
          // Envoyer les notifications
          for (let i = 0; i < toProcess; i++) {
            const notification = this.queue.shift();
            this.notify(notification);
          }
        }
      }
    }, 5000);
  }

  /**
   * Met à jour les statistiques de notifications
   * @private
   * @param {Object} notification - Notification envoyée
   */
  updateStats(notification) {
    this.stats.totalSent++;
    this.stats.lastSent = notification.timestamp;
    
    // Mettre à jour par type
    this.stats.byType[notification.type] = (this.stats.byType[notification.type] || 0) + 1;
    
    // Mettre à jour par canal
    notification.channels.forEach(channel => {
      this.stats.byChannel[channel] = (this.stats.byChannel[channel] || 0) + 1;
    });
    
    // Garder un historique des notifications récentes (maximum 50)
    this.stats.recentNotifications.unshift({
      id: notification.id,
      timestamp: notification.timestamp,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      priority: notification.priority
    });
    
    if (this.stats.recentNotifications.length > 50) {
      this.stats.recentNotifications.pop();
    }
  }

  /**
   * Formate un message selon un modèle et des données
   * @private
   * @param {string} template - Modèle de message
   * @param {Object} data - Données pour le modèle
   * @returns {string} Message formaté
   */
  formatMessage(template, data) {
    if (!template) return '';
    
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] !== undefined ? data[key] : match;
    });
  }

  /**
   * Génère un identifiant unique pour une notification
   * @private
   * @returns {string} Identifiant de notification
   */
  generateNotificationId() {
    return 'notif_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  }

  /**
   * Obtient les statistiques de notifications
   * @returns {Object} Statistiques
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Configure les canaux de notification
   * @param {Object} channels - Configuration des canaux
   */
  configureChannels(channels) {
    this.options.channels = {
      ...this.options.channels,
      ...channels
    };
  }

  /**
   * Active ou désactive le service de notifications
   * @param {boolean} enabled - État d'activation
   */
  setEnabled(enabled) {
    this.options.enabled = !!enabled;
  }
}

export default NotificationService;
