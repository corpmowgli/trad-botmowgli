// middleware/auth.js
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import csurf from 'csurf';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get JWT secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_très_sécurisé'; // Fallback for development only
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '24h';
const REFRESH_TOKEN_EXPIRATION = process.env.REFRESH_TOKEN_EXPIRATION || '7d';

// In a production environment, users would be stored in a database
// This is for demonstration purposes only
const users = [
  {
    id: 1,
    username: 'admin',
    // Mot de passe haché: "admin123"
    passwordHash: '$2b$10$IfBBb.oKhXe6YVRBYp8/WOJAPmFW5PBgAqJVx5.GS1XJWMoAB7aY2',
    role: 'admin',
    refreshTokens: []
  }
];

// More restrictive rate limiting
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,      // 15 minutes
  max: 5,                         // 5 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, veuillez réessayer plus tard' },
  skipSuccessfulRequests: true    // Don't count successful logins
});

// API rate limiter
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,            // 1 minute
  max: 100,                       // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, veuillez réessayer plus tard' }
});

// CSRF Protection
export const csrfProtection = csurf({ 
  cookie: { 
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 3600000 // 1 hour
  } 
});

// JWT Authentication Middleware
export const authenticateJWT = (req, res, next) => {
  // Get token from cookies or Authorization header
  const token = req.cookies.token || 
                (req.headers.authorization && req.headers.authorization.split(' ')[1]);

  if (!token) {
    return res.status(401).json({ error: 'Accès non autorisé' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if token is about to expire (less than 5 minutes left)
    const tokenExp = new Date(decoded.exp * 1000);
    const now = new Date();
    const fiveMinutes = 5 * 60 * 1000;
    
    if ((tokenExp.getTime() - now.getTime()) < fiveMinutes) {
      // Token is about to expire, issue a new one if refresh token is valid
      const refreshToken = req.cookies.refreshToken;
      if (refreshToken) {
        try {
          const refreshDecoded = jwt.verify(refreshToken, JWT_SECRET);
          const user = users.find(u => u.id === refreshDecoded.id);
          
          if (user && user.refreshTokens.includes(refreshToken)) {
            // Create new token
            const newToken = generateAccessToken(user);
            
            // Set new token in cookie
            res.cookie('token', newToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'strict',
              maxAge: 24 * 60 * 60 * 1000 // 24 hours
            });
            
            // Update decoded with new token
            decoded.exp = jwt.decode(newToken).exp;
          }
        } catch (err) {
          // If refresh token verification fails, continue with current token
          console.error('Error refreshing token:', err);
        }
      }
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    // Token verification failed
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée', code: 'TOKEN_EXPIRED' });
    }
    return res.status(403).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
  }
};

// Role Authorization Middleware
export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    next();
  };
};

// Login Function
export const login = async (req, res) => {
  const { username, password } = req.body;

  // Validation
  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }

  // Find user
  const user = users.find(u => u.username === username);
  if (!user) {
    // Use consistent response for security
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  // Verify password
  try {
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    // Generate access and refresh tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    
    // Store refresh token
    user.refreshTokens = user.refreshTokens || [];
    user.refreshTokens.push(refreshToken);
    
    // Limit stored refresh tokens (keep last 5)
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }

    // Set cookies
    res.cookie('token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.json({
      message: 'Connexion réussie',
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
};

// Logout Function
export const logout = (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  
  // If user is authenticated, remove their refresh token
  if (req.user) {
    const user = users.find(u => u.id === req.user.id);
    if (user && refreshToken) {
      user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
    }
  }
  
  // Clear cookies
  res.clearCookie('token');
  res.clearCookie('refreshToken');
  
  return res.json({ message: 'Déconnexion réussie' });
};

// Token refresh endpoint
export const refreshToken = (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token manquant' });
  }
  
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const user = users.find(u => u.id === decoded.id);
    
    if (!user || !user.refreshTokens.includes(refreshToken)) {
      return res.status(403).json({ error: 'Refresh token invalide' });
    }
    
    // Generate new tokens
    const accessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    
    // Update refresh tokens
    user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
    user.refreshTokens.push(newRefreshToken);
    
    // Set cookies
    res.cookie('token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    return res.json({ message: 'Token rafraîchi avec succès' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Refresh token expiré' });
    }
    return res.status(403).json({ error: 'Refresh token invalide' });
  }
};

// Security Middleware Configuration
export const securityMiddleware = [
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
        connectSrc: ["'self'", "wss:", "ws:"],
        fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: []
      }
    },
    xssFilter: true,
    noSniff: true,
    referrerPolicy: { policy: 'same-origin' },
    hsts: {
      maxAge: 15552000,  // 180 days
      includeSubDomains: true
    }
  }),
  cookieParser()
];

// Helper Functions
function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRATION }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRATION }
  );
}

export const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(12); // Increased from 10 to 12 for better security
  return bcrypt.hash(password, salt);
};

export const generateRandomPassword = (length = 16) => { // Increased from 12 to 16
  const upperChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const specialChars = '!@#$%^&*()-_=+[]{}|;:,.<>?';
  
  const allChars = upperChars + lowerChars + numbers + specialChars;
  
  let password = '';
  // Ensure at least one of each character type
  password += upperChars.charAt(Math.floor(Math.random() * upperChars.length));
  password += lowerChars.charAt(Math.floor(Math.random() * lowerChars.length));
  password += numbers.charAt(Math.floor(Math.random() * numbers.length));
  password += specialChars.charAt(Math.floor(Math.random() * specialChars.length));
  
  // Fill the rest randomly
  for (let i = 4; i < length; i++) {
    password += allChars.charAt(Math.floor(Math.random() * allChars.length));
  }
  
  // Shuffle the password characters
  return password.split('').sort(() => 0.5 - Math.random()).join('');
};