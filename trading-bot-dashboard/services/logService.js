// Optimized logService.js
import fs from 'fs';
import path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { stringify } from 'csv-stringify';

// For path resolution with ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pipelineAsync = promisify(pipeline);

class LogService {
  constructor(config) {
    this.config = config;
    this.logsDir = path.join(__dirname, '..', config.logging?.filePath || 'logs/trades');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Unified method for streaming logs
   * @param {Object} res - Response object
   * @param {string} format - Output format
   * @param {Object} options - Stream options
   * @returns {Promise<boolean>} Success status
   */
  async streamLogs(res, format = 'json', options = {}) {
    const { 
      startDate, 
      endDate, 
      page = 1, 
      limit = 1000,
      compress = false
    } = options;
    
    try {
      // Determine filename and content type
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `trading_logs_${timestamp}.${format}${compress ? '.gz' : ''}`;
      const contentType = format === 'json' ? 'application/json' : 'text/csv';
      
      // Set headers
      res.setHeader('Content-Type', compress ? `${contentType}+gzip` : contentType);
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      
      // Get filtered logs
      const logs = await this.getFilteredLogs(startDate, endDate, page, limit);
      
      // Create appropriate data stream
      const dataStream = format === 'json' 
        ? this.createJsonStream(logs) 
        : this.createCsvStream(logs);
      
      // Handle compression if requested
      if (compress) {
        const gzip = createGzip();
        await pipelineAsync(dataStream, gzip, res);
      } else {
        await pipelineAsync(dataStream, res);
      }
      
      return true;
    } catch (error) {
      console.error('Error streaming logs:', error);
      throw error;
    }
  }
  
  /**
   * Get logs filtered by date and paginated
   * @private
   */
  async getFilteredLogs(startDate, endDate, page, limit) {
    try {
      // Get all logs
      const allLogs = await this.getAllLogs();
      
      // Apply date filtering if specified
      let filteredLogs = allLogs;
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate) : new Date(0);
        const end = endDate ? new Date(endDate) : new Date();
        
        filteredLogs = allLogs.filter(log => {
          const logDate = new Date(log.timestamp);
          return logDate >= start && logDate <= end;
        });
      }
      
      // Apply pagination
      const startIndex = (page - 1) * limit;
      return filteredLogs.slice(startIndex, startIndex + limit);
    } catch (error) {
      console.error('Error filtering logs:', error);
      return [];
    }
  }
  
  /**
   * Create a JSON stream from logs
   * @private
   */
  createJsonStream(data) {
    return new Readable({
      read() {
        this.push(JSON.stringify(data, null, 2));
        this.push(null);
      }
    });
  }
  
  /**
   * Create a CSV stream from logs
   * @private
   */
  createCsvStream(data) {
    if (!data || data.length === 0) {
      // Empty data - create stream with headers only
      const columns = ['timestamp', 'token', 'entryPrice', 'exitPrice', 'amount', 'profit'];
      const stringifier = stringify({ header: true, columns });
      const inputStream = new Readable({
        objectMode: true,
        read() { this.push(null); }
      });
      return inputStream.pipe(stringifier);
    }
    
    // Normal case with data
    const stringifier = stringify({
      header: true,
      columns: Object.keys(data[0])
    });
    
    const inputStream = new Readable({
      objectMode: true,
      read() {
        data.forEach(item => this.push(item));
        this.push(null);
      }
    });
    
    return inputStream.pipe(stringifier);
  }
  
  /**
   * Get all logs from storage
   * @private
   */
  async getAllLogs() {
    try {
      const files = await fs.promises.readdir(this.logsDir);
      let allLogs = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.logsDir, file);
          const data = await fs.promises.readFile(filePath, 'utf8');
          try {
            const logs = JSON.parse(data);
            if (Array.isArray(logs)) {
              allLogs = [...allLogs, ...logs];
            }
          } catch (error) {
            console.error(`Error parsing log file ${file}:`, error);
          }
        }
      }
      
      return allLogs;
    } catch (error) {
      console.error('Error reading log files:', error);
      return [];
    }
  }
  
  /**
   * Append logs to a file
   * @param {Array} logs - Array of logs to append
   * @returns {Promise<boolean>} Success status
   */
  async appendLogs(logs) {
    if (!Array.isArray(logs) || logs.length === 0) return false;
    
    const logFile = path.join(this.logsDir, `trades_${new Date().toISOString().split('T')[0]}.json`);
    
    try {
      let existingLogs = [];
      
      // Load existing logs if file exists
      if (fs.existsSync(logFile)) {
        const data = await fs.promises.readFile(logFile, 'utf8');
        existingLogs = JSON.parse(data);
      }
      
      // Append new logs
      const updatedLogs = [...existingLogs, ...logs];
      
      // Write back to file
      await fs.promises.writeFile(logFile, JSON.stringify(updatedLogs, null, 2));
      
      return true;
    } catch (error) {
      console.error('Error appending logs:', error);
      throw error;
    }
  }
  
  /**
   * Clean up logs older than specified days
   * @param {number} olderThanDays - Days threshold for deletion
   * @returns {Promise<number>} Number of files deleted
   */
  async cleanupOldLogs(olderThanDays = 90) {
    try {
      const files = await fs.promises.readdir(this.logsDir);
      const now = new Date();
      let deletedCount = 0;
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.logsDir, file);
          const stats = await fs.promises.stat(filePath);
          
          const fileAge = (now - stats.mtime) / (1000 * 60 * 60 * 24);
          
          if (fileAge > olderThanDays) {
            await fs.promises.unlink(filePath);
            deletedCount++;
            console.log(`Deleted old log file: ${file}`);
          }
        }
      }
      
      return deletedCount;
    } catch (error) {
      console.error('Error cleaning up old logs:', error);
      return -1;
    }
  }
}

export default LogService;