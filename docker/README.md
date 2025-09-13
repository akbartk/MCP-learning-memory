# ⭐️ Docker Configuration for MCP Server

## Overview

Konfigurasi Docker Compose untuk MCP Server dengan security best practices dan centralized credential management.

## Services

### 1. **Redis** (Cache Layer)
- Port: 6379
- Authentication: Password protected
- Memory: 2GB limit dengan LRU eviction
- Persistence: AOF dan RDB snapshots

### 2. **ScyllaDB** (Primary Storage)
- Port: 9042 (CQL), 10000 (API)
- Authentication: Username/password
- Memory: 4GB limit
- Replication: SimpleStrategy dengan factor 1

### 3. **Elasticsearch** (Semantic Search)
- Port: 9200, 9300
- Security: X-Pack enabled dengan authentication
- Memory: 2GB (1GB heap)
- Features: Full-text search, vector similarity

### 4. **Backend API**
- Port: 3000
- Authentication: JWT dengan refresh tokens
- Rate limiting: Tier-based (Basic/Pro/Enterprise)
- Connection pooling untuk semua databases

### 5. **Monitoring Stack**
- **Prometheus**: Metrics collection (port 9090)
- **Grafana**: Visualization dashboard (port 3001)
- **Frontend**: Custom monitoring UI (port 3002)

## Security Features

### Authentication & Authorization
- ✅ Password protection untuk semua databases
- ✅ JWT tokens dengan expiration
- ✅ API key management
- ✅ Rate limiting per tier

### Network Security
- ✅ Isolated Docker network
- ✅ Service-to-service communication internal
- ✅ Health checks untuk semua services
- ✅ TLS/SSL ready configuration

### Data Security
- ✅ Encrypted passwords di .env
- ✅ Volume mounts untuk persistence
- ✅ Backup service (optional)
- ✅ Automatic data retention policies

## Setup Instructions

### 1. Generate Secure Credentials

```bash
# Generate secure passwords dan JWT secret
./scripts/generate-credentials.sh
```

### 2. Create Required Directories

```bash
# Create volume directories
mkdir -p docker/volumes/{redis,scylladb,elasticsearch,prometheus,grafana,uploads,logs,backups}

# Set permissions
chmod -R 755 docker/volumes
```

### 3. Start Services

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f [service-name]
```

### 4. Initialize Databases

```bash
# Wait for services to be ready
docker-compose exec backend npm run db:init

# Or manually:
docker-compose exec scylladb cqlsh -u cassandra -p ${SCYLLA_PASSWORD} -f /docker-entrypoint-initdb.d/init.cql
```

## Environment Variables

All credentials are centralized in `.env` file:

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing key | Generated |
| `REDIS_PASSWORD` | Redis auth password | Generated |
| `SCYLLA_PASSWORD` | ScyllaDB password | Generated |
| `ELASTICSEARCH_PASSWORD` | Elastic password | Generated |
| `GRAFANA_PASSWORD` | Grafana admin password | Generated |

## Performance Tuning

### Redis
```env
REDIS_MAX_MEMORY=2gb
REDIS_MAX_MEMORY_POLICY=allkeys-lru
REDIS_POOL_SIZE=10
```

### ScyllaDB
```env
SCYLLA_MEMORY_LIMIT=4g
SCYLLA_POOL_SIZE=10
SCYLLA_REPLICATION_FACTOR=1
```

### Elasticsearch
```env
ELASTIC_MEMORY_LIMIT=2g
ELASTIC_POOL_SIZE=10
ELASTICSEARCH_MAX_RESULT_WINDOW=10000
```

## Monitoring

### Access Points
- **Grafana**: http://localhost:3001 (admin/password dari .env)
- **Prometheus**: http://localhost:9090
- **API Metrics**: http://localhost:3000/api/v1/metrics
- **Health Check**: http://localhost:3000/api/v1/health

### Key Metrics
- Request latency (P50, P95, P99)
- Throughput (requests/sec)
- Error rate
- Database connection pool usage
- Cache hit rate
- Memory usage per service

## Backup & Recovery

### Manual Backup
```bash
# Backup all data
docker-compose exec backup /backup.sh

# Backup specific service
docker exec mcp-redis redis-cli -a ${REDIS_PASSWORD} BGSAVE
docker exec mcp-scylladb nodetool snapshot
```

### Automated Backup
Enable backup service in docker-compose:
```bash
docker-compose --profile backup up -d
```

## Troubleshooting

### Check Service Health
```bash
# Check all services
docker-compose ps

# Check specific service logs
docker-compose logs -f redis
docker-compose logs -f scylladb
docker-compose logs -f elasticsearch

# Check health status
docker inspect mcp-redis | jq '.[0].State.Health'
```

### Common Issues

#### Port Already in Use
```bash
# Change port in .env file
REDIS_PORT=6380
ELASTIC_PORT=9201
```

#### Memory Issues
```bash
# Increase memory limits in .env
REDIS_MEMORY_LIMIT=4g
ELASTIC_MEMORY_LIMIT=4g
```

#### Authentication Failed
```bash
# Regenerate credentials
./scripts/generate-credentials.sh
docker-compose down
docker-compose up -d
```

## Production Deployment

### Recommendations
1. **Use Docker Swarm or Kubernetes** for orchestration
2. **Enable TLS/SSL** for all services
3. **Set up monitoring alerts** in Grafana
4. **Configure log aggregation** (ELK stack)
5. **Implement backup rotation** policy
6. **Use external volume storage** for production data
7. **Set up load balancer** for API endpoints
8. **Configure firewall rules** for ports

### Scaling
```yaml
# docker-compose.override.yml for scaling
services:
  backend:
    deploy:
      replicas: 3
```

## Security Checklist

- [ ] Changed default passwords
- [ ] Enabled authentication on all services
- [ ] Configured firewall rules
- [ ] Set up SSL certificates
- [ ] Implemented rate limiting
- [ ] Configured backup encryption
- [ ] Set up monitoring alerts
- [ ] Reviewed log retention policies
- [ ] Tested disaster recovery plan
- [ ] Documented access procedures

## Support

For issues or questions:
1. Check service logs: `docker-compose logs [service]`
2. Verify .env configuration
3. Ensure all ports are available
4. Check system resources (RAM, disk space)

---

Last Updated: 2025-09-13
Version: 1.0.0