// Streamlined helpers.js

/**
 * Introduces a delay in execution
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} Promise that resolves after the delay
 */
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Formats a value as currency
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code (default: 'USD')
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount, currency = 'USD') => {
  if (amount == null) return 'N/A';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

/**
 * Formats a value as percentage
 * @param {number} value - Percentage value to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted percentage string
 */
export const formatPercentage = (value, decimals = 2) => {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value / 100);
};

/**
 * Generates a UUID v4
 * @returns {string} UUID string
 */
export const generateUUID = () => 
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {Function} onRetry - Callback for retry attempts
 * @returns {Promise<any>} Result of the function
 */
export const retry = async (fn, maxRetries = 3, baseDelay = 1000, onRetry = null) => {
  let retries = 0;
  
  const execute = async () => {
    try {
      return await fn();
    } catch (error) {
      if (retries >= maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, retries);
      retries++;
      
      if (typeof onRetry === 'function') {
        onRetry(retries, delay, error);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return execute();
    }
  };
  
  return execute();
};

/**
 * Format a timestamp
 * @param {number|string|Date} timestamp - Timestamp to format
 * @param {boolean} includeTime - Whether to include time
 * @returns {string} Formatted date string
 */
export const formatTimestamp = (timestamp, includeTime = true) => {
  if (!timestamp) return 'N/A';
  
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Invalid date';
  
  const options = includeTime 
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  
  return date.toLocaleDateString('fr-FR', options);
};

/**
 * Calculate maximum drawdown
 * @param {Array<number>} data - Array of data points
 * @returns {number} Maximum drawdown as a percentage
 */
export const calculateMaxDrawdown = (data) => {
  if (!Array.isArray(data) || data.length < 2) return 0;
  
  let maxSoFar = data[0];
  let maxDrawdown = 0;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i] > maxSoFar) {
      maxSoFar = data[i];
    } else {
      const drawdown = (maxSoFar - data[i]) / maxSoFar * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
  }
  
  return maxDrawdown;
};

/**
 * Calculate days between two dates
 * @param {Date|string} date1 - First date
 * @param {Date|string} date2 - Second date
 * @returns {number} Number of days between dates
 */
export const daysBetween = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
  
  // Normalize the dates to ignore time
  const normalized1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const normalized2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  
  // Calculate the difference in days
  const diffTime = Math.abs(normalized2 - normalized1);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};