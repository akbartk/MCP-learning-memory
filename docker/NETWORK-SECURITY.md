# ⭐️ Network Security Configuration Guide

## Overview

MCP Server dikonfigurasi untuk dapat diakses dari mana saja (0.0.0.0) dengan security layers yang comprehensive.

## Network Architecture

```
Internet (0.0.0.0:ports)
    ↓
[Host Machine]
    ↓
Docker Bridge Network (mcp-network: 172.20.0.0/16)
    ↓
[Internal Services Communication]
```

## Port Bindings

Semua services bind ke `0.0.0.0` untuk public access:

| Service | External Port | Internal Port | Access |
|---------|--------------|---------------|---------|
| Backend API | 0.0.0.0:3000 | backend:3000 | Public |
| Redis | 0.0.0.0:6379 | redis:6379 | Public (Password Protected) |
| ScyllaDB | 0.0.0.0:9042 | scylladb:9042 | Public (Auth Required) |
| Elasticsearch | 0.0.0.0:9200 | elasticsearch:9200 | Public (Auth Required) |
| Prometheus | 0.0.0.0:9090 | prometheus:9090 | Public |
| Grafana | 0.0.0.0:3001 | grafana:3000 | Public (Login Required) |
| Frontend | 0.0.0.0:3002 | frontend:3000 | Public |

## Internal Communication

Services communicate internally using Docker service names:
- Backend → Redis: `redis:6379`
- Backend → ScyllaDB: `scylladb:9042`
- Backend → Elasticsearch: `elasticsearch:9200`
- Prometheus → Backend: `backend:3000/metrics`

## Security Layers

### 1. Network Level

```yaml
# Docker Compose Configuration
services:
  backend:
    ports:
      - "0.0.0.0:3000:3000"  # Bind to all interfaces
    networks:
      - mcp-network          # Internal network

networks:
  mcp-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

### 2. Application Level

#### CORS Configuration
```javascript
// Allows specific origins or IP patterns
cors: {
  origin: (origin, callback) => {
    // Development: Allow any IP
    const ipPattern = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
    if (ipPattern.test(origin)) {
      return callback(null, true);
    }
    // Production: Whitelist specific domains
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',');
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    }
  }
}
```

#### IP Filtering
```javascript
// Three modes: none, whitelist, blacklist
IP_FILTER_MODE=none       # Allow all
IP_FILTER_MODE=whitelist  # Only allow specific IPs
IP_FILTER_MODE=blacklist  # Block specific IPs
```

### 3. Database Level

#### Redis
```bash
# Password authentication
redis-server --requirepass ${REDIS_PASSWORD}

# Connection from app
redis://:password@redis:6379
```

#### ScyllaDB
```bash
# Enable authentication
--authenticator PasswordAuthenticator

# Connect with credentials
cqlsh -u cassandra -p ${SCYLLA_PASSWORD}
```

#### Elasticsearch
```yaml
# X-Pack security enabled
xpack.security.enabled: true
ELASTIC_PASSWORD: ${ELASTICSEARCH_PASSWORD}

# Connect with auth
curl -u elastic:password http://elasticsearch:9200
```

## Access Configuration

### From Local Machine
```bash
# API Access
curl http://localhost:3000/api/v1/health

# Redis CLI
redis-cli -h localhost -p 6379 -a password

# Elasticsearch
curl -u elastic:password http://localhost:9200
```

### From Remote Machine
```bash
# Replace YOUR_SERVER_IP with actual IP
curl http://YOUR_SERVER_IP:3000/api/v1/health

# With authentication header
curl -H "Authorization: Bearer JWT_TOKEN" \
     http://YOUR_SERVER_IP:3000/api/v1/notes
```

### From Another Docker Container
```bash
# Use internal service names
curl http://backend:3000/api/v1/health
redis-cli -h redis -p 6379
```

## Security Best Practices

### 1. Firewall Configuration

```bash
# UFW (Ubuntu)
sudo ufw allow 3000/tcp  # Backend API
sudo ufw allow 3001/tcp  # Grafana
sudo ufw allow 3002/tcp  # Frontend

# Restrict database ports to specific IPs only
sudo ufw allow from 192.168.1.100 to any port 6379  # Redis
sudo ufw allow from 192.168.1.100 to any port 9042  # ScyllaDB
```

### 2. Environment Variables

```bash
# .env file - NEVER commit to git
JWT_SECRET=strong-random-secret
REDIS_PASSWORD=strong-password
SCYLLA_PASSWORD=strong-password
ELASTICSEARCH_PASSWORD=strong-password

# IP Restrictions
IP_FILTER_MODE=whitelist
IP_WHITELIST=192.168.1.100,192.168.1.101
```

### 3. Rate Limiting

```javascript
// Per-tier rate limits
RATE_LIMIT_BASIC_MAX=1000       # 1000 req/min
RATE_LIMIT_PRO_MAX=10000        # 10000 req/min
RATE_LIMIT_ENTERPRISE_MAX=100000 # 100000 req/min
```

### 4. SSL/TLS (Production)

```nginx
# Nginx reverse proxy with SSL
server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## Monitoring Access

### Check Client IPs
```bash
# View backend logs with IP addresses
docker logs mcp-backend | grep "Client IP"

# Monitor connections
netstat -tunlp | grep 3000
ss -tunlp | grep 3000
```

### Test Access
```bash
# Test from different IPs
curl -v http://0.0.0.0:3000/api/v1/health

# Test CORS
curl -H "Origin: http://192.168.1.100:8080" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: X-Requested-With" \
     -X OPTIONS \
     http://localhost:3000/api/v1/health
```

## Troubleshooting

### Connection Refused
```bash
# Check if service is listening on 0.0.0.0
docker exec mcp-backend netstat -tlnp

# Check Docker port mapping
docker port mcp-backend
```

### CORS Errors
```bash
# Add origin to allowed list
ALLOWED_ORIGINS=http://localhost:3000,http://192.168.1.100:8080

# Or allow all in development
ALLOW_ALL_IPS=true
```

### IP Blocked
```bash
# Check IP filter mode
echo $IP_FILTER_MODE

# Add IP to whitelist
IP_WHITELIST=192.168.1.100,192.168.1.101
```

## Security Checklist

- [ ] Changed all default passwords
- [ ] Configured firewall rules
- [ ] Set up IP filtering if needed
- [ ] Enabled authentication on all databases
- [ ] Configured CORS for specific origins
- [ ] Set up rate limiting
- [ ] Enabled HTTPS in production
- [ ] Configured log monitoring
- [ ] Set up intrusion detection
- [ ] Regular security updates

## Testing Commands

```bash
# Test public access
curl http://$(hostname -I | awk '{print $1}'):3000/api/v1/health

# Test from Docker network
docker run --rm --network mcp-network alpine wget -qO- http://backend:3000/api/v1/health

# Test authentication
curl -u elastic:${ELASTICSEARCH_PASSWORD} http://localhost:9200

# Test rate limiting
for i in {1..100}; do curl http://localhost:3000/api/v1/health; done
```

---

Last Updated: 2025-09-13
Version: 1.0.0