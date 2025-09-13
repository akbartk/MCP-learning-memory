# Production Deployment Guide - MCP Server

⭐️ **Panduan lengkap untuk deployment MCP Server ke production environment**

## 📋 Prerequisites

### System Requirements
- **OS**: Ubuntu 20.04+ / CentOS 8+ / Amazon Linux 2
- **CPU**: Minimum 4 cores (8 cores recommended)
- **RAM**: Minimum 16GB (32GB recommended)
- **Storage**: 100GB SSD (NVMe recommended)
- **Network**: Public IP dengan port forwarding capability

### Software Requirements
- Docker 20.10+
- Docker Compose 2.0+
- Git
- OpenSSL
- Nginx (untuk reverse proxy)
- Certbot (untuk SSL certificates)

## 🚀 Step-by-Step Deployment

### Step 1: Server Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    ufw

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add current user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

### Step 2: Clone Repository

```bash
# Clone repository
cd /opt
sudo git clone https://github.com/your-org/mcp-server.git
sudo chown -R $USER:$USER mcp-server
cd mcp-server
```

### Step 3: Environment Configuration

```bash
# Copy and configure environment variables
cp .env.example .env

# Edit dengan production values
nano .env
```

**Production .env configuration:**
```env
# Application
NODE_ENV=production
API_PORT=3000
FRONTEND_PORT=3002

# Security
JWT_SECRET=<generate-strong-secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Database - Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=<strong-password>

# Database - ScyllaDB
SCYLLA_CONTACT_POINTS=scylladb
SCYLLA_PORT=9042
SCYLLA_KEYSPACE=mcp_server
SCYLLA_REPLICATION_FACTOR=3

# Database - Elasticsearch
ELASTICSEARCH_NODE=http://elasticsearch:9200
ELASTIC_PASSWORD=<strong-password>

# Monitoring
GRAFANA_USER=admin
GRAFANA_PASSWORD=<strong-password>

# Rate Limiting
RATE_LIMIT_BASIC=1000
RATE_LIMIT_PRO=5000
RATE_LIMIT_ENTERPRISE=0

# Backup
BACKUP_ENABLED=true
BACKUP_SCHEDULE="0 */4 * * *"
BACKUP_RETENTION_DAYS=30
BACKUP_S3_BUCKET=mcp-server-backups
```

### Step 4: Production Docker Compose

```bash
# Create production docker-compose
cat > docker-compose.prod.yml << 'EOF'
version: '3.9'

services:
  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    volumes:
      - redis-data:/data
    networks:
      - mcp-network

  scylladb:
    image: scylladb/scylla:5.2
    restart: always
    command: --seeds=scylladb --smp 4 --memory 8G
    volumes:
      - scylla-data:/var/lib/scylla
    networks:
      - mcp-network
    deploy:
      resources:
        limits:
          memory: 8G
          cpus: '4'

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.10.2
    restart: always
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=true
      - ELASTIC_PASSWORD=${ELASTIC_PASSWORD}
      - "ES_JAVA_OPTS=-Xms4g -Xmx4g"
    volumes:
      - elastic-data:/usr/share/elasticsearch/data
    networks:
      - mcp-network
    deploy:
      resources:
        limits:
          memory: 8G

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: always
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    depends_on:
      - redis
      - scylladb
      - elasticsearch
    networks:
      - mcp-network
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 2G
          cpus: '2'

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: always
    environment:
      - REACT_APP_API_URL=/api
    networks:
      - mcp-network

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
    depends_on:
      - backend
      - frontend
    networks:
      - mcp-network

networks:
  mcp-network:
    driver: bridge

volumes:
  redis-data:
  scylla-data:
  elastic-data:
EOF
```

### Step 5: Nginx Configuration

```bash
# Create Nginx configuration
mkdir -p nginx
cat > nginx/nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream backend {
        least_conn;
        server backend:3000 max_fails=3 fail_timeout=30s;
    }

    upstream frontend {
        server frontend:3000;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    # Cache
    proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m max_size=1g inactive=60m;

    server {
        listen 80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name your-domain.com;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Strict-Transport-Security "max-age=31536000" always;

        # API endpoints
        location /api/ {
            limit_req zone=api burst=20 nodelay;

            proxy_pass http://backend/api/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Caching
            proxy_cache api_cache;
            proxy_cache_valid 200 1m;
            proxy_cache_use_stale error timeout invalid_header updating;
        }

        # Frontend
        location / {
            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
EOF
```

### Step 6: SSL Certificate Setup

```bash
# Install Certbot
sudo apt install certbot

# Generate SSL certificate
sudo certbot certonly --standalone -d your-domain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/key.pem

# Set permissions
sudo chmod 644 nginx/ssl/cert.pem
sudo chmod 600 nginx/ssl/key.pem
```

### Step 7: Firewall Configuration

```bash
# Configure UFW firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Check status
sudo ufw status
```

### Step 8: System Optimization

```bash
# Optimize kernel parameters
sudo cat >> /etc/sysctl.conf << EOF
# Network optimizations
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
net.ipv4.ip_local_port_range = 1024 65535

# File descriptor limits
fs.file-max = 2097152
fs.nr_open = 2097152
EOF

# Apply changes
sudo sysctl -p

# Set ulimits
sudo cat >> /etc/security/limits.conf << EOF
* soft nofile 65535
* hard nofile 65535
* soft nproc 32768
* hard nproc 32768
EOF
```

### Step 9: Deploy Application

```bash
# Build and start services
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Initialize databases
./scripts/init-db.sh

# Check health
./scripts/health.sh
```

### Step 10: Setup Monitoring

```bash
# Create systemd service for auto-restart
sudo cat > /etc/systemd/system/mcp-server.service << EOF
[Unit]
Description=MCP Server
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/mcp-server
ExecStart=/usr/local/bin/docker-compose -f docker-compose.prod.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

# Enable service
sudo systemctl enable mcp-server
sudo systemctl start mcp-server
```

## 📊 Monitoring Setup

### Prometheus Configuration

```yaml
# prometheus/prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'mcp-api'
    static_configs:
      - targets: ['backend:3000']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']

  - job_name: 'elasticsearch'
    static_configs:
      - targets: ['elasticsearch:9200']
```

### Grafana Dashboards

1. Import dashboard untuk:
   - API metrics (response time, throughput)
   - Database performance
   - System resources
   - Business metrics

2. Setup alerts untuk:
   - High response time (> 200ms)
   - Error rate (> 1%)
   - Low disk space (< 10GB)
   - Service down

## 🔄 Backup Strategy

### Automated Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups/$(date +%Y%m%d)"
mkdir -p $BACKUP_DIR

# Backup Redis
docker exec mcp-redis redis-cli --rdb $BACKUP_DIR/redis.rdb

# Backup ScyllaDB
docker exec mcp-scylladb nodetool snapshot
docker cp mcp-scylladb:/var/lib/scylla/data $BACKUP_DIR/scylla

# Backup Elasticsearch
curl -X PUT "localhost:9200/_snapshot/backup" -H 'Content-Type: application/json' -d'
{
  "type": "fs",
  "settings": {
    "location": "'$BACKUP_DIR'/elasticsearch"
  }
}'

# Upload to S3
aws s3 sync $BACKUP_DIR s3://mcp-server-backups/$(date +%Y%m%d)

# Clean old backups
find /backups -type d -mtime +30 -exec rm -rf {} \;
```

### Setup Cron Job

```bash
# Add to crontab
crontab -e

# Add backup schedule (every 4 hours)
0 */4 * * * /opt/mcp-server/scripts/backup.sh >> /var/log/mcp-backup.log 2>&1
```

## 🚨 Disaster Recovery

### Recovery Procedure

1. **Service Failure**
   ```bash
   # Check service status
   docker-compose -f docker-compose.prod.yml ps

   # Restart failed service
   docker-compose -f docker-compose.prod.yml restart [service-name]
   ```

2. **Data Recovery**
   ```bash
   # Stop services
   docker-compose -f docker-compose.prod.yml down

   # Restore from backup
   ./scripts/restore.sh [backup-date]

   # Start services
   docker-compose -f docker-compose.prod.yml up -d
   ```

3. **Complete System Recovery**
   ```bash
   # From fresh server
   ./scripts/disaster-recovery.sh
   ```

## 🔐 Security Checklist

- [ ] Change all default passwords
- [ ] Enable firewall (UFW/iptables)
- [ ] Setup SSL certificates
- [ ] Configure rate limiting
- [ ] Enable audit logging
- [ ] Setup intrusion detection (fail2ban)
- [ ] Regular security updates
- [ ] Backup encryption
- [ ] API key rotation policy
- [ ] CORS configuration
- [ ] DDoS protection (Cloudflare)

## 📈 Performance Tuning

### Database Optimization

```bash
# ScyllaDB tuning
docker exec mcp-scylladb nodetool settraceprobability 0.001
docker exec mcp-scylladb nodetool setcompactionthroughput 32

# Elasticsearch tuning
curl -X PUT "localhost:9200/_cluster/settings" -H 'Content-Type: application/json' -d'
{
  "persistent": {
    "indices.recovery.max_bytes_per_sec": "100mb",
    "cluster.routing.allocation.disk.watermark.low": "85%",
    "cluster.routing.allocation.disk.watermark.high": "90%"
  }
}'
```

### Load Balancing

```nginx
# Multiple backend instances
upstream backend {
    least_conn;
    server backend1:3000 weight=3;
    server backend2:3000 weight=2;
    server backend3:3000 weight=1;
    keepalive 32;
}
```

## 📝 Maintenance

### Regular Tasks

**Daily:**
- Check health status
- Monitor error logs
- Review metrics dashboard

**Weekly:**
- Test backup restoration
- Review security logs
- Update dependencies

**Monthly:**
- Performance analysis
- Capacity planning
- Security audit
- SSL certificate renewal check

### Logs Location

```bash
# Application logs
/var/log/mcp-server/

# Docker logs
docker-compose -f docker-compose.prod.yml logs [service]

# System logs
/var/log/syslog
journalctl -u mcp-server
```

## 🆘 Troubleshooting

### Common Issues

1. **High Memory Usage**
   ```bash
   # Check memory
   docker stats

   # Restart service
   docker-compose -f docker-compose.prod.yml restart [service]
   ```

2. **Slow Response Time**
   ```bash
   # Check database performance
   docker exec mcp-scylladb nodetool status

   # Clear cache
   docker exec mcp-redis redis-cli FLUSHDB
   ```

3. **Connection Errors**
   ```bash
   # Check network
   docker network ls
   docker network inspect mcp-network
   ```

## 📞 Support

- Documentation: `/docs/`
- Issues: GitHub Issues
- Email: support@mcp-server.ai
- Monitoring: https://your-domain.com:3001

---

**⭐️ MCP Server Production Deployment - Ready for Scale!**