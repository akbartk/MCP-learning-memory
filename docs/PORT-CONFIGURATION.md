# ⭐️ MCP Server Port Configuration

## Port Mapping Summary

MCP Server menggunakan port yang tidak konflik dengan services existing di server.

## Production Ports (.env)

| Service | Port | Default | Description |
|---------|------|---------|-------------|
| Backend API | 4000 | 3000→4000 | REST API endpoint |
| Frontend | 4002 | 3002→4002 | Web UI |
| Redis | 6381 | 6379→6381 | Cache layer |
| ScyllaDB | 9043 | 9042→9043 | Primary database |
| ScyllaDB API | 10001 | 10000→10001 | Admin API |
| Elasticsearch | 9201 | 9200→9201 | Search engine |
| Elasticsearch Transport | 9301 | 9300→9301 | Node communication |
| Prometheus | 9091 | 9090→9091 | Metrics collection |
| Grafana | 4001 | 3001→4001 | Monitoring dashboard |

## Test Environment Ports (docker-compose.test.yml)

| Service | Port | Description |
|---------|------|-------------|
| Redis Test | 6382 | Test cache |
| ScyllaDB Test | 9044 | Test database |
| Elasticsearch Test | 9202 | Test search |

## Ports Already In Use (Existing Services)

| Port | Service | Container |
|------|---------|-----------|
| 3000 | Unknown | System service |
| 3001 | Grafana | surat_pwkw_grafana |
| 6379 | Redis | persuratan-redis |
| 6380 | Redis Test (Old) | mcp-redis-test |
| 9042 | ScyllaDB Test (Old) | mcp-scylladb-test |
| 9200 | Elasticsearch Test (Old) | mcp-elasticsearch-test |
| 16380 | Redis | surat_pwkw_redis |

## Quick Start

### 1. Test Environment
```bash
# Start test services
docker-compose -f docker-compose.test.yml up -d

# Test connections
redis-cli -p 6382 ping
curl http://localhost:9202/_cluster/health
```

### 2. Production Environment
```bash
# Generate credentials
./scripts/generate-credentials.sh

# Start production
docker-compose up -d

# Access services
curl http://localhost:4000/api/v1/health  # Backend API
http://localhost:4001                      # Grafana
http://localhost:4002                      # Frontend
```

## Network Access

### Local Access
```bash
# API
curl http://localhost:4000/api/v1/health

# Redis
redis-cli -p 6381 -a ${REDIS_PASSWORD}

# Elasticsearch
curl -u elastic:${ELASTICSEARCH_PASSWORD} http://localhost:9201

# Grafana
http://localhost:4001 (admin/${GRAFANA_PASSWORD})
```

### Remote Access
```bash
# Replace YOUR_IP with server IP
curl http://YOUR_IP:4000/api/v1/health
redis-cli -h YOUR_IP -p 6381 -a password
```

## Docker Compose Configuration

### Override Ports via Environment
```bash
# Custom ports in .env
API_PORT=5000
REDIS_PORT=6390
ELASTIC_PORT=9210

# Or inline
API_PORT=5000 docker-compose up -d
```

### Check Port Usage
```bash
# List all used ports
netstat -tlnp | grep LISTEN

# Check specific port
lsof -i :4000

# Docker port mapping
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port
sudo lsof -i :4000
sudo netstat -nlp | grep :4000

# Kill process (careful!)
sudo kill -9 <PID>

# Or change port in .env
API_PORT=4001
```

### Cannot Connect
```bash
# Check if service is running
docker ps | grep mcp

# Check port binding
docker port mcp-backend

# Test internal connection
docker exec mcp-backend curl http://localhost:3000/health

# Check firewall
sudo ufw status
sudo ufw allow 4000/tcp
```

### Permission Denied
```bash
# For ports < 1024, need root
sudo docker-compose up -d

# Or use higher ports (recommended)
API_PORT=4000  # Instead of 80
```

## Firewall Configuration

### UFW (Ubuntu)
```bash
# Allow MCP ports
sudo ufw allow 4000/tcp  # API
sudo ufw allow 4001/tcp  # Grafana
sudo ufw allow 4002/tcp  # Frontend

# Restrict database ports (only from specific IP)
sudo ufw allow from 192.168.1.100 to any port 6381
sudo ufw allow from 192.168.1.100 to any port 9043
sudo ufw allow from 192.168.1.100 to any port 9201
```

### iptables
```bash
# Allow API port
sudo iptables -A INPUT -p tcp --dport 4000 -j ACCEPT

# Save rules
sudo iptables-save > /etc/iptables/rules.v4
```

## Port Forwarding (SSH Tunnel)

```bash
# Forward remote MCP to local
ssh -L 4000:localhost:4000 user@server
ssh -L 4001:localhost:4001 user@server
ssh -L 6381:localhost:6381 user@server

# Now access locally
curl http://localhost:4000/api/v1/health
```

## Load Balancer Configuration

### Nginx
```nginx
upstream mcp_backend {
    server 127.0.0.1:4000;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://mcp_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### HAProxy
```
frontend mcp_frontend
    bind *:80
    default_backend mcp_servers

backend mcp_servers
    server backend1 127.0.0.1:4000 check
```

---

Last Updated: 2025-09-13
Version: 1.0.0