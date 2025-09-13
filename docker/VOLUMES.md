# ⭐️ Docker Volume Management Guide

## Overview

MCP Server menggunakan dua strategi volume management berbeda untuk production dan testing.

## Volume Strategies

### 1. Production (`docker-compose.yml`)

Menggunakan **Named Volumes** untuk better isolation dan management:

```yaml
volumes:
  redis-data:
    driver: local
  scylladb-data:
    driver: local
  elasticsearch-data:
    driver: local
```

**Keuntungan:**
- ✅ Managed by Docker
- ✅ Better isolation
- ✅ Automatic cleanup dengan `docker-compose down -v`
- ✅ Better performance
- ✅ Portable across systems

**Lokasi data:**
- Linux: `/var/lib/docker/volumes/[volume_name]/_data`
- Akses dengan: `docker volume inspect [volume_name]`

### 2. Testing (`docker-compose.test.yml`)

Menggunakan **Bind Mounts** untuk easier access dan debugging:

```yaml
volumes:
  - ./docker/volumes/test/redis:/data
  - ./docker/volumes/test/scylladb:/var/lib/scylla
  - ./docker/volumes/test/elasticsearch:/usr/share/elasticsearch/data
```

**Keuntungan:**
- ✅ Direct file access dari host
- ✅ Easy debugging dan inspection
- ✅ Quick cleanup dengan `rm -rf`
- ✅ Version control friendly (dapat exclude di .gitignore)
- ✅ Easy backup dengan standard tools

**Lokasi data:**
- `./docker/volumes/test/[service]/`

## Directory Structure

```
docker/volumes/
├── test/                    # Test environment data
│   ├── redis/
│   │   └── .gitkeep
│   ├── scylladb/
│   │   └── .gitkeep
│   └── elasticsearch/
│       └── .gitkeep
├── redis/                   # Production data (if using bind mounts)
├── scylladb/
├── elasticsearch/
├── prometheus/
├── grafana/
├── uploads/                 # Application uploads
├── logs/                    # Application logs
└── backups/                 # Backup files
```

## Commands

### Production Volumes

```bash
# List all volumes
docker volume ls

# Inspect volume
docker volume inspect mcp-network_redis-data

# Clean unused volumes
docker volume prune

# Remove specific volume
docker volume rm mcp-network_redis-data

# Backup volume
docker run --rm -v mcp-network_redis-data:/source -v $(pwd):/backup alpine tar czf /backup/redis-backup.tar.gz -C /source .
```

### Test Volumes (Bind Mounts)

```bash
# Check data size
du -sh docker/volumes/test/*

# Clear test data
rm -rf docker/volumes/test/redis/*
rm -rf docker/volumes/test/scylladb/*
rm -rf docker/volumes/test/elasticsearch/*

# Backup test data
tar -czf test-data-backup.tar.gz docker/volumes/test/

# Restore test data
tar -xzf test-data-backup.tar.gz
```

## Permissions

### Setting Correct Permissions

```bash
# For test volumes
chmod -R 755 docker/volumes/test

# For Elasticsearch (requires specific UID)
chown -R 1000:1000 docker/volumes/test/elasticsearch

# For ScyllaDB
chown -R 999:999 docker/volumes/test/scylladb
```

## Troubleshooting

### Permission Denied

```bash
# Fix Elasticsearch permission issues
sudo chown -R 1000:1000 docker/volumes/test/elasticsearch

# Alternative: run container as root (not recommended for production)
user: root
```

### Disk Space Issues

```bash
# Check volume sizes
docker system df

# Clean all unused data
docker system prune -a --volumes

# Check bind mount sizes
du -sh docker/volumes/test/*
```

### Data Corruption

```bash
# For test environment - simply recreate
docker-compose -f docker-compose.test.yml down
rm -rf docker/volumes/test/*
docker-compose -f docker-compose.test.yml up -d

# For production - restore from backup
docker-compose down
docker volume rm mcp-network_redis-data
docker volume create mcp-network_redis-data
docker run --rm -v mcp-network_redis-data:/target -v $(pwd):/backup alpine tar xzf /backup/redis-backup.tar.gz -C /target
docker-compose up -d
```

## Best Practices

### Development/Testing
1. Use **bind mounts** for easy access
2. Clear data regularly to test fresh installs
3. Keep test data small
4. Use `.gitignore` to exclude data files

### Production
1. Use **named volumes** for better isolation
2. Regular backups dengan automated scripts
3. Monitor disk usage
4. Use volume drivers for cloud storage (optional)

### Hybrid Approach

Untuk flexibility, bisa gunakan environment variable:

```yaml
# docker-compose.yml
volumes:
  - ${REDIS_VOLUME:-redis-data}:/data

# .env for production
REDIS_VOLUME=redis-data  # named volume

# .env.test for testing
REDIS_VOLUME=./docker/volumes/test/redis  # bind mount
```

## Migration Guide

### From Named Volume to Bind Mount

```bash
# 1. Backup named volume
docker run --rm -v mcp-network_redis-data:/source -v $(pwd):/backup alpine tar czf /backup/redis-data.tar.gz -C /source .

# 2. Stop container
docker-compose down

# 3. Extract to bind mount location
mkdir -p docker/volumes/redis
tar -xzf redis-data.tar.gz -C docker/volumes/redis/

# 4. Update docker-compose.yml
# Change: redis-data:/data
# To: ./docker/volumes/redis:/data

# 5. Start with new configuration
docker-compose up -d
```

### From Bind Mount to Named Volume

```bash
# 1. Create named volume
docker volume create redis-data

# 2. Copy data to volume
docker run --rm -v $(pwd)/docker/volumes/redis:/source -v redis-data:/target alpine cp -r /source/. /target/

# 3. Update docker-compose.yml
# Change: ./docker/volumes/redis:/data
# To: redis-data:/data

# 4. Add volume definition
volumes:
  redis-data:

# 5. Restart
docker-compose up -d
```

## Summary

| Aspect | Named Volumes | Bind Mounts |
|--------|--------------|-------------|
| **Best for** | Production | Development/Testing |
| **Location** | Docker managed | Project directory |
| **Performance** | Better | Good |
| **Backup** | Docker commands | Standard tools |
| **Debugging** | Harder | Easier |
| **Cleanup** | `docker volume rm` | `rm -rf` |
| **Portability** | High | Medium |
| **Version Control** | Not applicable | Can exclude |

Choose based on your needs:
- **Production**: Named volumes for isolation and performance
- **Testing**: Bind mounts for accessibility and debugging
- **Development**: Bind mounts for rapid iteration

---

Last Updated: 2025-09-13
Version: 1.0.0