// services/marketDataService.js
import axios from 'axios';
import { delay, retry } from '../utils/helpers.js';

/**
 * Market Data Service
 * 
 * A service for fetching and managing market data from various sources.
 * Includes caching, rate limiting, and retry mechanisms for reliable data access.
 */
export class MarketDataService {
  /**
   * Create a new MarketDataService instance
   * @param {Object} config - Configuration for the service
   */
  constructor(config) {
    this.config = config;
    
    // Initialize caches with expiration times
    this.caches = {
      prices: new Map(),
      pools: new Map(),
      tokens: new Map(),
      coingecko: new Map(),
      marketData: new Map()
    };
    
    // Cache TTL in milliseconds
    this.cacheTTL = {
      prices: 30000,        // 30 seconds for price data
      pools: 300000,        // 5 minutes for pool data
      tokens: 300000,       // 5 minutes for token data
      coingecko: 300000,    // 5 minutes for CoinGecko data
      marketData: 300000    // 5 minutes for general market data
    };
    
    // Queue for rate limiting requests to each API
    this.requestQueues = {
      raydium: [],
      jupiter: [],
      coingecko: []
    };
    
    // Rate limits
    this.rateLimits = {
      raydium: { requests: 10, period: 60000 },     // 10 requests per minute
      jupiter: { requests: 30, period: 60000 },     // 30 requests per minute
      coingecko: { requests: 30, period: 60000 }    // 30 requests per minute for free tier
    };
    
    // Last request timestamps for rate limiting
    this.lastRequests = {
      raydium: [],
      jupiter: [],
      coingecko: []
    };
    
    // Initialize axios instances with default configs
    this.api = {
      raydium: axios.create({
        baseURL: this.config.api.raydiumBaseUrl,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      }),
      jupiter: axios.create({
        baseURL: this.config.api.jupiterBaseUrl,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      }),
      coingecko: axios.create({
        baseURL: this.config.api.coingeckoBaseUrl,
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json'
        }
      })
    };
    
    // Add response interceptors for error handling
    Object.values(this.api).forEach(instance => {
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
          
          // Handle other errors
          return Promise.reject(error);
        }
      );
    });
    
    // Start processing request queues
    this.startQueueProcessing();
  }

  /**
   * Get pool data from Raydium API
   * @param {string} poolId - Pool identifier
   * @returns {Promise<Object>} Pool data
   */
  async getPoolData(poolId) {
    // Check cache first
    const cachedData = this.getCachedData('pools', poolId);
    if (cachedData) return cachedData;
    
    // Queue the request with a promise for the result
    return new Promise((resolve, reject) => {
      this.queueRequest('raydium', async () => {
        try {
          const response = await retry(
            () => this.api.raydium.get(`/pools/${poolId}`),
            3,  // max retries
            1000 // base delay in ms
          );
          
          const data = response.data;
          
          // Cache the result
          this.setCacheData('pools', poolId, data);
          
          resolve(data);
        } catch (error) {
          console.error(`Error fetching pool data for ${poolId}:`, error);
          reject(error);
        }
      });
    });
  }

  /**
   * Get token price from Jupiter API
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<number|null>} Token price in USD or null if not available
   */
  async getTokenPrice(tokenMint) {
    try {
      // Check cache first
      const cachedPrice = this.getCachedData('prices', tokenMint);
      if (cachedPrice !== undefined) return cachedPrice;
      
      // Queue the request with a promise for the result
      return new Promise((resolve, reject) => {
        this.queueRequest('jupiter', async () => {
          try {
            const response = await retry(
              () => this.api.jupiter.get(`/price`, {
                params: { ids: [tokenMint] }
              }),
              3,  // max retries
              1000 // base delay
            );
            
            const price = response.data.data[tokenMint]?.price || null;
            
            // Cache the result
            this.setCacheData('prices', tokenMint, price);
            
            resolve(price);
          } catch (error) {
            console.error(`Error fetching price for ${tokenMint}:`, error);
            resolve(null); // Resolve with null instead of rejecting
          }
        });
      });
    } catch (error) {
      console.error(`Error in getTokenPrice for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Get multiple token prices in a single request
   * @param {Array<string>} tokenMints - Array of token mint addresses
   * @returns {Promise<Object>} Object mapping token addresses to prices
   */
  async getBatchTokenPrices(tokenMints) {
    if (!tokenMints || tokenMints.length === 0) {
      return {};
    }
    
    // Filter out tokens we already have in cache
    const uncachedTokens = tokenMints.filter(token => 
      this.getCachedData('prices', token) === undefined
    );
    
    // If all tokens are cached, return from cache
    if (uncachedTokens.length === 0) {
      return tokenMints.reduce((result, token) => {
        result[token] = this.getCachedData('prices', token);
        return result;
      }, {});
    }
    
    try {
      // Queue the request with a promise for the result
      return new Promise((resolve, reject) => {
        this.queueRequest('jupiter', async () => {
          try {
            // Jupiter API has a limit on request size, so batch if needed
            const batchSize = 100;
            const batches = [];
            
            for (let i = 0; i < uncachedTokens.length; i += batchSize) {
              batches.push(uncachedTokens.slice(i, i + batchSize));
            }
            
            // Process each batch
            const batchResults = await Promise.all(
              batches.map(async batch => {
                const response = await retry(
                  () => this.api.jupiter.get(`/price`, {
                    params: { ids: batch }
                  }),
                  3,  // max retries
                  1000 // base delay
                );
                
                return response.data.data || {};
              })
            );
            
            // Combine batch results
            const priceData = batchResults.reduce((result, batch) => ({ ...result, ...batch }), {});
            
            // Cache each price
            for (const [token, data] of Object.entries(priceData)) {
              this.setCacheData('prices', token, data.price || null);
            }
            
            // Combine with cached data for the final result
            const result = tokenMints.reduce((result, token) => {
              result[token] = priceData[token]?.price || this.getCachedData('prices', token) || null;
              return result;
            }, {});
            
            resolve(result);
          } catch (error) {
            console.error(`Error fetching batch token prices:`, error);
            
            // Fall back to individual price fetches
            const result = {};
            for (const token of tokenMints) {
              result[token] = await this.getTokenPrice(token);
            }
            
            resolve(result);
          }
        });
      });
    } catch (error) {
      console.error(`Error in getBatchTokenPrices:`, error);
      return {};
    }
  }

  /**
   * Aggregate comprehensive token data from multiple sources
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<Object>} Combined token data
   */
  async aggregateTokenData(tokenMint) {
    // Check cache first
    const cachedData = this.getCachedData('marketData', tokenMint);
    if (cachedData) return cachedData;
    
    try {
      // Fetch data from multiple sources in parallel
      const [raydiumData, coingeckoData, priceData] = await Promise.all([
        this.getRaydiumTokenData(tokenMint).catch(() => ({})),
        this.getCoingeckoTokenData(tokenMint).catch(() => ({})),
        this.getTokenPrice(tokenMint).catch(() => null)
      ]);
      
      // Combine the data, preferring Raydium for liquidity/volume and CoinGecko for market metrics
      const aggregatedData = {
        token: tokenMint,
        price: priceData || raydiumData.price || coingeckoData.usd || null,
        liquidity: raydiumData.liquidity || 0,
        volume24h: raydiumData.volume24h || 0,
        priceChange24h: coingeckoData.usd_24h_change || raydiumData.priceChange24h || 0,
        marketCap: coingeckoData.usd_market_cap || 0,
        fullyDilutedValuation: coingeckoData.fdv || 0,
        timestamp: Date.now(),
        sources: {
          price: priceData ? 'jupiter' : (raydiumData.price ? 'raydium' : 'coingecko'),
          marketData: Object.keys(coingeckoData).length > 0 ? 'coingecko' : 'raydium'
        }
      };
      
      // Cache the combined data
      this.setCacheData('marketData', tokenMint, aggregatedData);
      
      return aggregatedData;
    } catch (error) {
      console.error(`Error aggregating token data for ${tokenMint}:`, error);
      
      // Return a minimal data structure with defaults
      return {
        token: tokenMint,
        price: null,
        liquidity: 0,
        volume24h: 0,
        priceChange24h: 0,
        marketCap: 0,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Get token data from Raydium API
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<Object>} Token data from Raydium
   */
  async getRaydiumTokenData(tokenMint) {
    // Check cache first
    const cachedData = this.getCachedData('tokens', tokenMint);
    if (cachedData) return cachedData;
    
    // Queue the request with a promise for the result
    return new Promise((resolve, reject) => {
      this.queueRequest('raydium', async () => {
        try {
          const response = await retry(
            () => this.api.raydium.get(`/tokens/${tokenMint}`),
            3,  // max retries
            1000 // base delay
          );
          
          const data = response.data;
          
          // Cache the result
          this.setCacheData('tokens', tokenMint, data);
          
          resolve(data);
        } catch (error) {
          console.error(`Error fetching Raydium token data for ${tokenMint}:`, error);
          reject(error);
        }
      });
    });
  }

  /**
   * Get token data from CoinGecko API
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<Object>} Token data from CoinGecko
   */
  async getCoingeckoTokenData(tokenMint) {
    // Check cache first
    const cachedData = this.getCachedData('coingecko', tokenMint);
    if (cachedData) return cachedData;
    
    // Queue the request with a promise for the result
    return new Promise((resolve, reject) => {
      this.queueRequest('coingecko', async () => {
        try {
          const response = await retry(
            () => this.api.coingecko.get(`/simple/token_price/solana`, {
              params: {
                contract_addresses: tokenMint.toLowerCase(),
                vs_currencies: 'usd',
                include_market_cap: true,
                include_24hr_vol: true,
                include_24hr_change: true,
                include_last_updated_at: true
              }
            }),
            3,  // max retries
            1000 // base delay
          );
          
          const data = response.data[tokenMint.toLowerCase()] || {};
          
          // Cache the result
          this.setCacheData('coingecko', tokenMint, data);
          
          resolve(data);
        } catch (error) {
          console.error(`Error fetching CoinGecko token data for ${tokenMint}:`, error);
          reject(error);
        }
      });
    });
  }

  /**
   * Get historical price data for a token
   * @param {string} tokenMint - Token mint address
   * @param {string} timeframe - Timeframe ('1h', '4h', '1d', '1w')
   * @param {number} limit - Number of data points
   * @returns {Promise<Array>} Historical price data
   */
  async getHistoricalPrices(tokenMint, timeframe = '1h', limit = 100) {
    const cacheKey = `${tokenMint}_${timeframe}_${limit}`;
    
    // Check cache first
    const cachedData = this.getCachedData('prices', cacheKey);
    if (cachedData) return cachedData;
    
    // Queue the request with a promise for the result
    return new Promise((resolve, reject) => {
      this.queueRequest('raydium', async () => {
        try {
          const response = await retry(
            () => this.api.raydium.get(`/charts`, {
              params: {
                tokenMint,
                timeframe,
                limit
              }
            }),
            3,  // max retries
            1000 // base delay
          );
          
          const data = response.data || [];
          
          // Cache the result
          this.setCacheData('prices', cacheKey, data);
          
          resolve(data);
        } catch (error) {
          console.error(`Error fetching historical prices for ${tokenMint}:`, error);
          reject(error);
        }
      });
    });
  }

  /**
   * Get list of top tokens by volume
   * @param {number} limit - Number of tokens to return
   * @returns {Promise<Array>} Top tokens
   */
  async getTopTokens(limit = 50) {
    const cacheKey = `top_tokens_${limit}`;
    
    // Check cache first
    const cachedData = this.getCachedData('marketData', cacheKey);
    if (cachedData) return cachedData;
    
    // Queue the request with a promise for the result
    return new Promise((resolve, reject) => {
      this.queueRequest('raydium', async () => {
        try {
          const response = await retry(
            () => this.api.raydium.get(`/tokens`, {
              params: {
                limit,
                sortBy: 'volume24h',
                order: 'desc'
              }
            }),
            3,  // max retries
            1000 // base delay
          );
          
          const data = response.data || [];
          
          // Cache the result
          this.setCacheData('marketData', cacheKey, data);
          
          resolve(data);
        } catch (error) {
          console.error(`Error fetching top tokens:`, error);
          reject(error);
        }
      });
    });
  }

  /**
   * Get global market data
   * @returns {Promise<Object>} Global market data
   */
  async getGlobalMarketData() {
    const cacheKey = 'global_market';
    
    // Check cache first
    const cachedData = this.getCachedData('marketData', cacheKey);
    if (cachedData) return cachedData;
    
    // Queue the request with a promise for the result
    return new Promise((resolve, reject) => {
      this.queueRequest('coingecko', async () => {
        try {
          const response = await retry(
            () => this.api.coingecko.get(`/global`),
            3,  // max retries
            1000 // base delay
          );
          
          const data = response.data.data || {};
          
          // Cache the result
          this.setCacheData('marketData', cacheKey, data);
          
          resolve(data);
        } catch (error) {
          console.error(`Error fetching global market data:`, error);
          reject(error);
        }
      });
    });
  }

  /**
   * Check if the market is open (e.g., for stock/forex markets)
   * For crypto which trades 24/7, this always returns true
   * @returns {boolean} Whether the market is open
   */
  isMarketOpen() {
    // Cryptocurrency markets are always open
    return true;
  }

  /**
   * Get cached data if not expired
   * @private
   * @param {string} cacheType - Type of cache to check
   * @param {string} key - Cache key
   * @returns {*} Cached data or undefined if not found or expired
   */
  getCachedData(cacheType, key) {
    const cache = this.caches[cacheType];
    if (!cache) return undefined;
    
    const cacheEntry = cache.get(key);
    if (!cacheEntry) return undefined;
    
    // Check if cache has expired
    if (Date.now() - cacheEntry.timestamp > this.cacheTTL[cacheType]) {
      cache.delete(key);
      return undefined;
    }
    
    return cacheEntry.data;
  }

  /**
   * Set data in cache with current timestamp
   * @private
   * @param {string} cacheType - Type of cache to update
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   */
  setCacheData(cacheType, key, data) {
    const cache = this.caches[cacheType];
    if (!cache) return;
    
    cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Clean up old cache entries periodically
    if (cache.size > 1000) {
      this.cleanupCache(cacheType);
    }
  }

  /**
   * Clean up expired entries from a cache
   * @private
   * @param {string} cacheType - Type of cache to clean
   */
  cleanupCache(cacheType) {
    const cache = this.caches[cacheType];
    if (!cache) return;
    
    const now = Date.now();
    
    // Remove expired entries
    for (const [key, entry] of cache.entries()) {
      if (now - entry.timestamp > this.cacheTTL[cacheType]) {
        cache.delete(key);
      }
    }
  }

  /**
   * Add a request to the appropriate queue
   * @private
   * @param {string} api - API name ('raydium', 'jupiter', 'coingecko')
   * @param {Function} requestFn - Function to execute the request
   */
  queueRequest(api, requestFn) {
    this.requestQueues[api].push(requestFn);
  }

  /**
   * Start processing the request queues with rate limiting
   * @private
   */
  startQueueProcessing() {
    // Process each API queue independently
    for (const api of Object.keys(this.requestQueues)) {
      this.processQueue(api);
    }
  }

  /**
   * Process a single API's request queue with rate limiting
   * @private
   * @param {string} api - API name
   */
  async processQueue(api) {
    // Process queue continuously
    while (true) {
      // Check if the queue has pending requests
      if (this.requestQueues[api].length > 0) {
        // Check if we need to wait for rate limit
        const needToWait = this.checkRateLimit(api);
        
        if (needToWait) {
          // Wait for the next request slot
          await delay(needToWait);
        }
        
        // Process the next request
        const nextRequest = this.requestQueues[api].shift();
        if (nextRequest) {
          // Record the request timestamp
          this.lastRequests[api].push(Date.now());
          
          // Keep only the last N requests in the tracking array
          const limit = this.rateLimits[api].requests;
          if (this.lastRequests[api].length > limit) {
            this.lastRequests[api] = this.lastRequests[api].slice(-limit);
          }
          
          // Execute the request (but don't await it to allow parallel processing)
          nextRequest().catch(error => {
            console.error(`Error processing ${api} request:`, error);
          });
        }
      }
      
      // Slight delay before checking the queue again to avoid CPU spin
      await delay(50);
    }
  }

  /**
   * Check if we need to wait due to rate limiting
   * @private
   * @param {string} api - API name
   * @returns {number} Milliseconds to wait or 0 if no wait needed
   */
  checkRateLimit(api) {
    const { requests, period } = this.rateLimits[api];
    const recentRequests = this.lastRequests[api];
    
    // If we haven't made enough requests yet, no need to wait
    if (recentRequests.length < requests) {
      return 0;
    }
    
    // Get the oldest request in our tracking window
    const oldestRequest = recentRequests[0];
    const now = Date.now();
    
    // If the oldest request is outside the period, no need to wait
    if (now - oldestRequest >= period) {
      return 0;
    }
    
    // Calculate how long we need to wait
    return period - (now - oldestRequest);
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    for (const cache of Object.values(this.caches)) {
      cache.clear();
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    const stats = {};
    
    for (const [type, cache] of Object.entries(this.caches)) {
      stats[type] = {
        size: cache.size,
        ttl: this.cacheTTL[type] / 1000 // Convert to seconds
      };
    }
    
    return stats;
  }
}

export default MarketDataService;