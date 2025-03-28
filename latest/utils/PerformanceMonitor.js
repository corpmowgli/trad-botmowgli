// utils/PerformanceMonitor.js
import EventEmitter from 'events';
import os from 'os';

/**
 * Moniteur de performance pour suivre en temps réel les métriques système et d'application
 * Permet de détecter les problèmes de performance et d'optimiser l'exécution
 */
export class PerformanceMonitor extends EventEmitter {
  /**
   * Crée une instance de PerformanceMonitor
   * @param {Object} options - Options de configuration
   */
  constructor(options = {}) {
    super();
    
    // Configuration
    this.config = {
      sampleInterval: options.sampleInterval || 60000, // 1 minute par défaut
      memoryWarningThreshold: options.memoryWarningThreshold || 85, // % d'utilisation mémoire
      cpuWarningThreshold: options.cpuWarningThreshold || 80, // % d'utilisation CPU
      gcEnabled: typeof global.gc === 'function', // Vérifier si GC est disponible
      detailedLogging: options.detailedLogging !== false,
      metricHistory: options.metricHistory || 60, // Nombre de points à conserver
      autoGC: options.autoGC !== false && typeof global.gc === 'function' // GC automatique si disponible
    };
    
    // Métriques système
    this.systemMetrics = {
      cpu: [],
      memory: [],
      heap: [],
      eventLoop: [],
      lastUpdate: Date.now()
    };
    
    // Métriques d'application
    this.appMetrics = {
      requestCount: 0,
      errorCount: 0,
      requestLatency: [],
      cycleDurations: [],
      dataFetchDurations: []
    };
    
    // Métriques de trading
    this.tradingMetrics = {
      executionTimes: [],
      slippage: [],
      positions: {
        opened: 0,
        closed: 0
      },
      profitLoss: []
    };
    
    // Alertes
    this.alerts = [];
    
    // Historique des événements de performance
    this.events = [];
    
    // Démarrer la collecte
    this._startCollection();
  }

  /**
   * Démarre la collecte périodique de métriques
   * @private
   */
  _startCollection() {
    // Collecter immédiatement une première fois
    this._collectMetrics();
    
    // Configurer la collecte périodique
    this.collectionInterval = setInterval(() => {
      this._collectMetrics();
    }, this.config.sampleInterval);
    
    // Configurer le GC automatique si activé
    if (this.config.autoGC && this.config.gcEnabled) {
      this.gcInterval = setInterval(() => {
        // Exécuter le GC seulement si l'utilisation mémoire est élevée
        const memoryUsage = process.memoryUsage();
        const heapUsedPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
        
        if (heapUsedPercent > 70) {
          this._collectMetrics(true); // Collecter avant GC
          this._forceGC();
          setTimeout(() => this._collectMetrics(true), 500); // Collecter après GC
        }
      }, 5 * 60 * 1000); // Toutes les 5 minutes
    }
  }

  /**
   * Collecte les métriques actuelles
   * @private
   * @param {boolean} [isGC=false] - Indique si la collecte est liée à un GC
   */
  _collectMetrics(isGC = false) {
    const timestamp = Date.now();
    
    // Collecter l'utilisation CPU
    this._collectCPUUsage().then(cpuUsage => {
      // Métriques système
      const memoryUsage = process.memoryUsage();
      const systemMemory = {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usedPercent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
      };
      
      // Métriques de tas
      const heapMetrics = {
        total: memoryUsage.heapTotal,
        used: memoryUsage.heapUsed,
        usedPercent: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
        external: memoryUsage.external,
        rss: memoryUsage.rss
      };
      
      // Ajouter les métriques à l'historique
      this._addMetric('cpu', { value: cpuUsage, timestamp });
      this._addMetric('memory', { ...systemMemory, timestamp });
      this._addMetric('heap', { ...heapMetrics, timestamp });
      
      // Mettre à jour le timestamp de dernière mise à jour
      this.systemMetrics.lastUpdate = timestamp;
      
      // Vérifier les seuils d'alerte
      this._checkAlerts(cpuUsage, systemMemory.usedPercent, heapMetrics.usedPercent);
      
      // Émettre un événement avec les métriques actuelles
      this.emit('metrics_updated', {
        cpu: cpuUsage,
        memory: systemMemory,
        heap: heapMetrics,
        timestamp
      });
      
      // Journaliser les métriques si demandé
      if (this.config.detailedLogging && !isGC) {
        console.debug(`[PerformanceMonitor] CPU: ${cpuUsage.toFixed(2)}%, Heap: ${(heapMetrics.usedPercent).toFixed(2)}%, Memory: ${(systemMemory.usedPercent).toFixed(2)}%`);
      }
    });
  }

  /**
   * Collecte l'utilisation CPU
   * @private
   * @returns {Promise<number>} Pourcentage d'utilisation CPU
   */
  async _collectCPUUsage() {
    // Créer une promesse qui se résout après un court délai
    // pour mesurer l'utilisation CPU
    return new Promise(resolve => {
      const startUsage = process.cpuUsage();
      const startTime = process.hrtime();
      
      // Mesurer sur une courte période
      setTimeout(() => {
        const cpuUsage = process.cpuUsage(startUsage);
        const elapsedTime = process.hrtime(startTime);
        const elapsedTimeMS = elapsedTime[0] * 1000 + elapsedTime[1] / 1000000;
        
        // Calculer le pourcentage d'utilisation
        const userPercent = (cpuUsage.user / 1000) / elapsedTimeMS * 100;
        const sysPercent = (cpuUsage.system / 1000) / elapsedTimeMS * 100;
        
        // Total CPU usage (peut dépasser 100% sur les systèmes multi-cœurs)
        const totalPercent = Math.min(100, userPercent + sysPercent);
        
        resolve(totalPercent);
      }, 500); // Mesurer sur 500ms
    });
  }

  /**
   * Force l'exécution du garbage collector si disponible
   * @private
   */
  _forceGC() {
    if (this.config.gcEnabled) {
      try {
        // Enregistrer l'utilisation mémoire avant GC
        const beforeGC = process.memoryUsage().heapUsed / 1024 / 1024;
        
        // Forcer le GC
        global.gc();
        
        // Enregistrer l'utilisation mémoire après GC
        const afterGC = process.memoryUsage().heapUsed / 1024 / 1024;
        const freed = beforeGC - afterGC;
        
        // Journaliser le résultat du GC
        this._recordEvent('gc', {
          beforeMB: beforeGC.toFixed(2),
          afterMB: afterGC.toFixed(2),
          freedMB: freed.toFixed(2)
        });
        
        if (this.config.detailedLogging) {
          console.debug(`[PerformanceMonitor] GC freed ${freed.toFixed(2)} MB, heap now at ${afterGC.toFixed(2)} MB`);
        }
      } catch (error) {
        console.error('[PerformanceMonitor] Error forcing GC:', error);
      }
    }
  }

  /**
   * Vérifie les seuils d'alerte et émet les alertes nécessaires
   * @private
   * @param {number} cpuUsage - Utilisation CPU
   * @param {number} memoryUsage - Utilisation mémoire système
   * @param {number} heapUsage - Utilisation mémoire heap
   */
  _checkAlerts(cpuUsage, memoryUsage, heapUsage) {
    // Vérifier l'utilisation CPU
    if (cpuUsage > this.config.cpuWarningThreshold) {
      this._triggerAlert('CPU_USAGE_HIGH', {
        value: cpuUsage,
        threshold: this.config.cpuWarningThreshold
      });
    }
    
    // Vérifier l'utilisation mémoire système
    if (memoryUsage > this.config.memoryWarningThreshold) {
      this._triggerAlert('SYSTEM_MEMORY_HIGH', {
        value: memoryUsage,
        threshold: this.config.memoryWarningThreshold
      });
    }
    
    // Vérifier l'utilisation mémoire heap
    if (heapUsage > 90) {
      this._triggerAlert('HEAP_MEMORY_CRITICAL', {
        value: heapUsage,
        threshold: 90
      });
      
      // Tenter un GC si disponible
      if (this.config.gcEnabled) {
        this._forceGC();
      }
    } else if (heapUsage > 80) {
      this._triggerAlert('HEAP_MEMORY_HIGH', {
        value: heapUsage,
        threshold: 80
      });
    }
    
    // Vérifier l'augmentation de mémoire progressive (fuite potentielle)
    if (this.systemMetrics.heap.length > 5) {
      const recentHeap = this.systemMetrics.heap.slice(-5);
      
      // Vérifier si tous les points sont en augmentation
      let increasing = true;
      for (let i = 1; i < recentHeap.length; i++) {
        if (recentHeap[i].used <= recentHeap[i-1].used) {
          increasing = false;
          break;
        }
      }
      
      // Calculer le taux d'augmentation
      if (increasing) {
        const firstHeap = recentHeap[0].used;
        const lastHeap = recentHeap[recentHeap.length - 1].used;
        const increasePercent = ((lastHeap - firstHeap) / firstHeap) * 100;
        
        if (increasePercent > 20) {
          this._triggerAlert('MEMORY_LEAK_SUSPECTED', {
            increasePercent,
            period: `${recentHeap.length * (this.config.sampleInterval / 60000)} minutes`
          });
        }
      }
    }
  }

  /**
   * Déclenche une alerte
   * @private
   * @param {string} type - Type d'alerte
   * @param {Object} data - Données de l'alerte
   */
  _triggerAlert(type, data) {
    // Créer l'alerte
    const alert = {
      type,
      timestamp: Date.now(),
      data
    };
    
    // Ajouter à l'historique des alertes
    this.alerts.unshift(alert);
    
    // Limiter la taille de l'historique
    if (this.alerts.length > 20) {
      this.alerts.pop();
    }
    
    // Émettre l'événement d'alerte
    this.emit('alert', alert);
    
    // Journaliser l'alerte
    console.warn(`[PerformanceMonitor] ALERT: ${type}`, data);
  }

  /**
   * Ajoute une métrique à l'historique
   * @private
   * @param {string} metricType - Type de métrique
   * @param {Object} value - Valeur à ajouter
   */
  _addMetric(metricType, value) {
    if (!this.systemMetrics[metricType]) return;
    
    this.systemMetrics[metricType].push(value);
    
    // Limiter la taille de l'historique
    if (this.systemMetrics[metricType].length > this.config.metricHistory) {
      this.systemMetrics[metricType].shift();
    }
  }

  /**
   * Enregistre un événement de performance
   * @private
   * @param {string} type - Type d'événement
   * @param {Object} data - Données associées
   */
  _recordEvent(type, data) {
    const event = {
      type,
      timestamp: Date.now(),
      data
    };
    
    this.events.unshift(event);
    
    // Limiter la taille de l'historique
    if (this.events.length > 100) {
      this.events.pop();
    }
    
    this.emit('event', event);
  }

  /**
   * Enregistre le temps d'exécution d'un cycle de trading
   * @param {number} duration - Durée en millisecondes
   * @param {Object} [details={}] - Détails supplémentaires
   */
  recordCycleDuration(duration, details = {}) {
    this.appMetrics.cycleDurations.push({
      duration,
      timestamp: Date.now(),
      ...details
    });
    
    // Limiter la taille de l'historique
    if (this.appMetrics.cycleDurations.length > this.config.metricHistory) {
      this.appMetrics.cycleDurations.shift();
    }
    
    // Vérifier si la durée est anormalement longue
    const avgDuration = this._calculateAverage(this.appMetrics.cycleDurations.map(d => d.duration));
    if (duration > avgDuration * 2 && this.appMetrics.cycleDurations.length > 5) {
      this._recordEvent('slow_cycle', {
        duration,
        average: avgDuration,
        timestamp: Date.now()
      });
      
      if (duration > 10000) { // Plus de 10 secondes
        this._triggerAlert('CYCLE_DURATION_HIGH', {
          duration,
          average: avgDuration
        });
      }
    }
  }

  /**
   * Enregistre le temps d'exécution d'une requête API
   * @param {string} endpoint - Endpoint de l'API
   * @param {number} duration - Durée en millisecondes
   */
  recordApiLatency(endpoint, duration) {
    this.appMetrics.requestLatency.push({
      endpoint,
      duration,
      timestamp: Date.now()
    });
    
    // Incrémenter le compteur de requêtes
    this.appMetrics.requestCount++;
    
    // Limiter la taille de l'historique
    if (this.appMetrics.requestLatency.length > this.config.metricHistory) {
      this.appMetrics.requestLatency.shift();
    }
    
    // Vérifier si la latence est anormalement élevée
    if (duration > 5000) { // Plus de 5 secondes
      this._recordEvent('high_api_latency', {
        endpoint,
        duration,
        timestamp: Date.now()
      });
      
      if (duration > 10000) { // Plus de 10 secondes
        this._triggerAlert('API_LATENCY_HIGH', {
          endpoint,
          duration
        });
      }
    }
  }

  /**
   * Enregistre une erreur d'application
   * @param {string} type - Type d'erreur
   * @param {string} message - Message d'erreur
   * @param {Object} [details={}] - Détails supplémentaires
   */
  recordError(type, message, details = {}) {
    this.appMetrics.errorCount++;
    
    this._recordEvent('error', {
      type,
      message,
      ...details,
      timestamp: Date.now()
    });
    
    // Vérifier s'il y a beaucoup d'erreurs récentes
    const recentErrors = this.events
      .filter(e => e.type === 'error' && e.timestamp > Date.now() - 300000); // 5 dernières minutes
    
    if (recentErrors.length >= 5) {
      this._triggerAlert('ERROR_RATE_HIGH', {
        count: recentErrors.length,
        period: '5 minutes'
      });
    }
  }

  /**
   * Enregistre des métriques de trading
   * @param {string} type - Type de métrique (execution, slippage, position, profit)
   * @param {Object} data - Données de la métrique
   */
  recordTradingMetric(type, data) {
    switch (type) {
      case 'execution':
        this.tradingMetrics.executionTimes.push({
          ...data,
          timestamp: Date.now()
        });
        
        if (this.tradingMetrics.executionTimes.length > this.config.metricHistory) {
          this.tradingMetrics.executionTimes.shift();
        }
        
        // Vérifier si le temps d'exécution est anormalement long
        if (data.duration > 5000) { // Plus de 5 secondes
          this._recordEvent('slow_trade_execution', {
            ...data,
            timestamp: Date.now()
          });
          
          if (data.duration > 10000) { // Plus de 10 secondes
            this._triggerAlert('TRADE_EXECUTION_SLOW', {
              ...data
            });
          }
        }
        break;
        
      case 'slippage':
        this.tradingMetrics.slippage.push({
          ...data,
          timestamp: Date.now()
        });
        
        if (this.tradingMetrics.slippage.length > this.config.metricHistory) {
          this.tradingMetrics.slippage.shift();
        }
        
        // Vérifier si le slippage est anormalement élevé
        if (Math.abs(data.percent) > 1) { // Plus de 1%
          this._recordEvent('high_slippage', {
            ...data,
            timestamp: Date.now()
          });
          
          if (Math.abs(data.percent) > 3) { // Plus de 3%
            this._triggerAlert('HIGH_SLIPPAGE_DETECTED', {
              ...data
            });
          }
        }
        break;
        
      case 'position':
        if (data.action === 'open') {
          this.tradingMetrics.positions.opened++;
        } else if (data.action === 'close') {
          this.tradingMetrics.positions.closed++;
        }
        break;
        
      case 'profit':
        this.tradingMetrics.profitLoss.push({
          ...data,
          timestamp: Date.now()
        });
        
        if (this.tradingMetrics.profitLoss.length > this.config.metricHistory) {
          this.tradingMetrics.profitLoss.shift();
        }
        break;
        
      default:
        // Ignorer les types inconnus
        break;
    }
  }

  /**
   * Récupère les métriques de performance
   * @returns {Object} Métriques de performance
   */
  getMetrics() {
    // Calculer les moyennes et tendances
    const cpuAvg = this._calculateAverage(this.systemMetrics.cpu.map(m => m.value));
    const memoryAvg = this._calculateAverage(this.systemMetrics.memory.map(m => m.usedPercent));
    const heapAvg = this._calculateAverage(this.systemMetrics.heap.map(m => m.usedPercent));
    
    const cycleAvg = this._calculateAverage(this.appMetrics.cycleDurations.map(d => d.duration));
    const apiLatencyAvg = this._calculateAverage(this.appMetrics.requestLatency.map(d => d.duration));
    
    const slippageAvg = this._calculateAverage(this.tradingMetrics.slippage.map(s => s.percent));
    const executionTimeAvg = this._calculateAverage(this.tradingMetrics.executionTimes.map(e => e.duration));
    
    // Calculer les tendances sur les 5 derniers points
    const cpuTrend = this._calculateTrend(this.systemMetrics.cpu.slice(-5).map(m => m.value));
    const heapTrend = this._calculateTrend(this.systemMetrics.heap.slice(-5).map(m => m.usedPercent));
    
    return {
      system: {
        cpu: {
          current: this.systemMetrics.cpu.length > 0 ? this.systemMetrics.cpu[this.systemMetrics.cpu.length - 1].value : 0,
          average: cpuAvg,
          trend: cpuTrend,
          history: this.systemMetrics.cpu.map(m => ({ value: m.value, timestamp: m.timestamp }))
        },
        memory: {
          current: this.systemMetrics.memory.length > 0 ? this.systemMetrics.memory[this.systemMetrics.memory.length - 1] : { usedPercent: 0 },
          average: memoryAvg,
          trend: this._calculateTrend(this.systemMetrics.memory.slice(-5).map(m => m.usedPercent)),
          history: this.systemMetrics.memory.map(m => ({ usedPercent: m.usedPercent, timestamp: m.timestamp }))
        },
        heap: {
          current: this.systemMetrics.heap.length > 0 ? this.systemMetrics.heap[this.systemMetrics.heap.length - 1] : { usedPercent: 0 },
          average: heapAvg,
          trend: heapTrend,
          history: this.systemMetrics.heap.map(m => ({ usedPercent: m.usedPercent, used: m.used, total: m.total, timestamp: m.timestamp }))
        }
      },
      application: {
        cycle: {
          average: cycleAvg,
          trend: this._calculateTrend(this.appMetrics.cycleDurations.slice(-5).map(d => d.duration)),
          history: this.appMetrics.cycleDurations
        },
        api: {
          requestCount: this.appMetrics.requestCount,
          errorCount: this.appMetrics.errorCount,
          latencyAvg: apiLatencyAvg,
          history: this.appMetrics.requestLatency
        }
      },
      trading: {
        positions: this.tradingMetrics.positions,
        slippage: {
          average: slippageAvg,
          history: this.tradingMetrics.slippage
        },
        executionTime: {
          average: executionTimeAvg,
          history: this.tradingMetrics.executionTimes
        },
        profitLoss: {
          history: this.tradingMetrics.profitLoss
        }
      },
      alerts: this.alerts.slice(0, 10),
      events: this.events.slice(0, 20),
      lastUpdate: this.systemMetrics.lastUpdate
    };
  }

  /**
   * Calcule la moyenne d'un tableau de valeurs
   * @private
   * @param {Array<number>} values - Valeurs
   * @returns {number} Moyenne
   */
  _calculateAverage(values) {
    if (!values || values.length === 0) return 0;
    
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  }

  /**
   * Calcule la tendance d'un tableau de valeurs
   * @private
   * @param {Array<number>} values - Valeurs
   * @returns {string} Tendance ('up', 'down', 'stable')
   */
  _calculateTrend(values) {
    if (!values || values.length < 2) return 'stable';
    
    // Calculer la pente de la tendance
    const first = values[0];
    const last = values[values.length - 1];
    const change = last - first;
    const percentChange = (change / first) * 100;
    
    if (percentChange > 5) return 'up';
    if (percentChange < -5) return 'down';
    return 'stable';
  }

  /**
   * Arrête le moniteur de performance
   */
  stop() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
    }
    
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
    }
    
    this.emit('stopped');
  }

  /**
   * Génère un rapport de performance formaté
   * @returns {string} Rapport formaté
   */
  generateReport() {
    const metrics = this.getMetrics();
    
    let report = '=== PERFORMANCE REPORT ===\n\n';
    
    // Métriques système
    report += 'SYSTEM METRICS:\n';
    report += `CPU: ${metrics.system.cpu.current.toFixed(2)}% (avg: ${metrics.system.cpu.average.toFixed(2)}%, trend: ${metrics.system.cpu.trend})\n`;
    report += `Memory: ${metrics.system.memory.current.usedPercent.toFixed(2)}% (avg: ${metrics.system.memory.average.toFixed(2)}%, trend: ${metrics.system.memory.trend})\n`;
    report += `Heap: ${metrics.system.heap.current.usedPercent.toFixed(2)}% (avg: ${metrics.system.heap.average.toFixed(2)}%, trend: ${metrics.system.heap.trend})\n`;
    report += `Heap Size: ${(metrics.system.heap.current.used / 1024 / 1024).toFixed(2)} MB / ${(metrics.system.heap.current.total / 1024 / 1024).toFixed(2)} MB\n\n`;
    
    // Métriques d'application
    report += 'APPLICATION METRICS:\n';
    report += `Average Cycle Time: ${metrics.application.cycle.average.toFixed(2)} ms (trend: ${metrics.application.cycle.trend})\n`;
    report += `API Requests: ${metrics.application.api.requestCount} (errors: ${metrics.application.api.errorCount})\n`;
    report += `API Latency: ${metrics.application.api.latencyAvg.toFixed(2)} ms\n\n`;
    
    // Métriques de trading
    report += 'TRADING METRICS:\n';
    report += `Positions: ${metrics.trading.positions.opened} opened, ${metrics.trading.positions.closed} closed\n`;
    report += `Average Slippage: ${metrics.trading.slippage.average.toFixed(4)}%\n`;
    report += `Average Execution Time: ${metrics.trading.executionTime.average.toFixed(2)} ms\n\n`;
    
    // Alertes récentes
    report += 'RECENT ALERTS:\n';
    if (metrics.alerts.length === 0) {
      report += 'No recent alerts\n';
    } else {
      metrics.alerts.forEach(alert => {
        report += `[${new Date(alert.timestamp).toLocaleTimeString()}] ${alert.type}: ${JSON.stringify(alert.data)}\n`;
      });
    }
    
    return report;
  }
}

export default PerformanceMonitor;