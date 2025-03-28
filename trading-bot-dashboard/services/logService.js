// services/logService.js
import fs from 'fs';
import path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { stringify } from 'csv-stringify';

// Pour obtenir les chemins d'accès en utilisant ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pipelineAsync = promisify(pipeline);

class LogService {
  constructor(config) {
    this.config = config;
    this.logsDir = path.join(__dirname, '..', config.logging.filePath || 'logs/trades');
    
    // Créer le répertoire des logs s'il n'existe pas
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  // Exporter les logs avec streaming et pagination
  async streamLogs(res, format = 'json', options = {}) {
    const { 
      startDate, 
      endDate, 
      page = 1, 
      limit = 1000,
      compress = false
    } = options;
    
    try {
      // Déterminer le nom du fichier et les headers en fonction du format
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      let filename, contentType;
      
      if (format === 'json') {
        filename = `trading_logs_${timestamp}.json`;
        contentType = 'application/json';
      } else if (format === 'csv') {
        filename = `trading_logs_${timestamp}.csv`;
        contentType = 'text/csv';
      } else {
        throw new Error('Format non supporté');
      }
      
      // Ajouter l'extension .gz si compression
      if (compress) {
        filename += '.gz';
        contentType += '+gzip';
      }
      
      // Définir les headers de réponse
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      
      // Filtrer et paginer les logs
      const logs = await this.getFilteredLogs(startDate, endDate, page, limit);
      
      // Créer le stream de données en fonction du format
      let dataStream;
      
      if (format === 'json') {
        dataStream = this.createJsonStream(logs);
      } else {
        dataStream = this.createCsvStream(logs);
      }
      
      // Appliquer la compression si demandée
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
  
  // Obtenir les logs filtrés par date et paginés
  async getFilteredLogs(startDate, endDate, page, limit) {
    try {
      // Récupérer tous les logs
      const allLogs = await this.getAllLogs();
      
      let filteredLogs = allLogs;
      
      // Filtrer par date si spécifié
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate) : new Date(0);
        const end = endDate ? new Date(endDate) : new Date();
        
        filteredLogs = allLogs.filter(log => {
          const logDate = new Date(log.timestamp);
          return logDate >= start && logDate <= end;
        });
      }
      
      // Calculer la pagination
      const startIndex = (page - 1) * limit;
      const endIndex = page * limit;
      
      return filteredLogs.slice(startIndex, endIndex);
    } catch (error) {
      console.error('Error filtering logs:', error);
      return [];
    }
  }
  
  // Créer un stream JSON
  createJsonStream(data) {
    return new Readable({
      objectMode: true,
      read() {
        this.push(JSON.stringify(data, null, 2));
        this.push(null);
      }
    });
  }
  
  // Créer un stream CSV
  createCsvStream(data) {
    if (!data || data.length === 0) {
      // Si aucune donnée, créer un stream vide avec entêtes
      const emptyData = [{}];
      const stringifier = stringify({
        header: true,
        columns: ['timestamp', 'token', 'entryPrice', 'exitPrice', 'amount', 'profit', 'signal']
      });
      
      const inputStream = new Readable({
        objectMode: true,
        read() {
          this.push(null);
        }
      });
      
      return inputStream.pipe(stringifier);
    }
    
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
  
  // Récupérer tous les logs
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
  
  // Sauvegarder des logs en mode append
  async appendLogs(logs) {
    const logFile = path.join(this.logsDir, `trades_${new Date().toISOString().split('T')[0]}.json`);
    
    try {
      let existingLogs = [];
      
      // Charger les logs existants si le fichier existe
      if (fs.existsSync(logFile)) {
        const data = await fs.promises.readFile(logFile, 'utf8');
        existingLogs = JSON.parse(data);
      }
      
      // Ajouter les nouveaux logs
      const updatedLogs = [...existingLogs, ...logs];
      
      // Écrire dans le fichier
      await fs.promises.writeFile(logFile, JSON.stringify(updatedLogs, null, 2));
      
      return true;
    } catch (error) {
      console.error('Error appending logs:', error);
      throw error;
    }
  }
  
  // Nettoyer les anciens logs
  async cleanupOldLogs(olderThanDays = 90) {
    try {
      const files = await fs.promises.readdir(this.logsDir);
      const now = new Date();
      
      for (const file of files) {
        const filePath = path.join(this.logsDir, file);
        const stats = await fs.promises.stat(filePath);
        
        const fileAge = (now - stats.mtime) / (1000 * 60 * 60 * 24);
        
        if (fileAge > olderThanDays) {
          await fs.promises.unlink(filePath);
          console.log(`Deleted old log file: ${file}`);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error cleaning up old logs:', error);
      throw error;
    }
  }
}

export default LogService;