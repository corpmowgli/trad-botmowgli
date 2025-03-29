// services/performanceMonitor.js
import os from 'os';
import EventEmitter from 'events';

/**
 * Performance Monitor Service
 * Tracks system and application performance metrics
 */
export class PerformanceMonitor extends EventEmitter {
  /**
   * Create a new PerformanceMonitor
   * @param {Object} [options={}] - Configuration options
   */
  constructor(options = {}) {
    super();
    
    this.options = {
      monitorInterval: options.monitorInterval || 60000, // 1 minute
      memoryThreshold: options.memoryThreshold || 90, // 90% memory usage threshold
      cpuThreshold: options.cpuThreshold || 80, // 80% CPU usage threshold
      logPerformance: options.logPerformance !== undefined ? options.logPerformance : true,
      maxDataPoints: options.maxDataPoints || 1440, // Store 24 hours at 1min interval
      ...options
    };
    
    // Performance history
    this.metrics = {
      memory: [],
      cpu: [],
      responseTime: [],
      throughput: [],
      errors: []
    };
    
    // Application performance metrics
    this.appMetrics = {
      requests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      peakResponseTime: 0,
      tradingCycles: 0,
      successfulTrades: 0,
      failedTrades: 0,
      lastRestart: Date.now(),
      uptime: 0
    };
    
    // Current status
    this.status = {
      memoryUsage: 0,
      cpuUsage: 0,
      avgResponseTime: 0,
      lastMeasurement: null,
      warning: false,
      warningReason: null
    };
    
    // Initialize monitoring
    this.interval = null;
    this.lastCpuUsage = null;
    this.lastCpuTime = Date.now();
  }
  
  /**
   * Start performance monitoring
   */
  start() {
    if (this.interval) {
      this.stop();
    }
    
    this.interval = setInterval(() => this.checkPerformance(), this.options.monitorInterval);
    this.emit('started', { timestamp: Date.now() });
    
    console.log('Performance monitoring started');
  }
  
  /**
   * Stop performance monitoring
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.emit('stopped', { timestamp: Date.now() });
      console.log('Performance monitoring stopped');
    }
  }
  
  /**
   * Check system performance metrics
   * @private
   */
  async checkPerformance() {
    // Calculate memory usage
    const memoryUsage = this.getMemoryUsage();
    
    // Calculate CPU usage
    const cpuUsage = await this.getCpuUsage();
    
    // Calculate average response time
    const avgResponseTime = this.getAverageResponseTime();
    
    // Create snapshot
    const snapshot = {
      timestamp: Date.now(),
      memory: memoryUsage,
      cpu: cpuUsage,
      responseTime: avgResponseTime,
      throughput: this.getThroughput(),
      pendingRequests: this.appMetrics.requests - 
                       (this.appMetrics.successfulRequests + this.appMetrics.failedRequests)
    };
    
    // Store metrics (limited history)
    this.addMetric('memory', { timestamp: snapshot.timestamp, value: memoryUsage });
    this.addMetric('cpu', { timestamp: snapshot.timestamp, value: cpuUsage });
    this.addMetric('responseTime', { timestamp: snapshot.timestamp, value: avgResponseTime });
    this.addMetric('throughput', { 
      timestamp: snapshot.timestamp, 
      value: snapshot.throughput 
    });
    
    // Update current status
    this.status.memoryUsage = memoryUsage;
    this.status.cpuUsage = cpuUsage;
    this.status.avgResponseTime = avgResponseTime;
    this.status.lastMeasurement = snapshot.timestamp;
    
    // Reset temporary metrics for next period
    this.appMetrics.requests = 0;
    this.appMetrics.successfulRequests = 0;
    this.appMetrics.failedRequests = 0;
    this.appMetrics.totalResponseTime = 0;
    
    // Check for warning conditions
    this.checkWarningConditions(snapshot);
    
    // Emit event with latest metrics
    this.emit('metrics', snapshot);
    
    // Log performance if enabled
    if (this.options.logPerformance) {
      console.log(`[Performance] Memory: ${memoryUsage.toFixed(2)}%, CPU: ${cpuUsage.toFixed(2)}%, Response: ${avgResponseTime.toFixed(2)}ms`);
    }
    
    return snapshot;
  }
  
  /**
   * Get memory usage percentage
   * @returns {number} Memory usage percentage
   * @private
   */
  getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    return (usedMem / totalMem) * 100;
  }
  
  /**
   * Get CPU usage percentage
   * @returns {Promise<number>} CPU usage percentage
   * @private
   */
  async getCpuUsage() {
    return new Promise((resolve) => {
      const cpus = os.cpus();
      
      if (!cpus || cpus.length === 0) {
        resolve(0);
        return;
      }
      
      // Calculate CPU times across all cores
      let totalIdle = 0;
      let totalTick = 0;
      
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      }
      
      if (this.lastCpuUsage === null) {
        // First call, no usage data yet
        this.lastCpuUsage = {
          idle: totalIdle,
          total: totalTick
        };
        resolve(0);
        return;
      }
      
      // Calculate difference
      const idleDiff = totalIdle - this.lastCpuUsage.idle;
      const totalDiff = totalTick - this.lastCpuUsage.total;
      
      // Store current value for next comparison
      this.lastCpuUsage = {
        idle: totalIdle,
        total: totalTick
      };
      
      // Calculate usage percentage
      const cpuUsage = 100 - ((idleDiff / totalDiff) * 100);
      
      resolve(cpuUsage);
    });
  }
  
  /**
   * Get average response time
   * @returns {number} Average response time in ms
   * @private
   */
  getAverageResponseTime() {
    if (this.appMetrics.successfulRequests === 0) {
      return 0;
    }
    
    return this.appMetrics.totalResponseTime / this.appMetrics.successfulRequests;
  }
  
  /**
   * Get throughput (requests per minute)
   * @returns {number} Requests per minute
   * @private
   */
  getThroughput() {
    const totalRequests = this.appMetrics.successfulRequests + this.appMetrics.failedRequests;
    const minuteRatio = this.options.monitorInterval / 60000;
    
    return totalRequests / minuteRatio;
  }
  
  /**
   * Check warning conditions based on thresholds
   * @param {Object} snapshot - Current performance snapshot
   * @private
   */
  checkWarningConditions(snapshot) {
    let warning = false;
    let warningReason = null;
    
    // Check memory threshold
    if (snapshot.memory > this.options.memoryThreshold) {
      warning = true;
      warningReason = `Memory usage too high: ${snapshot.memory.toFixed(2)}%`;
    }
    
    // Check CPU threshold
    if (snapshot.cpu > this.options.cpuThreshold) {
      warning = true;
      warningReason = warningReason ? `${warningReason}, ` : '';
      warningReason += `CPU usage too high: ${snapshot.cpu.toFixed(2)}%`;
    }
    
    // Check response time trend (increasing significantly)
    if (this.metrics.responseTime.length >= 5) {
      const recentTimes = this.metrics.responseTime.slice(-5).map(m => m.value);
      const avgRecent = recentTimes.reduce((sum, val) => sum + val, 0) / recentTimes.length;
      
      if (snapshot.responseTime > avgRecent * 1.5 && snapshot.responseTime > 500) {
        warning = true;
        warningReason = warningReason ? `${warningReason}, ` : '';
        warningReason += `Response time increasing: ${snapshot.responseTime.toFixed(2)}ms`;
      }
    }
    
    // Update status
    this.status.warning = warning;
    this.status.warningReason = warningReason;
    
    // Emit warning if conditions met
    if (warning) {
      this.emit('warning', {
        timestamp: snapshot.timestamp,
        reason: warningReason,
        metrics: snapshot
      });
      
      console.warn(`[Performance Warning] ${warningReason}`);
    }
  }
  
  /**
   * Add metric data point and maintain history limit
   * @param {string} metricType - Type of metric
   * @param {Object} dataPoint - Data point to add
   * @private
   */
  addMetric(metricType, dataPoint) {
    if (!this.metrics[metricType]) {
      this.metrics[metricType] = [];
    }
    
    this.metrics[metricType].push(dataPoint);
    
    // Limit history size
    if (this.metrics[metricType].length > this.options.maxDataPoints) {
      this.metrics[metricType] = this.metrics[metricType].slice(-this.options.maxDataPoints);
    }
  }
  
  /**
   * Track request start
   * @param {string} [requestId] - Optional request identifier
   * @returns {Object} Request tracking info
   */
  trackRequestStart(requestId = null) {
    const id = requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    this.appMetrics.requests++;
    
    return {
      id,
      startTime: Date.now()
    };
  }
  
  /**
   * Track request end
   * @param {Object} requestInfo - Request tracking info from trackRequestStart
   * @param {boolean} success - Whether the request was successful
   * @param {Object} [additionalInfo={}] - Additional info to track
   */
  trackRequestEnd(requestInfo, success, additionalInfo = {}) {
    if (!requestInfo || !requestInfo.startTime) {
      return;
    }
    
    const responseTime = Date.now() - requestInfo.startTime;
    
    if (success) {
      this.appMetrics.successfulRequests++;
      this.appMetrics.totalResponseTime += responseTime;
      
      if (responseTime > this.appMetrics.peakResponseTime) {
        this.appMetrics.peakResponseTime = responseTime;
      }
    } else {
      this.appMetrics.failedRequests++;
      
      // Track error
      this.addMetric('errors', {
        timestamp: Date.now(),
        requestId: requestInfo.id,
        responseTime,
        ...additionalInfo
      });
    }
  }
  
  /**
   * Track trading cycle execution
   * @param {boolean} success - Whether the cycle was successful
   * @param {number} duration - Duration in ms
   */
  trackTradingCycle(success, duration) {
    this.appMetrics.tradingCycles++;
    
    if (success) {
      this.appMetrics.successfulTrades++;
    } else {
      this.appMetrics.failedTrades++;
    }
  }
  
  /**
   * Get performance metrics history
   * @param {string} [metricType] - Type of metric to get (or all if not specified)
   * @param {number} [limit] - Number of data points to return
   * @returns {Object} Performance metrics
   */
  getMetrics(metricType, limit) {
    // If metric type specified, return just that type
    if (metricType && this.metrics[metricType]) {
      const metrics = this.metrics[metricType];
      return limit ? metrics.slice(-limit) : metrics;
    }
    
    // Otherwise return all metrics
    const result = {};
    
    for (const [type, data] of Object.entries(this.metrics)) {
      result[type] = limit ? data.slice(-limit) : data;
    }
    
    return result;
  }
  
  /**
   * Get current performance status
   * @returns {Object} Current status
   */
  getStatus() {
    return {
      ...this.status,
      uptime: this.getUptime(),
      appMetrics: { ...this.appMetrics }
    };
  }
  
  /**
   * Get system uptime in milliseconds
   * @returns {number} Uptime in milliseconds
   */
  getUptime() {
    return Date.now() - this.appMetrics.lastRestart;
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    this.stop();
  }
}

export default PerformanceMonitor;