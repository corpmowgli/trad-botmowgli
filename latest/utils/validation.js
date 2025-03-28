// utils/validation.js

/**
 * Collection of validation functions for the trading bot
 */

/**
 * Validates if a value is a non-empty string
 * @param {any} value - The value to check
 * @returns {boolean} True if valid
 */
export const isValidString = (value) => {
    return typeof value === 'string' && value.trim().length > 0;
  };
  
  /**
   * Validates if a value is a number and within optional min/max bounds
   * @param {any} value - The value to check
   * @param {number} [min] - Minimum allowed value
   * @param {number} [max] - Maximum allowed value
   * @returns {boolean} True if valid
   */
  export const isValidNumber = (value, min = null, max = null) => {
    if (typeof value !== 'number' || isNaN(value)) {
      return false;
    }
    
    if (min !== null && value < min) {
      return false;
    }
    
    if (max !== null && value > max) {
      return false;
    }
    
    return true;
  };
  
  /**
   * Validates if a value is an array with optional length constraints
   * @param {any} value - The value to check
   * @param {number} [minLength] - Minimum array length
   * @param {number} [maxLength] - Maximum array length
   * @returns {boolean} True if valid
   */
  export const isValidArray = (value, minLength = 0, maxLength = null) => {
    if (!Array.isArray(value)) {
      return false;
    }
    
    if (value.length < minLength) {
      return false;
    }
    
    if (maxLength !== null && value.length > maxLength) {
      return false;
    }
    
    return true;
  };
  
  /**
   * Validates if a value is an object with required keys
   * @param {any} value - The value to check
   * @param {Array<string>} [requiredKeys] - Keys that must exist in the object
   * @returns {boolean} True if valid
   */
  export const isValidObject = (value, requiredKeys = []) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }
    
    if (requiredKeys.length > 0) {
      return requiredKeys.every(key => key in value);
    }
    
    return true;
  };
  
  /**
   * Validates a date string or timestamp
   * @param {string|number} value - The date to validate
   * @returns {boolean} True if valid
   */
  export const isValidDate = (value) => {
    if (!value) return false;
    
    const date = new Date(value);
    return !isNaN(date.getTime());
  };
  
  /**
   * Validates a token address/mint (basic validation)
   * @param {string} tokenMint - The token mint address
   * @returns {boolean} True if valid
   */
  export const isValidTokenMint = (tokenMint) => {
    // Basic validation for Solana token mint addresses
    return isValidString(tokenMint) && /^[A-Za-z0-9]{32,44}$/.test(tokenMint);
  };
  
  /**
   * Validates a trading strategy type
   * @param {string} strategyType - The strategy type
   * @returns {boolean} True if valid
   */
  export const isValidStrategyType = (strategyType) => {
    const validStrategies = [
      'MOMENTUM',
      'ENHANCED_MOMENTUM',
      'MEAN_REVERSION',
      'BREAKOUT',
      'TREND_FOLLOWING'
    ];
    
    return isValidString(strategyType) && validStrategies.includes(strategyType.toUpperCase());
  };
  
  /**
   * Validates market data for analysis
   * @param {Object} marketData - The market data to validate
   * @returns {boolean} True if valid
   */
  export const isValidMarketData = (marketData) => {
    if (!isValidObject(marketData)) {
      return false;
    }
    
    // Check required fields
    const requiredFields = ['price', 'volume24h', 'liquidity'];
    const hasRequiredFields = requiredFields.every(field => {
      return field in marketData && isValidNumber(marketData[field], 0);
    });
    
    return hasRequiredFields;
  };
  
  /**
   * Validates price and volume data for technical analysis
   * @param {Array<number>} prices - Price data points
   * @param {Array<number>} volumes - Volume data points
   * @param {number} [minDataPoints=10] - Minimum required data points
   * @returns {boolean} True if valid
   */
  export const isValidTechnicalData = (prices, volumes, minDataPoints = 10) => {
    if (!isValidArray(prices, minDataPoints) || !isValidArray(volumes)) {
      return false;
    }
    
    // Check that all price values are valid numbers
    const validPrices = prices.every(price => isValidNumber(price, 0));
    
    // Check that all volume values are valid numbers
    const validVolumes = volumes.every(volume => isValidNumber(volume, 0));
    
    // If volumes are provided, they should have the same length as prices
    const matchingLength = volumes.length === 0 || volumes.length === prices.length;
    
    return validPrices && validVolumes && matchingLength;
  };
  
  /**
   * Validates a trading configuration
   * @param {Object} config - The trading configuration
   * @returns {Object} Validation result {isValid, errors}
   */
  export const validateTradingConfig = (config) => {
    const errors = [];
    
    if (!isValidObject(config)) {
      return { isValid: false, errors: ['Configuration must be an object'] };
    }
    
    // Validate trading parameters
    if (!isValidObject(config.trading)) {
      errors.push('Missing trading configuration');
    } else {
      const trading = config.trading;
      
      if (!isValidNumber(trading.tradeSize, 0.1, 100)) {
        errors.push('Invalid trade size percentage (must be between 0.1 and 100)');
      }
      
      if (!isValidNumber(trading.stopLoss, 0.1, 50)) {
        errors.push('Invalid stop loss percentage (must be between 0.1 and 50)');
      }
      
      if (!isValidNumber(trading.takeProfit, 0.1, 1000)) {
        errors.push('Invalid take profit percentage (must be between 0.1 and 1000)');
      }
      
      if (!isValidNumber(trading.maxOpenPositions, 1, 100)) {
        errors.push('Invalid maximum open positions (must be between 1 and 100)');
      }
    }
    
    // Validate indicators
    if (!isValidObject(config.indicators)) {
      errors.push('Missing indicators configuration');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  };
  
  /**
   * Sanitizes input to prevent injection attacks
   * @param {string} input - The input to sanitize
   * @returns {string} Sanitized input
   */
  export const sanitizeInput = (input) => {
    if (typeof input !== 'string') return '';
    
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;');
  };
  
  /**
   * Deep validation of data structure
   * @param {Object} data - The data to validate
   * @param {Object} schema - Validation schema
   * @returns {Object} Validation result {isValid, errors}
   */
  export const validateDataStructure = (data, schema) => {
    const errors = [];
    
    for (const [key, validator] of Object.entries(schema)) {
      const value = data[key];
      
      if (!validator.validate(value)) {
        errors.push(`Invalid ${key}: ${validator.message}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  };
  
  // Schema builders
  export const validators = {
    required: (message = 'Field is required') => ({
      validate: value => value !== undefined && value !== null && value !== '',
      message
    }),
    
    string: (message = 'Must be a string') => ({
      validate: value => typeof value === 'string',
      message
    }),
    
    number: (min = null, max = null, message = 'Must be a valid number') => ({
      validate: value => isValidNumber(value, min, max),
      message: min !== null && max !== null 
        ? `Must be a number between ${min} and ${max}` 
        : message
    }),
    
    array: (minLength = 0, message = 'Must be an array') => ({
      validate: value => isValidArray(value, minLength),
      message: minLength > 0 ? `Must be an array with at least ${minLength} items` : message
    }),
    
    enum: (validValues, message = 'Invalid value') => ({
      validate: value => validValues.includes(value),
      message: `Must be one of: ${validValues.join(', ')}`
    })
  };
  
  // Export all validation functions
  export default {
    isValidString,
    isValidNumber,
    isValidArray,
    isValidObject,
    isValidDate,
    isValidTokenMint,
    isValidStrategyType,
    isValidMarketData,
    isValidTechnicalData,
    validateTradingConfig,
    sanitizeInput,
    validateDataStructure,
    validators
  };