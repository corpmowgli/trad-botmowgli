#!/bin/bash
# Script d'installation pour le serveur web de Trading Bot sur EC2
# À exécuter en tant que root ou avec sudo

# Sortir en cas d'erreur
set -e

echo "=== Installation du Dashboard Trading Bot ==="
echo "Préparation de l'environnement..."

# Mise à jour du système
apt-get update && apt-get upgrade -y

# Installation de Node.js et npm
echo "Installation de Node.js et npm..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs git

# Vérification des versions
node -v
npm -v

# Création du répertoire de l'application
echo "Préparation du répertoire de l'application..."
mkdir -p /opt/trading-bot
cd /opt/trading-bot

# Si vous n'utilisez pas Git, copiez les fichiers manuellement
echo "Préparation des fichiers de l'application..."
mkdir -p /opt/trading-bot/public/css
mkdir -p /opt/trading-bot/public/js
mkdir -p /opt/trading-bot/config
mkdir -p /opt/trading-bot/strategies
mkdir -p /opt/trading-bot/utils
mkdir -p /opt/trading-bot/trading
mkdir -p /opt/trading-bot/services
mkdir -p /opt/trading-bot/middleware
mkdir -p /opt/trading-bot/tests/unit
mkdir -p /opt/trading-bot/tests/integration
mkdir -p /opt/trading-bot/tests/performance

# Installation des dépendances
echo "Installation des dépendances Node.js..."
cd /opt/trading-bot
npm init -y

# Mise à jour du package.json
cat > /opt/trading-bot/package.json << 'EOF'
{
  "name": "trading-bot-dashboard",
  "version": "1.0.0",
  "description": "Dashboard for real-time trading bot visualization with enhanced security and performance",
  "main": "server.js",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "NODE_OPTIONS=--experimental-vm-modules jest",
    "test:unit": "NODE_OPTIONS=--experimental-vm-modules jest tests/unit",
    "test:integration": "NODE_OPTIONS=--experimental-vm-modules jest tests/integration",
    "test:performance": "node tests/performance/load.test.js"
  },
  "dependencies": {
    "axios": "^1.4.0",
    "bcrypt": "^5.1.0",
    "compression": "^1.7.4",
    "cookie-parser": "^1.4.6",
    "csv-stringify": "^6.4.0",
    "csurf": "^1.11.0",
    "express": "^4.18.2",
    "express-rate-limit": "^6.7.0",
    "express-validator": "^7.0.1",
    "helmet": "^7.0.0",
    "jsonwebtoken": "^9.0.0",
    "moment": "^2.29.4",
    "socket.io": "^4.6.1",
    "winston": "^3.8.2",
    "xss": "^1.0.14"
  },
  "devDependencies": {
    "@jest/globals": "^29.5.0",
    "autocannon": "^7.11.0",
    "jest": "^29.5.0",
    "nodemon": "^2.0.22",
    "supertest": "^6.3.3"
  }
}
EOF

# Installation des dépendances
npm install

# Configuration de Jest
cat > /opt/trading-bot/jest.config.js << 'EOF'
export default {
  testEnvironment: 'node',
  transform: {},
  extensionsToTreatAsEsm: ['.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/'
  ]
};
EOF

# Configuration du service systemd pour démarrage automatique
echo "Configuration du service systemd..."
cat > /etc/systemd/system/trading-bot.service << 'EOF'
[Unit]
Description=Trading Bot Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/trading-bot
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=trading-bot
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Création du dossier pour les logs
mkdir -p /opt/trading-bot/logs/trades
chmod 755 /opt/trading-bot/logs/trades

# Recharger systemd, activer et démarrer le service
systemctl daemon-reload
systemctl enable trading-bot.service

# Configuration de nginx comme proxy inverse (optionnel)
echo "Souhaitez-vous installer nginx comme proxy inverse avec HTTPS ? (y/n)"
read install_nginx

if [ "$install_nginx" = "y" ]; then
    echo "Installation de nginx..."
    apt-get install -y nginx certbot python3-certbot-nginx

    echo "Configuration de nginx..."
    cat > /etc/nginx/sites-available/trading-bot << 'EOF'
server {
    listen 80;
    server_name _;  # Remplacez par votre nom de domaine si disponible

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Compression gzip
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_proxied any;
    gzip_vary on;
    gzip_types
      application/javascript
      application/json
      application/x-javascript
      text/css
      text/javascript
      text/plain;
}
EOF

    # Activer le site et redémarrer nginx
    ln -s /etc/nginx/sites-available/trading-bot /etc/nginx/sites-enabled/
    systemctl restart nginx

    # Configuration HTTPS
    echo "Souhaitez-vous configurer HTTPS avec Let's Encrypt ? (y/n)"
    read setup_https

    if [ "$setup_https" = "y" ]; then
        echo "Entrez votre nom de domaine (ex: trading.example.com):"
        read domain_name

        if [ -n "$domain_name" ]; then
            certbot --nginx -d $domain_name
        else
            echo "Aucun nom de domaine fourni, configuration HTTPS ignorée."
        fi
    fi
fi

# Démarrer le service trading-bot
systemctl start trading-bot.service

# Affichage des informations finales
echo "=== Installation terminée ! ==="
echo "Le dashboard Trading Bot est disponible sur:"

if [ "$install_nginx" = "y" ]; then
    if [ "$setup_https" = "y" ] && [ -n "$domain_name" ]; then
        echo "https://$domain_name"
    else
        echo "http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
    fi
else
    echo "http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3000"
fi

echo "Identifiants par défaut:"
echo "Nom d'utilisateur: admin"
echo "Mot de passe: admin123"
echo ""
echo "Pour voir les logs du service:"
echo "journalctl -u trading-bot -f"
echo ""
echo "Pour redémarrer le service:"
echo "systemctl restart trading-bot"
echo ""
echo "=== Bon trading ! ==="