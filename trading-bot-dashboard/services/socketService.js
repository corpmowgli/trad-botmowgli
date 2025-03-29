// services/socketService.js
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';

/**
 * Socket Service
 * Manages real-time updates via Socket.IO
 */
export class SocketService {
  /**
   * Create a new SocketService
   * @param {Object} server - HTTP server instance
   * @param {Object} config - Service configuration
   */
  constructor(server, config) {
    this.config = config;
    this.JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_très_sécurisé';
    
    // Initialize Socket.IO with CORS configuration
    this.io = new SocketIOServer(server, {
      cors: {
        origin: config.env === 'production' ? false : '*',
        methods: ['GET', 'POST'],
        credentials: true
      }
    });
    
    // Connected clients
    this.clients = new Map();
    
    // Initialize socket connection handler
    this.initialize();
    
    // History of recent updates for new clients
    this.updateHistory = [];
    this.maxHistoryItems = 20;
    
    console.log('Socket service initialized');
  }
  
  /**
   * Initialize socket event handlers
   * @private
   */
  initialize() {
    this.io.use((socket, next) => {
      // Authenticate socket connections
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }
      
      try {
        // Verify JWT token
        const decoded = jwt.verify(token, this.JWT_SECRET);
        socket.user = decoded;
        next();
      } catch (error) {
        console.error('Socket authentication error:', error);
        next(new Error('Invalid authentication'));
      }
    });
    
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }
  
  /**
   * Handle new socket connections
   * @private
   * @param {Object} socket - Socket instance
   */
  handleConnection(socket) {
    console.log('New client connected', socket.id);
    
    // Store client information
    this.clients.set(socket.id, {
      id: socket.id,
      user: socket.user,
      connectedAt: new Date(),
      lastActivity: new Date()
    });
    
    // Send initial status
    socket.emit('bot_status', { 
      isRunning: global.botStatus?.isRunning || false,
      timestamp: new Date().toISOString()
    });
    
    // Send recent update history
    if (this.updateHistory.length > 0) {
      socket.emit('update_history', this.updateHistory);
    }
    
    // Custom event handlers
    socket.on('request_update', () => {
      this.handleRequestUpdate(socket);
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('Client disconnected', socket.id);
      this.clients.delete(socket.id);
    });
  }
  
  /**
   * Handle update request from client
   * @private
   * @param {Object} socket - Socket instance
   */
  handleRequestUpdate(socket) {
    // Update last activity timestamp
    const client = this.clients.get(socket.id);
    if (client) {
      client.lastActivity = new Date();
    }
    
    // Emit current updates to the requesting client
    if (global.bot && global.botStatus?.isRunning) {
      const updateData = {
        report: global.bot.getPerformanceReport(),
        recentTrades: global.bot.logger.getRecentTrades(5),
        timestamp: new Date().toISOString()
      };
      
      socket.emit('bot_update', updateData);
    } else {
      socket.emit('bot_status', { 
        isRunning: false, 
        timestamp: new Date().toISOString() 
      });
    }
  }
  
  /**
   * Broadcast status update to all connected clients
   * @param {boolean} isRunning - Whether the bot is running
   */
  broadcastStatusChange(isRunning) {
    const statusUpdate = {
      isRunning,
      timestamp: new Date().toISOString()
    };
    
    this.io.emit('bot_status_change', statusUpdate);
    
    // Add to update history
    this.addToHistory('status_change', statusUpdate);
  }
  
  /**
   * Broadcast bot updates to all connected clients
   * @param {Object} data - Update data
   */
  broadcastUpdate(data) {
    const updateData = {
      ...data,
      timestamp: data.timestamp || new Date().toISOString()
    };
    
    this.io.emit('bot_update', updateData);
    
    // Add to update history
    this.addToHistory('update', updateData);
  }
  
  /**
   * Broadcast a trade event to all connected clients
   * @param {Object} trade - Trade data
   */
  broadcastTrade(trade) {
    const tradeData = {
      trade,
      timestamp: new Date().toISOString()
    };
    
    this.io.emit('trade', tradeData);
    
    // Add to update history
    this.addToHistory('trade', tradeData);
  }
  
  /**
   * Add an update to history
   * @private
   * @param {string} type - Update type
   * @param {Object} data - Update data
   */
  addToHistory(type, data) {
    this.updateHistory.unshift({
      type,
      data,
      timestamp: new Date().toISOString()
    });
    
    // Limit history size
    if (this.updateHistory.length > this.maxHistoryItems) {
      this.updateHistory = this.updateHistory.slice(0, this.maxHistoryItems);
    }
  }
  
  /**
   * Get connected client count
   * @returns {number} Number of connected clients
   */
  getClientCount() {
    return this.clients.size;
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    this.io.close();
    console.log('Socket service shut down');
  }
}

export default SocketService;