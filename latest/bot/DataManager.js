// DataManager.js
import { retry } from '../utils/helpers.js';

/**
 * Gestionnaire de données responsable de la récupération, mise en cache
 * et préparation des données pour le trading bot
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
    
    // Caches de données
    this.priceCache = new Map();
    this.volumeCache = new Map();
    this.tokenDataCache = new Map();
    this.historicalDataCache = new Map();
    
    // Configuration de mise en cache
    this.cacheTTL = {
      prices: 60000,         // 1 minute
      volumes: 60000,        // 1 minute
      tokenData: 300000,     // 5 minutes
      historicalData: 600000 // 10 minutes
    };
    
    // Compteurs pour les statistiques
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      lastFetchTime: 0
    };
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
    this.stats.lastFetchTime = Date.now();
    
    try {
      // Utiliser retry pour la résilience
      const tokenData = await retry(
        () => this.marketData.aggregateTokenData(tokenMint),
        3,  // max retries
        1000  // delay in ms
      );
      
      // Mettre en cache les données
      this.setCachedData('tokenData', tokenMint, tokenData);
      
      return tokenData;
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
    this.stats.lastFetchTime = Date.now();
    
    try {
      const price = await retry(
        () => this.marketData.getTokenPrice(tokenMint),
        3,
        1000
      );
      
      // Mettre en cache le prix
      this.setCachedData('prices', tokenMint, price);
      
      return price;
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
    
    // Vérifier quels tokens sont en cache
    const cachedTokens = new Map();
    const tokensToFetch = [];
    
    for (const tokenMint of tokenMints) {
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
    
    this.stats.lastFetchTime = Date.now();
    
    try {
      const batchPrices = await retry(
        () => this.marketData.getBatchTokenPrices(tokensToFetch),
        3,
        1000
      );
      
      // Mettre en cache les nouveaux prix
      for (const [token, price] of Object.entries(batchPrices)) {
        this.setCachedData('prices', token, price);
        cachedTokens.set(token, price);
      }
      
      return cachedTokens;
    } catch (error) {
      this.stats.errors++;
      
      // En cas d'erreur, essayer de récupérer les prix individuellement
      for (const tokenMint of tokensToFetch) {
        try {
          const price = await this.getTokenPrice(tokenMint);
          cachedTokens.set(tokenMint, price);
        } catch (innerError) {
          // Ignorer les erreurs individuelles
          console.error(`Error fetching price for ${tokenMint}:`, innerError);
        }
      }
      
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
    this.stats.lastFetchTime = Date.now();
    
    try {
      const historicalData = await retry(
        () => this.marketData.getHistoricalPrices(
          tokenMint,
          startTime,
          endTime,
          interval
        ),
        3,
        1000
      );
      
      // Mettre en cache les données historiques
      this.setCachedData('historicalData', cacheKey, historicalData);
      
      return historicalData;
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
    this.stats.lastFetchTime = Date.now();
    
    try {
      // Dans la plupart des API, les données de volume sont retournées avec les données de prix
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
      // Récupérer les données du token
      const tokenData = await this.getTokenData(tokenMint);
      
      // Récupérer l'historique des prix
      const endTime = Date.now();
      const startTime = endTime - (7 * 24 * 60 * 60 * 1000); // 7 jours
      
      const historicalPrices = await this.getHistoricalPrices(
        tokenMint,
        startTime,
        endTime,
        '1h'
      );
      
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
      
      return {
        trend: marketTrend,
        topMovers: topTokens.slice(0, 5),
        topLosers: [...topTokens].sort((a, b) => a.priceChange24h - b.priceChange24h).slice(0, 5),
        totalVolume,
        timestamp: Date.now()
      };
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
    if (Date.now() - cachedItem.timestamp > this.cacheTTL[cacheType]) {
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
   */
  setCachedData(cacheType, key, data) {
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
        return;
    }
    
    cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Si le cache devient trop grand, supprimer les entrées les plus anciennes
    if (cache.size > 1000) {
      this.cleanCache(cache);
    }
  }

  /**
   * Nettoie un cache en supprimant les entrées les plus anciennes
   * @private
   * @param {Map} cache - Cache à nettoyer
   */
  cleanCache(cache) {
    // Trier les entrées par timestamp
    const entries = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    // Supprimer les 20% les plus anciens
    const toRemove = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      cache.delete(entries[i][0]);
    }
  }

  /**
   * Nettoie tous les caches
   */
  clearCaches() {
    this.priceCache.clear();
    this.volumeCache.clear();
    this.tokenDataCache.clear();
    this.historicalDataCache.clear();
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
        historicalData: this.historicalDataCache.size
      },
      cacheHitRate: cacheHitRate.toFixed(2) + '%'
    };
  }
}

export default DataManager;