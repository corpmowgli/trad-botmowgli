// tests/integration/api.test.js
import request from 'supertest';
import jwt from 'jsonwebtoken';
import server from '../../server.js';

const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_très_sécurisé';

// Génère un token valide pour les tests
const generateValidToken = (role = 'admin') => {
  return jwt.sign(
    { id: 1, username: 'testuser', role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
};

describe('API Routes', () => {
  let validToken;
  
  beforeAll(() => {
    validToken = generateValidToken();
  });
  
  afterAll((done) => {
    server.close(() => {
      done();
    });
  });
  
  describe('Authentication', () => {
    test('POST /api/login should return 400 with missing credentials', async () => {
      const res = await request(server)
        .post('/api/login')
        .send({});
      
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
    
    test('GET /api/verify-auth should return 401 without token', async () => {
      const res = await request(server)
        .get('/api/verify-auth');
      
      expect(res.status).toBe(401);
    });
    
    test('GET /api/verify-auth should return 200 with valid token', async () => {
      const res = await request(server)
        .get('/api/verify-auth')
        .set('Cookie', [`token=${validToken}`]);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('authenticated', true);
    });
  });
  
  describe('Protected Routes', () => {
    test('GET /api/status should require authentication', async () => {
      const res = await request(server)
        .get('/api/status');
      
      expect(res.status).toBe(401);
    });
    
    test('GET /api/status should return data with valid token', async () => {
      const res = await request(server)
        .get('/api/status')
        .set('Cookie', [`token=${validToken}`]);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('isRunning');
    });
    
    test('POST /api/start should require admin role', async () => {
      // Générer un token avec un rôle utilisateur standard
      const userToken = generateValidToken('user');
      
      const res = await request(server)
        .post('/api/start')
        .set('Cookie', [`token=${userToken}`]);
      
      expect(res.status).toBe(403);
    });
  });
});