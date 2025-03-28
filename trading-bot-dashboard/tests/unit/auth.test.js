// tests/unit/auth.test.js
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { authenticateJWT, authorizeRoles } from '../../middleware/auth.js';

// Mock pour jsonwebtoken
jest.mock('jsonwebtoken');

describe('Auth Middleware', () => {
  let req, res, next;
  
  beforeEach(() => {
    req = {
      cookies: {},
      headers: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('authenticateJWT', () => {
    test('should return 401 if no token is provided', () => {
      authenticateJWT(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Accès non autorisé' });
      expect(next).not.toHaveBeenCalled();
    });
    
    test('should return 403 if token is invalid', () => {
      req.cookies.token = 'invalid-token';
      jwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });
      
      authenticateJWT(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Token invalide ou expiré' });
      expect(next).not.toHaveBeenCalled();
    });
    
    test('should call next() if token is valid', () => {
      req.cookies.token = 'valid-token';
      const decodedToken = { id: 1, username: 'admin', role: 'admin' };
      jwt.verify.mockReturnValue(decodedToken);
      
      authenticateJWT(req, res, next);
      
      expect(req.user).toEqual(decodedToken);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
  
  describe('authorizeRoles', () => {
    test('should return 403 if user has no role', () => {
      req.user = { id: 1, username: 'user' };
      
      const middleware = authorizeRoles('admin');
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Accès interdit' });
      expect(next).not.toHaveBeenCalled();
    });
    
    test('should return 403 if user role is not authorized', () => {
      req.user = { id: 1, username: 'user', role: 'user' };
      
      const middleware = authorizeRoles('admin');
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Accès interdit' });
      expect(next).not.toHaveBeenCalled();
    });
    
    test('should call next() if user role is authorized', () => {
      req.user = { id: 1, username: 'admin', role: 'admin' };
      
      const middleware = authorizeRoles('admin', 'superuser');
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});