// optimized marketDataService.js
import axios from 'axios';
import { delay, retry } from '../utils/helpers.js';

/**
 * Market Data Service
 * Optimized service for fetching and managing market data
 */
export class MarketDataService {
  /**
   * Create a new MarketDataService instance
   * @param {Object} config - Configuration for the service
   */
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.api = this.initializeApiInstances();
    
    // Rate limits tracking
    this.lastRequests = {
      raydium: [],
      jupiter: [],
      coingecko: []
    };
  }

  /**
   * Initialize API instances
   * @private
   * @returns {Object} API instances
   */
  initializeApiInstances() {
    const instances = {
      raydium: axios.create({
        baseURL: this.config.api.raydiumBaseUrl,
        timeout: 10000
      }),
      jupiter: axios.create({
        baseURL: this.config.api.jupiterBaseUrl,
        timeout: 10000
      }),
      coingecko: axios.create({
        baseURL: this.config.api.coingeckoBaseUrl,
        timeout: 15000
      })
    };
    
    // Add response interceptors for error handling
    Object.values(instances).forEach(instance => {
      instance.interceptors.response.use(
        response => response,
        async error => {
          // Handle rate limiting
          if (error.response && error.response.status === 429) {
            const retryAfter = error.response.headers['retry-after'] 
              ? parseInt(error.response.headers['retry-after']) * 1000 
              : 60000;
            
            console.warn(`Rate limited. Retrying after ${retryAfter/1000} seconds.`);
            await delay(retryAfter);
            return axios(error.config);
          }
          
          return Promise.reject(error);
        }
      );
    });
    
    return instances;
  }

  /**
   * Unified API request method with caching and rate limit handling
   * @private
   * @param {string} apiName - API name ('raydium', 'jupiter', 'coingecko')
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Request parameters
   * @param {string} cacheKey - Cache key
   * @param {number} cacheDuration - Cache duration in ms (default: 30s)
   * @returns {Promise<Object>} Response data
   */
  async apiRequest(apiName, endpoint, params, cacheKey, cacheDuration = 30000) {
    // Check cache
    const cachedData = this.getCachedItem(cacheKey);
    if (cachedData) return cachedData;
    
    // Handle rate limits
    const needToWait = this.checkRateLimit(apiName);
    if (needToWait > 0) {
      await delay(needToWait);
    }
    
    // Record request for rate limiting
    this.recordRequest(apiName);
    
    // Make request
    try {
      const response = await retry(
        () => this.api[apiName].get(endpoint, { params }),
        3,  // max retries
        1000 // base delay
      );
      
      const data = response.data;
      
      // Cache result
      this.setCacheItem(cacheKey, data, cacheDuration);
      
      return data;
    } catch (error) {
      console.error(`API request error (${apiName}/${endpoint}):`, error);
      throw error;
    }
  }

  /**
   * Get token price from Jupiter API
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<number|null>} Token price in USD or null if not available
   */
  async getTokenPrice(tokenMint) {
    return this.apiRequest(
      'jupiter',
      '/price',
      { ids: [tokenMint] },
      `price_${tokenMint}`
    ).then(data => data.data?.[tokenMint]?.price || null);
  }

  /**
   * Get multiple token prices in a batch
   * @param {Array<string>} tokenMints - Array of token mint addresses
   * @returns {Promise<Object>} Object mapping token addresses to prices
   */
  async getBatchTokenPrices(tokenMints) {
    if (!tokenMints || tokenMints.length === 0) {
      return {};
    }
    
    // Split into batches of 100 (Jupiter limit)
    const batchSize = 100;
    const batches = [];
    
    for (let i = 0; i < tokenMints.length; i += batchSize) {
      batches.push(tokenMints.slice(i, i + batchSize));
    }
    
    // Process batches in parallel
    const results = await Promise.all(
      batches.map(batch => 
        this.apiRequest(
          'jupiter',
          '/price',
          { ids: batch },
          `prices_batch_${batch.join('_').substring(0, 50)}`
        )
      )
    );
    
    // Combine results
    return results.reduce((combined, result) => {
      if (result.data) {
        Object.entries(result.data).forEach(([token, data]) => {
          combined[token] = data.price;
        });
      }
      return combined;
    }, {});
  }

  /**
   * Get historical price data
   * @param {string} tokenMint - Token mint address
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @param {string} timeframe - Timeframe ('1h', '4h', '1d')
   * @returns {Promise<Array>} Historical price data
   */
  async getHistoricalPrices(tokenMint, startTime, endTime, timeframe = '1h') {
    const cacheKey = `history_${tokenMint}_${timeframe}_${startTime}_${endTime}`;
    
    return this.apiRequest(
      'raydium',
      '/charts',
      { tokenMint, timeframe, startTime, endTime },
      cacheKey,
      300000 // Cache for 5 minutes
    );
  }

  /**
   * Get qualified tokens based on liquidity and volume
   * @param {number} minLiquidity - Minimum liquidity threshold
   * @param {number} minVolume24h - Minimum 24h volume threshold
   * @returns {Promise<Array>} Qualified tokens
   */
  async getQualifiedTokens(minLiquidity = 100000, minVolume24h = 50000) {
    const cacheKey = `qualified_tokens_${minLiquidity}_${minVolume24h}`;
    
    const tokens = await this.apiRequest(
      'raydium',
      '/tokens',
      { limit: 200, sortBy: 'volume24h', order: 'desc' },
      cacheKey,
      300000 // Cache for 5 minutes
    );
    
    // Filter based on criteria
    return tokens.filter(token => 
      token.liquidity >= minLiquidity && 
      token.volume24h >= minVolume24h
    );
  }

  /**
   * Aggregate token data from multiple sources
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<Object>} Aggregated token data
   */
  async aggregateTokenData(tokenMint) {
    const cacheKey = `aggregated_${tokenMint}`;
    const cached = this.getCachedItem(cacheKey);
    if (cached) return cached;
    
    try {
      // Get data from different sources in parallel
      const [price, tokenInfo] = await Promise.all([
        this.getTokenPrice(tokenMint).catch(() => null),
        this.apiRequest(
          'raydium',
          `/tokens/${tokenMint}`,
          {},
          `token_info_${tokenMint}`,
          300000 // 5 minutes
        ).catch(() => ({}))
      ]);
      
      // Combine data
      const aggregated = {
        token: tokenMint,
        price: price || tokenInfo.price || 0,
        liquidity: tokenInfo.liquidity || 0,
        volume24h: tokenInfo.volume24h || 0,
        priceChange24h: tokenInfo.priceChange24h || 0,
        marketCap: tokenInfo.marketCap || 0,
        timestamp: Date.now()
      };
      
      this.setCacheItem(cacheKey, aggregated, 60000); // 1 minute
      return aggregated;
    } catch (error) {
      console.error(`Error aggregating token data for ${tokenMint}:`, error);
      return {
        token: tokenMint,
        price: null,
        liquidity: 0,
        volume24h: 0,
        priceChange24h: 0,
        error: error.message
      };
    }
  }

  /**
   * Get cached item if not expired
   * @private
   * @param {string} key - Cache key
   * @returns {*} Cached data or undefined
   */
  getCachedItem(key) {
    const item = this.cache.get(key);
    if (!item) return undefined;
    
    if (Date.now() - item.timestamp > item.duration) {
      this.cache.delete(key);
      return undefined;
    }
    
    return item.data;
  }

  /**
   * Set item in cache
   * @private
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   * @param {number} duration - Cache duration in ms
   */
  setCacheItem(key, data, duration) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      duration
    });
    
    // Clean up cache if it gets too large
    if (this.cache.size > 1000) {
      this.cleanupCache();
    }
  }

  /**
   * Clean up expired cache entries
   * @private
   */
  cleanupCache() {
    const now = Date.now();
    
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.duration) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Record API request for rate limiting
   * @private
   * @param {string} api - API name
   */
  recordRequest(api) {
    if (!this.lastRequests[api]) return;
    
    this.lastRequests[api].push(Date.now());
    
    // Keep only recent requests
    this.lastRequests[api] = this.lastRequests[api].filter(
      time => Date.now() - time < 60000 // Last minute
    );
  }

  /**
   * Check if we need to wait due to rate limiting
   * @private
   * @param {string} api - API name
   * @returns {number} Milliseconds to wait or 0 if no wait needed
   */
  checkRateLimit(api) {
    if (!this.lastRequests[api]) return 0;
    
    // Define rate limits for each API
    const rateLimits = {
      raydium: { requests: 10, period: 60000 },     // 10 requests per minute
      jupiter: { requests: 30, period: 60000 },     // 30 requests per minute
      coingecko: { requests: 30, period: 60000 }    // 30 requests per minute
    };
    
    const { requests, period } = rateLimits[api] || { requests: 10, period: 60000 };
    const recentRequests = this.lastRequests[api].filter(
      time => Date.now() - time < period
    );
    
    // If we haven't made enough requests yet, no need to wait
    if (recentRequests.length < requests) return 0;
    
    // Calculate wait time until next request slot opens
    const oldestRequest = Math.min(...recentRequests);
    const waitTime = period - (Date.now() - oldestRequest);
    
    return Math.max(0, waitTime);
  }
  
  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }
  
  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      apis: {
        raydium: this.lastRequests.raydium.length,
        jupiter: this.lastRequests.jupiter.length,
        coingecko: this.lastRequests.coingecko.length
      }
    };
  }
}