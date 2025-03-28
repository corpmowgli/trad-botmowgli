// DataManager.js
import { retry } from '../utils/helpers.js';
import { LRUCache } from '../utils/lruCache.js';

/**
 * Gestionnaire de données responsable de la récupération, mise en cache
 * et préparation des données pour le trading bot
 * Optimisé pour les performances et la gestion de mémoire
 */
export class DataManager {
  /**
   * Crée une instance de DataManager
   * @param {Object} config - Configuration globale
   * @param {Object} marketData - Service de données de marché
   */
  constructor(config, marketData) {
    this.config = config;
    this.marketData = marketData;
    
    // Paramètres de cache configurables
    const cacheConfig = config.cache || {};
    const maxCacheSize = cacheConfig.maxSize || 1000;
    
    // Caches de données avec LRU pour une meilleure gestion mémoire
    this.priceCache = new LRUCache(maxCacheSize);
    this.volumeCache = new LRUCache(maxCacheSize);
    this.tokenDataCache = new LRUCache(maxCacheSize);
    this.historicalDataCache = new LRUCache(maxCacheSize / 2); // Données historiques plus volumineuses
    
    // Configuration de mise en cache
    this.cacheTTL = {
      prices: cacheConfig.priceTTL || 60000,         // 1 minute
      volumes: cacheConfig.volumeTTL || 60000,       // 1 minute
      tokenData: cacheConfig.tokenDataTTL || 300000, // 5 minutes
      historicalData: cacheConfig.historyTTL || 600000 // 10 minutes
    };
    
    // Compteurs pour les statistiques
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      lastFetchTime: 0,
      batchRequests: 0
    };
    
    // File d'attente pour les demandes en attente (pour déduplication)
    this.pendingRequests = new Map();
    
    // Initialiser la compression si disponible
    this.compressionEnabled = cacheConfig.enableCompression !== false;
  }

  /**
   * Récupère les données actuelles d'un token
   * @param {string} tokenMint - Adresse du token
   * @returns {Promise<Object>} Données du token
   */
  async getTokenData(tokenMint) {
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    this.stats.totalRequests++;
    
    // Vérifier le cache
    const cachedData = this.getCachedData('tokenData', tokenMint);
    if (cachedData) {
      this.stats.cacheHits++;
      return cachedData;
    }
    
    this.stats.cacheMisses++;
    
    // Vérifier s'il y a déjà une requête en cours pour ce token
    if (this.pendingRequests.has(`tokenData:${tokenMint}`)) {
      return this.pendingRequests.get(`tokenData:${tokenMint}`);
    }
    
    this.stats.lastFetchTime = Date.now();
    
    // Créer une promesse et l'ajouter aux requêtes en attente
    const requestPromise = retry(
      async () => {
        try {
          const tokenData = await this.marketData.aggregateTokenData(tokenMint);
          
          // Mettre en cache les données
          this.setCachedData('tokenData', tokenMint, tokenData);
          
          return tokenData;
        } finally {
          // Nettoyer la requête de la file d'attente une fois terminée
          this.pendingRequests.delete(`tokenData:${tokenMint}`);
        }
      },
      3,  // max retries
      1000  // delay in ms
    );
    
    // Stocker la promesse
    this.pendingRequests.set(`tokenData:${tokenMint}`, requestPromise);
    
    try {
      return await requestPromise;
    } catch (error) {
      this.stats.errors++;
      throw new Error(`Failed to fetch token data for ${tokenMint}: ${error.message}`);
    }
  }

  /**
   * Récupère le prix actuel d'un token
   * @param {string} tokenMint - Adresse du token
   * @returns {Promise<number>} Prix du token
   */
  async getTokenPrice(tokenMint) {
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    this.stats.totalRequests++;
    
    // Vérifier le cache
    const cachedPrice = this.getCachedData('prices', tokenMint);
    if (cachedPrice !== undefined) {
      this.stats.cacheHits++;
      return cachedPrice;
    }
    
    this.stats.cacheMisses++;
    
    // Vérifier s'il y a déjà une requête en cours pour ce token
    if (this.pendingRequests.has(`price:${tokenMint}`)) {
      return this.pendingRequests.get(`price:${tokenMint}`);
    }
    
    this.stats.lastFetchTime = Date.now();
    
    // Créer une promesse et l'ajouter aux requêtes en attente
    const requestPromise = retry(
      async () => {
        try {
          const price = await this.marketData.getTokenPrice(tokenMint);
          
          // Mettre en cache le prix
          this.setCachedData('prices', tokenMint, price);
          
          return price;
        } finally {
          // Nettoyer la requête de la file d'attente une fois terminée
          this.pendingRequests.delete(`price:${tokenMint}`);
        }
      },
      3,
      1000
    );
    
    // Stocker la promesse
    this.pendingRequests.set(`price:${tokenMint}`, requestPromise);
    
    try {
      return await requestPromise;
    } catch (error) {
      this.stats.errors++;
      throw new Error(`Failed to fetch price for ${tokenMint}: ${error.message}`);
    }
  }

  /**
   * Récupère plusieurs prix de tokens en une seule requête
   * @param {Array<string>} tokenMints - Liste d'adresses de tokens
   * @returns {Promise<Map>} Map des prix par token
   */
  async getBatchTokenPrices(tokenMints) {
    if (!tokenMints || !Array.isArray(tokenMints) || tokenMints.length === 0) {
      return new Map();
    }
    
    this.stats.totalRequests++;
    this.stats.batchRequests++;
    
    // Dédupliquer les tokens
    const uniqueTokens = [...new Set(tokenMints)];
    
    // Vérifier quels tokens sont en cache
    const cachedTokens = new Map();
    const tokensToFetch = [];
    
    for (const tokenMint of uniqueTokens) {
      const cachedPrice = this.getCachedData('prices', tokenMint);
      if (cachedPrice !== undefined) {
        cachedTokens.set(tokenMint, cachedPrice);
        this.stats.cacheHits++;
      } else {
        tokensToFetch.push(tokenMint);
        this.stats.cacheMisses++;
      }
    }
    
    // Si tous les tokens sont en cache, retourner les données du cache
    if (tokensToFetch.length === 0) {
      return cachedTokens;
    }
    
    // Clé de batch pour éviter les requêtes dupliquées
    const batchKey = `batch:${tokensToFetch.sort().join(',')}`;
    
    // Vérifier s'il y a déjà une requête en cours pour cette combinaison
    if (this.pendingRequests.has(batchKey)) {
      const pendingResult = await this.pendingRequests.get(batchKey);
      
      // Fusionner avec les résultats du cache
      for (const [token, price] of pendingResult.entries()) {
        cachedTokens.set(token, price);
      }
      
      return cachedTokens;
    }
    
    this.stats.lastFetchTime = Date.now();
    
    // Créer une promesse pour le lot
    const batchPromise = retry(
      async () => {
        try {
          const batchPricesObj = await this.marketData.getBatchTokenPrices(tokensToFetch);
          const batchPrices = new Map();
          
          // Convertir la réponse en Map et mettre en cache
          for (const [token, price] of Object.entries(batchPricesObj)) {
            if (price !== null && price !== undefined) {
              this.setCachedData('prices', token, price);
              batchPrices.set(token, price);
            }
          }
          
          return batchPrices;
        } finally {
          // Nettoyer la requête de batch une fois terminée
          this.pendingRequests.delete(batchKey);
        }
      },
      3,
      1000
    );
    
    this.pendingRequests.set(batchKey, batchPromise);
    
    try {
      const batchResults = await batchPromise;
      
      // Fusionner les résultats du batch avec le cache
      for (const [token, price] of batchResults.entries()) {
        cachedTokens.set(token, price);
      }
      
      // Récupérer les prix manquants individuellement
      const missingTokens = tokensToFetch.filter(token => !batchResults.has(token));
      
      if (missingTokens.length > 0) {
        await Promise.all(
          missingTokens.map(async (token) => {
            try {
              const price = await this.getTokenPrice(token);
              if (price !== null && price !== undefined) {
                cachedTokens.set(token, price);
              }
            } catch (error) {
              console.error(`Error fetching price for ${token}:`, error);
            }
          })
        );
      }
      
      return cachedTokens;
    } catch (error) {
      this.stats.errors++;
      
      // Essayer de récupérer les prix individuellement en cas d'échec batch
      await Promise.all(
        tokensToFetch.map(async (token) => {
          try {
            const price = await this.getTokenPrice(token);
            if (price !== null && price !== undefined) {
              cachedTokens.set(token, price);
            }
          } catch (innerError) {
            console.error(`Error fetching price for ${token}:`, innerError);
          }
        })
      );
      
      return cachedTokens;
    }
  }

  /**
   * Récupère les données historiques de prix pour un token
   * @param {string} tokenMint - Adresse du token
   * @param {number} startTime - Timestamp de début (ms)
   * @param {number} endTime - Timestamp de fin (ms)
   * @param {string} interval - Intervalle des données ('1h', '4h', '1d')
   * @returns {Promise<Array>} Historique des prix
   */
  async getHistoricalPrices(tokenMint, startTime, endTime, interval = '1h') {
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    const cacheKey = `${tokenMint}-${startTime}-${endTime}-${interval}`;
    this.stats.totalRequests++;
    
    // Vérifier le cache
    const cachedData = this.getCachedData('historicalData', cacheKey);
    if (cachedData) {
      this.stats.cacheHits++;
      return cachedData;
    }
    
    this.stats.cacheMisses++;
    
    // Vérifier s'il y a déjà une requête en cours pour ces données
    if (this.pendingRequests.has(`history:${cacheKey}`)) {
      return this.pendingRequests.get(`history:${cacheKey}`);
    }
    
    this.stats.lastFetchTime = Date.now();
    
    // Créer une promesse et l'ajouter aux requêtes en attente
    const requestPromise = retry(
      async () => {
        try {
          const historicalData = await this.marketData.getHistoricalPrices(
            tokenMint,
            startTime,
            endTime,
            interval
          );
          
          // Compresser et mettre en cache les données historiques
          this.setCachedData('historicalData', cacheKey, historicalData);
          
          return historicalData;
        } finally {
          // Nettoyer la requête de la file d'attente une fois terminée
          this.pendingRequests.delete(`history:${cacheKey}`);
        }
      },
      3,
      1000
    );
    
    // Stocker la promesse
    this.pendingRequests.set(`history:${cacheKey}`, requestPromise);
    
    try {
      return await requestPromise;
    } catch (error) {
      this.stats.errors++;
      throw new Error(`Failed to fetch historical prices for ${tokenMint}: ${error.message}`);
    }
  }

  /**
   * Récupère les données historiques de volume pour un token
   * @param {string} tokenMint - Adresse du token
   * @param {number} startTime - Timestamp de début (ms)
   * @param {number} endTime - Timestamp de fin (ms)
   * @param {string} interval - Intervalle des données ('1h', '4h', '1d')
   * @returns {Promise<Array>} Historique des volumes
   */
  async getHistoricalVolumes(tokenMint, startTime, endTime, interval = '1h') {
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    const cacheKey = `${tokenMint}-${startTime}-${endTime}-${interval}`;
    this.stats.totalRequests++;
    
    // Vérifier le cache
    const cachedData = this.getCachedData('volumes', cacheKey);
    if (cachedData) {
      this.stats.cacheHits++;
      return cachedData;
    }
    
    this.stats.cacheMisses++;
    
    // Vérifier s'il y a déjà une requête en cours pour ces données
    if (this.pendingRequests.has(`volume:${cacheKey}`)) {
      return this.pendingRequests.get(`volume:${cacheKey}`);
    }
    
    this.stats.lastFetchTime = Date.now();
    
    // Créer une promesse et l'ajouter aux requêtes en attente
    const requestPromise = retry(
      async () => {
        try {
          // Dans la plupart des API, les données de volume sont retournées avec les prix
          const historicalData = await this.getHistoricalPrices(
            tokenMint,
            startTime,
            endTime,
            interval
          );
          
          // Extraire les volumes des données historiques
          const volumeData = historicalData.map(data => ({
            timestamp: data.timestamp,
            volume: data.volume || 0
          }));
          
          // Mettre en cache les données de volume
          this.setCachedData('volumes', cacheKey, volumeData);
          
          return volumeData;
        } finally {
          // Nettoyer la requête de la file d'attente une fois terminée
          this.pendingRequests.delete(`volume:${cacheKey}`);
        }
      },
      3,
      1000
    );
    
    // Stocker la promesse
    this.pendingRequests.set(`volume:${cacheKey}`, requestPromise);
    
    try {
      return await requestPromise;
    } catch (error) {
      this.stats.errors++;
      throw new Error(`Failed to fetch historical volumes for ${tokenMint}: ${error.message}`);
    }
  }

  /**
   * Récupère et prépare toutes les données nécessaires pour l'analyse d'un token
   * @param {string} tokenMint - Adresse du token
   * @returns {Promise<Object>} Données complètes pour analyse
   */
  async prepareTokenAnalysisData(tokenMint) {
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    try {
      // Récupérer en parallèle les données du token et l'historique
      const endTime = Date.now();
      const startTime = endTime - (7 * 24 * 60 * 60 * 1000); // 7 jours
      
      const [tokenData, historicalPrices] = await Promise.all([
        this.getTokenData(tokenMint),
        this.getHistoricalPrices(tokenMint, startTime, endTime, '1h')
      ]);
      
      // Extraire les séries de prix et volumes pour l'analyse
      const prices = historicalPrices.map(data => data.price);
      const volumes = historicalPrices.map(data => data.volume || 0);
      
      return {
        token: tokenMint,
        currentPrice: tokenData.price,
        currentVolume: tokenData.volume24h,
        liquidity: tokenData.liquidity,
        marketCap: tokenData.marketCap,
        priceChange24h: tokenData.priceChange24h,
        prices,
        volumes,
        timestamp: Date.now()
      };
    } catch (error) {
      throw new Error(`Failed to prepare analysis data for ${tokenMint}: ${error.message}`);
    }
  }

  /**
   * Recherche les tendances actuelles du marché
   * @returns {Promise<Object>} Données de tendance du marché
   */
  async getMarketTrends() {
    const cacheKey = 'market_trends';
    
    // Vérifier le cache avec TTL court (1 minute)
    const cachedTrends = this.getCachedData('tokenData', cacheKey);
    if (cachedTrends) {
      return cachedTrends;
    }
    
    try {
      // Récupérer les tokens les plus performants
      const topTokens = await retry(
        () => this.marketData.getTopTokens(20),
        3,
        1000
      );
      
      // Calculer des métriques globales
      let totalVolume = 0;
      let positiveCount = 0;
      let negativeCount = 0;
      
      for (const token of topTokens) {
        totalVolume += token.volume24h || 0;
        
        if (token.priceChange24h > 0) {
          positiveCount++;
        } else if (token.priceChange24h < 0) {
          negativeCount++;
        }
      }
      
      // Déterminer la tendance générale du marché
      let marketTrend = 'NEUTRAL';
      if (positiveCount > topTokens.length * 0.7) {
        marketTrend = 'BULLISH';
      } else if (negativeCount > topTokens.length * 0.7) {
        marketTrend = 'BEARISH';
      }
      
      const result = {
        trend: marketTrend,
        topMovers: topTokens.slice(0, 5),
        topLosers: [...topTokens].sort((a, b) => a.priceChange24h - b.priceChange24h).slice(0, 5),
        totalVolume,
        timestamp: Date.now()
      };
      
      // Mettre en cache avec TTL de 1 minute
      this.setCachedData('tokenData', cacheKey, result, 60000);
      
      return result;
    } catch (error) {
      throw new Error(`Failed to get market trends: ${error.message}`);
    }
  }

  /**
   * Récupère des données depuis le cache
   * @private
   * @param {string} cacheType - Type de cache
   * @param {string} key - Clé de cache
   * @returns {*} Données du cache ou undefined si non trouvé/expiré
   */
  getCachedData(cacheType, key) {
    let cache;
    
    switch (cacheType) {
      case 'prices':
        cache = this.priceCache;
        break;
      case 'volumes':
        cache = this.volumeCache;
        break;
      case 'tokenData':
        cache = this.tokenDataCache;
        break;
      case 'historicalData':
        cache = this.historicalDataCache;
        break;
      default:
        return undefined;
    }
    
    const cachedItem = cache.get(key);
    if (!cachedItem) return undefined;
    
    // Vérifier si le cache est expiré
    if (Date.now() - cachedItem.timestamp > cachedItem.ttl) {
      cache.delete(key);
      return undefined;
    }
    
    return cachedItem.data;
  }

  /**
   * Stocke des données dans le cache
   * @private
   * @param {string} cacheType - Type de cache
   * @param {string} key - Clé de cache
   * @param {*} data - Données à mettre en cache
   * @param {number} [customTTL] - TTL personnalisé (facultatif)
   */
  setCachedData(cacheType, key, data, customTTL) {
    let cache;
    let ttl = customTTL;
    
    switch (cacheType) {
      case 'prices':
        cache = this.priceCache;
        ttl = ttl || this.cacheTTL.prices;
        break;
      case 'volumes':
        cache = this.volumeCache;
        ttl = ttl || this.cacheTTL.volumes;
        break;
      case 'tokenData':
        cache = this.tokenDataCache;
        ttl = ttl || this.cacheTTL.tokenData;
        break;
      case 'historicalData':
        cache = this.historicalDataCache;
        ttl = ttl || this.cacheTTL.historicalData;
        break;
      default:
        return;
    }
    
    // Stocker les données avec timestamp et TTL
    cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * Nettoie tous les caches
   */
  clearCaches() {
    this.priceCache.clear();
    this.volumeCache.clear();
    this.tokenDataCache.clear();
    this.historicalDataCache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Précharge les données pour un ensemble de tokens
   * @param {Array<string>} tokenMints - Liste d'adresses de tokens
   * @returns {Promise<void>}
   */
  async preloadData(tokenMints) {
    if (!tokenMints || !Array.isArray(tokenMints) || tokenMints.length === 0) {
      return;
    }
    
    try {
      // Précharger les prix actuels
      await this.getBatchTokenPrices(tokenMints);
      
      // Ne pas bloquer sur le préchargement des données de token
      tokenMints.forEach(token => {
        this.getTokenData(token).catch(() => {
          // Ignorer les erreurs pendant le préchargement
        });
      });
    } catch (error) {
      console.error('Error preloading data:', error);
      // Ne pas échouer le préchargement si des erreurs surviennent
    }
  }

  /**
   * Récupère les statistiques du gestionnaire de données
   * @returns {Object} Statistiques d'utilisation
   */
  getStats() {
    const totalRequests = this.stats.cacheHits + this.stats.cacheMisses;
    const cacheHitRate = totalRequests > 0 ? (this.stats.cacheHits / totalRequests) * 100 : 0;
    
    return {
      ...this.stats,
      cacheStats: {
        prices: this.priceCache.size,
        volumes: this.volumeCache.size,
        tokenData: this.tokenDataCache.size,
        historicalData: this.historicalDataCache.size,
        pendingRequests: this.pendingRequests.size
      },
      cacheHitRate: cacheHitRate.toFixed(2) + '%',
      memoryUsage: process.memoryUsage().heapUsed
    };
  }
}

export default DataManager;