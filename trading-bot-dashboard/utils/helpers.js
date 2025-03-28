// utils/helpers.js
/**
 * Collection de fonctions utilitaires pour le trading bot
 */

/**
 * Introduit un délai dans le flux d'exécution
 * @param {number} ms - Nombre de millisecondes de délai
 * @returns {Promise} Une promesse qui se résout après le délai spécifié
 */
export const delay = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Formate un nombre en devise
 * @param {number} amount - Le montant à formater
 * @param {string} currency - Le code de devise (par défaut: 'USD')
 * @returns {string} Chaîne formatée en devise
 */
export const formatCurrency = (amount, currency = 'USD') => {
  if (amount === undefined || amount === null) return 'N/A';
  
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

/**
 * Formate une valeur en pourcentage
 * @param {number} value - La valeur en pourcentage à formater
 * @param {number} decimals - Nombre de décimales (par défaut: 2)
 * @returns {string} Chaîne formatée en pourcentage
 */
export const formatPercentage = (value, decimals = 2) => {
  if (value === undefined || value === null) return 'N/A';
  
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value / 100);
};

/**
 * Tronque une chaîne au milieu et ajoute des points de suspension
 * @param {string} str - La chaîne à tronquer
 * @param {number} startChars - Nombre de caractères à conserver au début
 * @param {number} endChars - Nombre de caractères à conserver à la fin
 * @returns {string} Chaîne tronquée
 */
export const truncateMiddle = (str, startChars = 6, endChars = 4) => {
  if (!str) return '';
  if (str.length <= startChars + endChars) {
    return str;
  }
  return `${str.substring(0, startChars)}...${str.substring(str.length - endChars)}`;
};

/**
 * Limite la fréquence d'appel d'une fonction (debounce)
 * @param {Function} func - La fonction à limiter
 * @param {number} wait - Temps d'attente en millisecondes
 * @returns {Function} Fonction limitée
 */
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Limite la fréquence d'appel d'une fonction (throttle)
 * @param {Function} func - La fonction à limiter
 * @param {number} limit - Limite en millisecondes
 * @returns {Function} Fonction limitée
 */
export const throttle = (func, limit) => {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Crée un clone profond d'un objet
 * @param {Object} obj - L'objet à cloner
 * @returns {Object} Objet cloné
 */
export const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (error) {
    console.error('Error in deepClone:', error);
    
    // Fallback manuel pour les objets complexes
    if (Array.isArray(obj)) {
      return obj.map(item => deepClone(item));
    }
    
    const cloneObj = {};
    Object.keys(obj).forEach(key => {
      cloneObj[key] = deepClone(obj[key]);
    });
    
    return cloneObj;
  }
};

/**
 * Calcule la différence de temps entre deux timestamps
 * @param {number} start - Timestamp de début
 * @param {number} end - Timestamp de fin
 * @returns {Object} Objet contenant jours, heures, minutes, secondes
 */
export const getTimeDifference = (start, end) => {
  if (!start || !end) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  
  const diff = Math.abs(end - start);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((diff % (60 * 1000)) / 1000);
  
  return { days, hours, minutes, seconds };
};

/**
 * Formate une différence de temps en texte lisible
 * @param {Object} timeDiff - Objet de différence de temps
 * @returns {string} Représentation textuelle de la durée
 */
export const formatTimeDifference = (timeDiff) => {
  if (!timeDiff) {
    return 'N/A';
  }
  
  const { days, hours, minutes } = timeDiff;
  
  if (days > 0) {
    return `${days}j ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
};

/**
 * Vérifie si une valeur est dans une plage spécifiée
 * @param {number} value - La valeur à vérifier
 * @param {number} min - Valeur minimum
 * @param {number} max - Valeur maximum
 * @returns {boolean} Vrai si dans la plage
 */
export const isInRange = (value, min, max) => {
  if (value === undefined || value === null || isNaN(value)) {
    return false;
  }
  return value >= min && value <= max;
};

/**
 * Fonction de nouvelle tentative avec backoff exponentiel
 * @param {Function} fn - Fonction à exécuter
 * @param {number} maxRetries - Nombre maximum de tentatives
 * @param {number} baseDelay - Délai de base en millisecondes
 * @param {Function} onRetry - Callback appelé à chaque nouvelle tentative
 * @returns {Promise} Résultat de l'exécution de la fonction
 */
export const retry = async (fn, maxRetries = 3, baseDelay = 1000, onRetry = null) => {
  let retries = 0;
  let lastError;
  
  const execute = async () => {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
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
 * Formate une date en chaîne ISO avec seulement la date (YYYY-MM-DD)
 * @param {Date} date - L'objet Date à formater
 * @returns {string} Chaîne au format YYYY-MM-DD
 */
export const formatDateISOString = (date) => {
  if (!date) return '';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  return d.toISOString().split('T')[0];
};

/**
 * Calcule la différence en jours entre deux dates
 * @param {Date|string} date1 - Première date
 * @param {Date|string} date2 - Deuxième date
 * @returns {number} Nombre de jours entre les deux dates
 */
export const daysBetween = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
    return 0;
  }
  
  // Normaliser les dates pour ignorer les heures
  const normalized1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const normalized2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  
  // Calculer la différence en millisecondes et convertir en jours
  const diffTime = Math.abs(normalized2 - normalized1);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
};

/**
 * Formate un timestamp en date et heure locales
 * @param {number} timestamp - Le timestamp à formater
 * @param {boolean} includeTime - Inclure l'heure dans le format
 * @returns {string} Date formatée
 */
export const formatTimestamp = (timestamp, includeTime = true) => {
  if (!timestamp) return 'N/A';
  
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Date invalide';
  
  const options = includeTime 
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  
  return date.toLocaleDateString('fr-FR', options);
};

/**
 * Génère un UUID v4
 * @returns {string} UUID généré
 */
export const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * Extraire le nom du jeton à partir de l'adresse du contrat
 * @param {string} address - Adresse du contrat du jeton
 * @returns {string} Nom court du jeton
 */
export const formatTokenName = (address) => {
  if (!address) return 'Unknown';
  
  // Récupérer les 4 premiers et les 4 derniers caractères
  return truncateMiddle(address, 4, 4);
};

/**
 * Gestion sécurisée des erreurs JSON.parse
 * @param {string} jsonString - Chaîne JSON à analyser
 * @param {any} defaultValue - Valeur par défaut en cas d'erreur
 * @returns {any} Objet JSON analysé ou valeur par défaut
 */
export const safeJsonParse = (jsonString, defaultValue = {}) => {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return defaultValue;
  }
};

/**
 * Détermine si une date est aujourd'hui
 * @param {Date|string|number} date - La date à vérifier
 * @returns {boolean} Vrai si la date est aujourd'hui
 */
export const isToday = (date) => {
  const today = new Date();
  const compareDate = new Date(date);
  
  return compareDate.getDate() === today.getDate() &&
         compareDate.getMonth() === today.getMonth() &&
         compareDate.getFullYear() === today.getFullYear();
};

/**
 * Calcule le drawdown basé sur les données historiques
 * @param {Array<number>} data - Série de données
 * @returns {number} Drawdown maximum en pourcentage
 */
export const calculateMaxDrawdown = (data) => {
  if (!Array.isArray(data) || data.length < 2) {
    return 0;
  }
  
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