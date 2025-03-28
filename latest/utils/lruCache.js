// utils/lruCache.js

/**
 * Implémentation optimisée d'un cache LRU (Least Recently Used)
 * Utilisée pour limiter la consommation mémoire en supprimant les éléments les moins récemment utilisés
 */
export class LRUCache {
    /**
     * Crée une nouvelle instance de cache LRU
     * @param {number} capacity - Capacité maximale du cache
     */
    constructor(capacity = 1000) {
      this.capacity = capacity;
      this.cache = new Map();
      
      // Compteur pour la taille du cache
      this.size = 0;
      
      // Statistiques d'utilisation
      this.stats = {
        hits: 0,
        misses: 0,
        evictions: 0
      };
    }
  
    /**
     * Récupère une valeur du cache
     * @param {string} key - Clé à récupérer
     * @returns {*} Valeur associée à la clé ou undefined si non trouvée
     */
    get(key) {
      if (!this.cache.has(key)) {
        this.stats.misses++;
        return undefined;
      }
      
      // Récupérer la valeur et la déplacer en fin de Map (élément le plus récent)
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      
      this.stats.hits++;
      return value;
    }
  
    /**
     * Stocke une valeur dans le cache
     * @param {string} key - Clé
     * @param {*} value - Valeur à stocker
     */
    set(key, value) {
      // Si la clé existe déjà, la supprimer d'abord
      if (this.cache.has(key)) {
        this.cache.delete(key);
      } else {
        this.size++;
      }
      
      // Ajouter la nouvelle paire clé-valeur
      this.cache.set(key, value);
      
      // Si la taille dépasse la capacité, supprimer l'élément le moins récemment utilisé
      if (this.size > this.capacity) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
        this.size--;
        this.stats.evictions++;
      }
    }
  
    /**
     * Vérifie si une clé existe dans le cache
     * @param {string} key - Clé à vérifier
     * @returns {boolean} Vrai si la clé existe
     */
    has(key) {
      return this.cache.has(key);
    }
  
    /**
     * Supprime une entrée du cache
     * @param {string} key - Clé à supprimer
     * @returns {boolean} Vrai si la clé a été supprimée
     */
    delete(key) {
      if (this.cache.has(key)) {
        this.cache.delete(key);
        this.size--;
        return true;
      }
      return false;
    }
  
    /**
     * Vide complètement le cache
     */
    clear() {
      this.cache.clear();
      this.size = 0;
    }
  
    /**
     * Récupère toutes les clés du cache
     * @returns {Array<string>} Tableau des clés
     */
    keys() {
      return [...this.cache.keys()];
    }
    
    /**
     * Récupère toutes les valeurs du cache
     * @returns {Array<*>} Tableau des valeurs
     */
    values() {
      return [...this.cache.values()];
    }
    
    /**
     * Récupère les statistiques d'utilisation du cache
     * @returns {Object} Statistiques
     */
    getStats() {
      const total = this.stats.hits + this.stats.misses;
      const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
      
      return {
        ...this.stats,
        size: this.size,
        capacity: this.capacity,
        hitRate: hitRate.toFixed(2) + '%'
      };
    }
    
    /**
     * Supprime les entrées les plus anciennes jusqu'à atteindre le pourcentage indiqué
     * @param {number} percentToKeep - Pourcentage des entrées les plus récentes à conserver (0-100)
     */
    trim(percentToKeep = 75) {
      if (percentToKeep >= 100 || this.size === 0) return;
      
      const keepCount = Math.max(1, Math.floor(this.size * percentToKeep / 100));
      const removeCount = this.size - keepCount;
      
      if (removeCount <= 0) return;
      
      // Supprimer les éléments les plus anciens
      const keys = this.cache.keys();
      for (let i = 0; i < removeCount; i++) {
        const key = keys.next().value;
        this.cache.delete(key);
        this.stats.evictions++;
      }
      
      this.size = this.cache.size;
    }
    
    /**
     * Récupère l'entrée la plus récemment utilisée
     * @returns {[string, *]|undefined} Paire [clé, valeur] ou undefined si le cache est vide
     */
    getMostRecent() {
      if (this.size === 0) return undefined;
      
      const lastKey = [...this.cache.keys()].pop();
      return [lastKey, this.cache.get(lastKey)];
    }
    
    /**
     * Récupère l'entrée la moins récemment utilisée
     * @returns {[string, *]|undefined} Paire [clé, valeur] ou undefined si le cache est vide
     */
    getLeastRecent() {
      if (this.size === 0) return undefined;
      
      const firstKey = this.cache.keys().next().value;
      return [firstKey, this.cache.get(firstKey)];
    }
  }
  
  export default LRUCache;