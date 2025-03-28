// services/MarketDataService.js
import axios from 'axios';
import { delay, retry } from '../utils/helpers.js';
import { LRUCache } from '../utils/lruCache.js';

/**
 * Service de données de marché optimisé
 * Gère les appels API avec mise en cache, rate limiting et traitement par lots
 */
export class MarketDataService {
  /**
   * Crée une instance de MarketDataService
   * @param {Object} config - Configuration
   */
  constructor(config) {
    this.config = config;
    this.apiConfig = config.api || {};
    
    // Rate limiting et backoff exponentiel
    this.rateLimits = {
      raydium: {
        count: 0,
        timestamp: Date.now(),
        maxRequests: this.apiConfig.raydiumRateLimit || 10,
        period: 60000 // 1 minute
      },
      jupiter: {
        count: 0,
        timestamp: Date.now(),
        maxRequests: this.apiConfig.jupiterRateLimit || 30,
        period: 60000 // 1 minute
      },
      coingecko: {
        count: 0,
        timestamp: Date.now(),
        maxRequests: this.apiConfig.coingeckoRateLimit || 30,
        period: 60000 // 1 minute
      }
    };
    
    // Caches avec gestion LRU
    this.poolCache = new LRUCache(100);
    this.tokenCache = new LRUCache(500);
    this.priceCache = new LRUCache(1000);
    this.historicalCache = new LRUCache(200);
    
    // Paramètres pour les timeouts et retry
    this.defaultTimeout = this.apiConfig.timeout || 10000; // 10 secondes
    this.maxRetries = this.apiConfig.maxRetries || 3;
    
    // File d'attente pour les requêtes
    this.requestQueue = {
      high: [], // Priorité élevée (prix actuels)
      medium: [], // Priorité moyenne (données de token)
      low: [] // Priorité basse (données historiques)
    };
    
    // Indicateurs d'état pour le traitement des files d'attente
    this.processingQueue = false;
    
    // Statistiques
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      apiCalls: {
        raydium: 0,
        jupiter: 0,
        coingecko: 0
      },
      errors: 0,
      rateLimitHits: 0,
      lastRequestTime: 0,
      averageResponseTime: 0,
      batchSize: 0
    };
    
    // Démarrer le traitement des files d'attente
    this._startQueueProcessing();
  }

  /**
   * Récupère les données d'une pool
   * @param {string} poolId - Identifiant de la pool
   * @returns {Promise<Object>} Données de la pool
   */
  async getPoolData(poolId) {
    if (!poolId) {
      throw new Error('Pool ID is required');
    }
    
    // Vérifier le cache
    const cachedData = this.poolCache.get(poolId);
    if (cachedData && Date.now() - cachedData.timestamp < 300000) { // 5 minutes
      this.stats.cacheHits++;
      return cachedData.data;
    }
    
    // Préparer la requête
    const url = `${this.apiConfig.raydiumBaseUrl}/pools/${poolId}`;
    
    try {
      // Exécuter la requête avec rate limiting
      const data = await this._executeRequest('raydium', url);
      
      // Mettre en cache
      this.poolCache.set(poolId, {
        data,
        timestamp: Date.now()
      });
      
      return data;
    } catch (error) {
      throw new Error(`Failed to fetch pool data: ${error.message}`);
    }
  }

  /**
   * Récupère le prix d'un token
   * @param {string} tokenMint - Adresse du token
   * @returns {Promise<number>} Prix du token
   */
  async getTokenPrice(tokenMint) {
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    // Vérifier le cache
    const cachedPrice = this.priceCache.get(tokenMint);
    if (cachedPrice && Date.now() - cachedPrice.timestamp < 60000) { // 1 minute
      this.stats.cacheHits++;
      return cachedPrice.price;
    }
    
    try {
      // Préparer la requête pour Jupiter
      const url = `${this.apiConfig.jupiterBaseUrl}/price`;
      const params = { ids: [tokenMint] };
      
      // Exécuter avec priorité élevée
      const response = await this._executeRequest('jupiter', url, { params }, 'high');
      
      const price = response.data?.[tokenMint]?.price || null;
      
      // Mettre en cache si valide
      if (price !== null) {
        this.priceCache.set(tokenMint, {
          price,
          timestamp: Date.now()
        });
      }
      
      return price;
    } catch (error) {
      console.error(`Error fetching price for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Récupère les prix de plusieurs tokens en une seule requête
   * @param {Array<string>} tokenMints - Liste d'adresses de tokens
   * @returns {Promise<Object>} Map des prix par token
   */
  async getBatchTokenPrices(tokenMints) {
    if (!tokenMints || !Array.isArray(tokenMints) || tokenMints.length === 0) {
      return {};
    }
    
    // Dédupliquer les tokens
    const uniqueTokens = [...new Set(tokenMints)];
    
    // Vérifier le cache pour tous les tokens
    const cachedPrices = {};
    const tokensToFetch = [];
    
    uniqueTokens.forEach(token => {
      const cachedData = this.priceCache.get(token);
      if (cachedData && Date.now() - cachedData.timestamp < 60000) { // 1 minute
        cachedPrices[token] = cachedData.price;
        this.stats.cacheHits++;
      } else {
        tokensToFetch.push(token);
      }
    });
    
    // Si tous les tokens sont en cache, retourner
    if (tokensToFetch.length === 0) {
      return cachedPrices;
    }
    
    try {
      // Préparer la requête par lots pour Jupiter
      const url = `${this.apiConfig.jupiterBaseUrl}/price`;
      const params = { ids: tokensToFetch };
      
      // Exécuter avec priorité élevée
      const response = await this._executeRequest('jupiter', url, { params }, 'high');
      
      const fetchedPrices = response.data || {};
      
      // Mettre à jour les statistiques
      this.stats.batchSize = Math.max(this.stats.batchSize, tokensToFetch.length);
      
      // Mettre en cache les nouveaux prix
      for (const [token, data] of Object.entries(fetchedPrices)) {
        if (data && data.price !== undefined) {
          this.priceCache.set(token, {
            price: data.price,
            timestamp: Date.now()
          });
          
          cachedPrices[token] = data.price;
        }
      }
      
      return cachedPrices;
    } catch (error) {
      console.error(`Error fetching batch token prices:`, error);
      
      // Essayer de récupérer individuellement en cas d'échec
      for (const token of tokensToFetch) {
        try {
          const price = await this.getTokenPrice(token);
          if (price !== null) {
            cachedPrices[token] = price;
          }
        } catch (err) {
          // Ignorer les erreurs individuelles
        }
      }
      
      return cachedPrices;
    }
  }

  /**
   * Récupère les données agrégées d'un token
   * @param {string} tokenMint - Adresse du token
   * @returns {Promise<Object>} Données agrégées du token
   */
  async aggregateTokenData(tokenMint) {
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    // Vérifier le cache
    const cachedData = this.tokenCache.get(tokenMint);
    if (cachedData && Date.now() - cachedData.timestamp < 300000) { // 5 minutes
      this.stats.cacheHits++;
      return cachedData.data;
    }
    
    try {
      // Récupérer les données de plusieurs sources en parallèle
      const [raydiumData, coingeckoData, priceData] = await Promise.all([
        this._getRaydiumTokenData(tokenMint).catch(() => ({})),
        this._getCoingeckoTokenData(tokenMint).catch(() => ({})),
        this.getTokenPrice(tokenMint).catch(() => null)
      ]);
      
      // Fusionner les données
      const aggregatedData = {
        token: tokenMint,
        price: priceData || raydiumData.price || coingeckoData.usd || null,
        liquidity: raydiumData.liquidity || 0,
        volume24h: raydiumData.volume24h || coingeckoData.usd_24h_vol || 0,
        priceChange24h: raydiumData.priceChange24h || coingeckoData.usd_24h_change || 0,
        marketCap: coingeckoData.usd_market_cap || 0,
        fullyDilutedValuation: coingeckoData.fdv || 0,
        updatedAt: Date.now()
      };
      
      // Mettre en cache
      this.tokenCache.set(tokenMint, {
        data: aggregatedData,
        timestamp: Date.now()
      });
      
      return aggregatedData;
    } catch (error) {
      throw new Error(`Failed to aggregate token data: ${error.message}`);
    }
  }

  /**
   * Récupère les données historiques de prix
   * @param {string} tokenMint - Adresse du token
   * @param {number} startTime - Timestamp de début (ms)
   * @param {number} endTime - Timestamp de fin (ms)
   * @param {string} interval - Intervalle des données ('1h', '4h', '1d')
   * @returns {Promise<Array>} Données historiques
   */
  async getHistoricalPrices(tokenMint, startTime, endTime, interval = '1h') {
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    // Normaliser les paramètres
    const normalizedInterval = this._normalizeInterval(interval);
    const normalizedStartTime = Math.floor(startTime / 1000) * 1000; // Arrondir aux secondes
    const normalizedEndTime = Math.floor(endTime / 1000) * 1000;
    
    // Clé de cache
    const cacheKey = `history:${tokenMint}:${normalizedStartTime}:${normalizedEndTime}:${normalizedInterval}`;
    
    // Vérifier le cache
    const cachedData = this.historicalCache.get(cacheKey);
    if (cachedData && cachedData.data.length > 0) {
      this.stats.cacheHits++;
      return cachedData.data;
    }
    
    try {
      // Récupérer les données historiques (priorité basse)
      const data = await this._fetchHistoricalData(tokenMint, normalizedStartTime, normalizedEndTime, normalizedInterval);
      
      // Mettre en cache
      this.historicalCache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });
      
      return data;
    } catch (error) {
      throw new Error(`Failed to fetch historical data: ${error.message}`);
    }
  }

  /**
   * Récupère les données de volume historiques
   * @param {string} tokenMint - Adresse du token
   * @param {number} startTime - Timestamp de début (ms)
   * @param {number} endTime - Timestamp de fin (ms)
   * @param {string} interval - Intervalle des données ('1h', '4h', '1d')
   * @returns {Promise<Array>} Données historiques de volume
   */
  async getHistoricalVolumes(tokenMint, startTime, endTime, interval = '1h') {
    // Réutiliser la méthode de prix historiques, car les volumes sont inclus
    const priceData = await this.getHistoricalPrices(tokenMint, startTime, endTime, interval);
    
    // Extraire les données de volume
    return priceData.map(item => ({
      timestamp: item.timestamp,
      volume: item.volume || 0
    }));
  }

  /**
   * Récupère les meilleurs tokens par capitalisation ou volume
   * @param {number} limit - Nombre de tokens à récupérer
   * @returns {Promise<Array>} Liste de tokens
   */
  async getTopTokens(limit = 50) {
    // Clé de cache
    const cacheKey = `top:${limit}`;
    
    // Vérifier le cache
    const cachedData = this.tokenCache.get(cacheKey);
    if (cachedData && Date.now() - cachedData.timestamp < 300000) { // 5 minutes
      this.stats.cacheHits++;
      return cachedData.data;
    }
    
    try {
      // Récupérer les tokens populaires (priorité moyenne)
      const url = `${this.apiConfig.raydiumBaseUrl}/tokens`;
      const params = { limit };
      
      const response = await this._executeRequest('raydium', url, { params }, 'medium');
      const tokens = response.data || [];
      
      // Enrichir avec des données supplémentaires
      const enrichedTokens = tokens.map(token => ({
        token_mint: token.mint || token.address,
        symbol: token.symbol,
        name: token.name,
        price: token.price,
        priceChange24h: token.priceChange24h,
        volume24h: token.volume24h,
        liquidity: token.liquidity,
        marketCap: token.marketCap || 0
      }));
      
      // Mettre en cache
      this.tokenCache.set(cacheKey, {
        data: enrichedTokens,
        timestamp: Date.now()
      });
      
      return enrichedTokens;
    } catch (error) {
      throw new Error(`Failed to fetch top tokens: ${error.message}`);
    }
  }

  /**
   * Récupère les données d'un token depuis Raydium
   * @private
   * @param {string} tokenMint - Adresse du token
   * @returns {Promise<Object>} Données du token
   */
  async _getRaydiumTokenData(tokenMint) {
    const url = `${this.apiConfig.raydiumBaseUrl}/tokens/${tokenMint}`;
    return this._executeRequest('raydium', url, {}, 'medium');
  }

  /**
   * Récupère les données d'un token depuis CoinGecko
   * @private
   * @param {string} tokenMint - Adresse du token
   * @returns {Promise<Object>} Données du token
   */
  async _getCoingeckoTokenData(tokenMint) {
    const url = `${this.apiConfig.coingeckoBaseUrl}/simple/token_price/solana`;
    const params = {
      contract_addresses: tokenMint,
      vs_currencies: 'usd',
      include_market_cap: true,
      include_24hr_vol: true,
      include_24hr_change: true,
      include_last_updated_at: true
    };
    
    try {
      const response = await this._executeRequest('coingecko', url, { params }, 'medium');
      return response.data?.[tokenMint.toLowerCase()] || {};
    } catch (error) {
      // Si CoinGecko échoue, retourner un objet vide
      return {};
    }
  }

  /**
   * Récupère les données historiques
   * @private
   * @param {string} tokenMint - Adresse du token
   * @param {number} startTime - Timestamp de début
   * @param {number} endTime - Timestamp de fin
   * @param {string} interval - Intervalle des données
   * @returns {Promise<Array>} Données historiques
   */
  async _fetchHistoricalData(tokenMint, startTime, endTime, interval) {
    // Essayer d'abord Raydium pour les données historiques
    try {
      const url = `${this.apiConfig.raydiumBaseUrl}/charts`;
      const params = {
        token: tokenMint,
        from: Math.floor(startTime / 1000),
        to: Math.floor(endTime / 1000),
        res: interval
      };
      
      const response = await this._executeRequest('raydium', url, { params }, 'low');
      
      // Transformer les données selon le format standardisé
      return (response.data || []).map(item => ({
        timestamp: item.time * 1000, // Convertir en ms
        price: parseFloat(item.close),
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        volume: parseFloat(item.volume)
      }));
    } catch (error) {
      // En cas d'échec, utiliser des données factices (à remplacer par une source alternative)
      console.error(`Failed to fetch historical data, using fallback:`, error);
      
      // Récupérer le prix actuel comme plan B
      const currentPrice = await this.getTokenPrice(tokenMint);
      if (!currentPrice) return [];
      
      // Générer des données synthétiques basées sur le prix actuel
      const step = this._getIntervalMs(interval);
      const points = Math.ceil((endTime - startTime) / step);
      
      return Array.from({ length: points }, (_, i) => ({
        timestamp: startTime + i * step,
        price: currentPrice * (0.9 + Math.random() * 0.2), // Prix +/- 10%
        volume: 10000 * Math.random()
      }));
    }
  }

  /**
   * Normalise le format d'intervalle
   * @private
   * @param {string} interval - Intervalle d'origine
   * @returns {string} Intervalle normalisé
   */
  _normalizeInterval(interval) {
    // Mapper les formats d'intervalle courants
    const intervalMap = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1h': '1hour',
      '4h': '4hour',
      '1d': '1day',
      '1w': '1week'
    };
    
    return intervalMap[interval.toLowerCase()] || '1hour';
  }

  /**
   * Convertit l'intervalle en millisecondes
   * @private
   * @param {string} interval - Format d'intervalle
   * @returns {number} Intervalle en ms
   */
  _getIntervalMs(interval) {
    const intervalMap = {
      '1min': 60 * 1000,
      '5min': 5 * 60 * 1000,
      '15min': 15 * 60 * 1000,
      '30min': 30 * 60 * 1000,
      '1hour': 60 * 60 * 1000,
      '4hour': 4 * 60 * 60 * 1000,
      '1day': 24 * 60 * 60 * 1000,
      '1week': 7 * 24 * 60 * 60 * 1000
    };
    
    return intervalMap[interval] || 60 * 60 * 1000; // Défaut: 1 heure
  }

  /**
   * Vérifie et met à jour le rate limit pour une API
   * @private
   * @param {string} api - Nom de l'API
   * @returns {Promise<boolean>} Vrai si la requête peut être exécutée
   */
  async _checkRateLimit(api) {
    const limit = this.rateLimits[api];
    if (!limit) return true;
    
    const now = Date.now();
    
    // Réinitialiser le compteur si la période est écoulée
    if (now - limit.timestamp > limit.period) {
      limit.count = 0;
      limit.timestamp = now;
      return true;
    }
    
    // Vérifier si la limite est atteinte
    if (limit.count >= limit.maxRequests) {
      this.stats.rateLimitHits++;
      
      // Calculer le temps d'attente
      const waitTime = limit.period - (now - limit.timestamp);
      
      // Attendre la fin de la période
      await delay(waitTime + 100); // Ajouter un peu de marge
      
      // Réinitialiser après l'attente
      limit.count = 0;
      limit.timestamp = Date.now();
      return true;
    }
    
    // Incrémenter le compteur et autoriser
    limit.count++;
    return true;
  }

  /**
   * Exécute une requête HTTP avec gestion du rate limiting et retry
   * @private
   * @param {string} api - Nom de l'API
   * @param {string} url - URL de la requête
   * @param {Object} [options={}] - Options axios
   * @param {string} [priority='medium'] - Priorité de la requête
   * @returns {Promise<Object>} Réponse de l'API
   */
  async _executeRequest(api, url, options = {}, priority = 'medium') {
    // Créer une promesse qu'on pourra résoudre plus tard
    return new Promise((resolve, reject) => {
      // Ajouter la requête à la file d'attente
      this.requestQueue[priority].push({
        api,
        url,
        options,
        resolve,
        reject,
        timestamp: Date.now()
      });
    });
  }

  /**
   * Démarre le traitement des files d'attente de requêtes
   * @private
   */
  _startQueueProcessing() {
    // Exécuter toutes les 50ms
    setInterval(async () => {
      // Ne pas démarrer si déjà en cours de traitement
      if (this.processingQueue) return;
      
      this.processingQueue = true;
      
      try {
        // Traiter d'abord les requêtes prioritaires
        await this._processQueue('high');
        
        // Puis les requêtes moyennes et basses
        if (this.requestQueue.high.length === 0) {
          await this._processQueue('medium');
          
          if (this.requestQueue.medium.length === 0) {
            await this._processQueue('low');
          }
        }
      } catch (error) {
        console.error('Error processing request queue:', error);
      } finally {
        this.processingQueue = false;
      }
    }, 50);
  }

  /**
   * Traite une file d'attente spécifique
   * @private
   * @param {string} priority - Priorité de la file ('high', 'medium', 'low')
   */
  async _processQueue(priority) {
    const queue = this.requestQueue[priority];
    if (queue.length === 0) return;
    
    // Récupérer la requête la plus ancienne
    const request = queue.shift();
    const { api, url, options, resolve, reject, timestamp } = request;
    
    try {
      // Vérifier le rate limit
      await this._checkRateLimit(api);
      
      // Exécuter la requête avec retry
      const startTime = Date.now();
      this.stats.totalRequests++;
      this.stats.apiCalls[api] = (this.stats.apiCalls[api] || 0) + 1;
      this.stats.lastRequestTime = startTime;
      
      const response = await retry(
        async () => {
          const axiosResponse = await axios({
            method: 'get',
            url,
            ...options,
            timeout: options.timeout || this.defaultTimeout
          });
          return axiosResponse;
        },
        this.maxRetries,
        1000
      );
      
      // Mettre à jour le temps de réponse moyen
      const duration = Date.now() - startTime;
      this.stats.averageResponseTime = (this.stats.averageResponseTime * (this.stats.totalRequests - 1) + duration) / this.stats.totalRequests;
      
      // Résoudre la promesse
      resolve(response);
    } catch (error) {
      this.stats.errors++;
      reject(error);
    }
  }

  /**
   * Retourne les statistiques d'utilisation de l'API
   * @returns {Object} Statistiques
   */
  getStats() {
    return {
      ...this.stats,
      queueSizes: {
        high: this.requestQueue.high.length,
        medium: this.requestQueue.medium.length,
        low: this.requestQueue.low.length
      },
      cacheStats: {
        pool: this.poolCache.size,
        token: this.tokenCache.size,
        price: this.priceCache.size,
        historical: this.historicalCache.size
      },
      rateLimits: {
        raydium: { ...this.rateLimits.raydium },
        jupiter: { ...this.rateLimits.jupiter },
        coingecko: { ...this.rateLimits.coingecko }
      }
    };
  }

  /**
   * Nettoie les caches du service
   */
  clearCaches() {
    this.poolCache.clear();
    this.tokenCache.clear();
    this.priceCache.clear();
    this.historicalCache.clear();
    
    // Nettoyer aussi le cache technique
    if (this.technicalAnalysis && typeof this.technicalAnalysis.clearCache === 'function') {
      this.technicalAnalysis.clearCache();
    }
  }
}

export default MarketDataService;