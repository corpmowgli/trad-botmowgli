import axios from 'axios';
import { delay } from '../utils/helpers.js';

export class MarketDataService {
  constructor(config) {
    this.config = config;
    this.raydiumCache = new Map();
    this.coingeckoCache = new Map();
  }

  async getPoolData(poolId) {
    if (this.raydiumCache.has(poolId)) {
      const cached = this.raydiumCache.get(poolId);
      if (Date.now() - cached.timestamp < 300000) { // 5 minutes cache
        return cached.data;
      }
    }

    const response = await axios.get(`${this.config.api.raydiumBaseUrl}/pools/${poolId}`);
    const data = response.data;
    
    this.raydiumCache.set(poolId, {
      data,
      timestamp: Date.now()
    });

    return data;
  }

  async getTokenPrice(tokenMint) {
    try {
      const response = await axios.get(`${this.config.api.jupiterBaseUrl}/price`, {
        params: {
          ids: [tokenMint]
        }
      });

      return response.data.data[tokenMint]?.price || null;
    } catch (error) {
      console.error(`Error fetching price for ${tokenMint}:`, error);
      return null;
    }
  }

  async aggregateTokenData(tokenMint) {
    const [raydiumData, coingeckoData] = await Promise.all([
      this.getRaydiumTokenData(tokenMint),
      this.getCoingeckoTokenData(tokenMint)
    ]);

    return {
      price: raydiumData.price,
      liquidity: raydiumData.liquidity,
      volume24h: raydiumData.volume24h,
      priceChange24h: coingeckoData.priceChange24h,
      marketCap: coingeckoData.marketCap,
      fullyDilutedValuation: coingeckoData.fdv
    };
  }

  async getRaydiumTokenData(tokenMint) {
    const response = await axios.get(`${this.config.api.raydiumBaseUrl}/tokens/${tokenMint}`);
    return response.data;
  }

  async getCoingeckoTokenData(tokenMint) {
    if (this.coingeckoCache.has(tokenMint)) {
      const cached = this.coingeckoCache.get(tokenMint);
      if (Date.now() - cached.timestamp < 300000) {
        return cached.data;
      }
    }

    const response = await axios.get(`${this.config.api.coingeckoBaseUrl}/simple/token_price/solana`, {
      params: {
        contract_addresses: tokenMint,
        vs_currencies: 'usd',
        include_market_cap: true,
        include_24hr_vol: true,
        include_24hr_change: true,
        include_last_updated_at: true
      }
    });

    const data = response.data[tokenMint.toLowerCase()];
    this.coingeckoCache.set(tokenMint, {
      data,
      timestamp: Date.now()
    });

    return data;
  }
}
