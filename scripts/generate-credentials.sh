#!/bin/bash

# ⭐️ Generate Secure Credentials for MCP Server

echo "⭐️ Generating secure credentials for MCP Server..."
echo ""

# Function to generate random password
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
}

# Function to generate JWT secret
generate_jwt_secret() {
    openssl rand -hex 64
}

# Check if .env exists
if [ -f ".env" ]; then
    echo "⚠️  .env file already exists!"
    read -p "Do you want to backup and regenerate? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
        echo "✅ Backup created"
    else
        echo "❌ Aborted"
        exit 1
    fi
fi

# Generate credentials
JWT_SECRET=$(generate_jwt_secret)
REDIS_PASSWORD=$(generate_password)
SCYLLA_PASSWORD=$(generate_password)
ELASTICSEARCH_PASSWORD=$(generate_password)
GRAFANA_PASSWORD=$(generate_password)

# Create new .env with secure credentials
cat > .env << EOF
# =================
# ⭐️ MCP Server Configuration
# Generated: $(date)
# =================

# Application Environment
NODE_ENV=production

# =================
# Service Ports
# =================

# API Backend Port
API_PORT=3000

# Frontend Port
FRONTEND_PORT=3002

# Redis Cache Port
REDIS_PORT=6379

# ScyllaDB Ports
SCYLLA_PORT=9042
SCYLLA_API_PORT=10000

# Elasticsearch Ports
ELASTIC_PORT=9200
ELASTIC_TRANSPORT_PORT=9300

# Monitoring Ports
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001

# =================
# Authentication & Security
# =================

# JWT Configuration - Generated Secure Key
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# =================
# Database Configuration
# =================

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT_INTERNAL=6379
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
REDIS_MAX_MEMORY=2gb
REDIS_MAX_MEMORY_POLICY=allkeys-lru

# ScyllaDB Configuration
SCYLLA_HOST=scylladb
SCYLLA_PORT_INTERNAL=9042
SCYLLA_CONTACT_POINTS=scylladb
SCYLLA_KEYSPACE=mcp_memory
SCYLLA_USERNAME=cassandra
SCYLLA_PASSWORD=${SCYLLA_PASSWORD}
SCYLLA_DATACENTER=datacenter1
SCYLLA_REPLICATION_FACTOR=1

# Elasticsearch Configuration
ELASTICSEARCH_HOST=elasticsearch
ELASTICSEARCH_PORT_INTERNAL=9200
ELASTICSEARCH_NODE=http://elasticsearch:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=${ELASTICSEARCH_PASSWORD}
ELASTICSEARCH_INDEX=mcp_notes
ELASTICSEARCH_MAX_RESULT_WINDOW=10000

# =================
# Monitoring & Analytics
# =================

# Grafana Configuration
GRAFANA_USER=admin
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}

# Prometheus Configuration
PROMETHEUS_RETENTION=30d
PROMETHEUS_SCRAPE_INTERVAL=15s

# =================
# Application Features
# =================

# File Upload Configuration
MAX_FILE_SIZE=10485760
UPLOAD_PATH=./uploads

# Rate Limiting per Tier
RATE_LIMIT_BASIC_WINDOW_MS=60000
RATE_LIMIT_BASIC_MAX=1000

RATE_LIMIT_PRO_WINDOW_MS=60000
RATE_LIMIT_PRO_MAX=10000

RATE_LIMIT_ENTERPRISE_WINDOW_MS=60000
RATE_LIMIT_ENTERPRISE_MAX=100000

# Logging Configuration
LOG_LEVEL=info
LOG_FORMAT=json
LOG_PATH=./logs

# Backup Configuration
BACKUP_PATH=./backups
BACKUP_RETENTION_DAYS=30
BACKUP_SCHEDULE="0 2 * * *"

# =================
# Performance Tuning
# =================

# Connection Pool Settings
REDIS_POOL_SIZE=10
SCYLLA_POOL_SIZE=10
ELASTIC_POOL_SIZE=10

# Timeout Settings (ms)
DATABASE_TIMEOUT=5000
API_TIMEOUT=30000
SEARCH_TIMEOUT=10000

# Cache TTL (seconds)
CACHE_TTL_SHORT=300
CACHE_TTL_MEDIUM=3600
CACHE_TTL_LONG=86400

# =================
# External Services (Optional)
# =================

# OpenAI API (for embeddings generation)
OPENAI_API_KEY=
OPENAI_MODEL=text-embedding-ada-002
OPENAI_EMBEDDING_DIMENSION=1536

# Vector Database (if using external)
VECTOR_DB_URL=
VECTOR_DB_API_KEY=

# =================
# Development & Testing
# =================

# Enable debugging
DEBUG=false

# Test database configurations
TEST_REDIS_PORT=6380
TEST_SCYLLA_PORT=9043
TEST_ELASTIC_PORT=9201

# Mock external services in development
MOCK_EXTERNAL_SERVICES=false

# =================
# Docker Configuration
# =================

# Container Resource Limits
REDIS_MEMORY_LIMIT=2g
SCYLLA_MEMORY_LIMIT=4g
ELASTIC_MEMORY_LIMIT=2g
BACKEND_MEMORY_LIMIT=1g

# Volume Paths
VOLUMES_BASE_PATH=./docker/volumes

# Network Configuration
DOCKER_NETWORK_NAME=mcp-network
DOCKER_NETWORK_SUBNET=172.20.0.0/16
EOF

echo "✅ Secure credentials generated!"
echo ""
echo "📋 Generated Passwords:"
echo "------------------------"
echo "JWT Secret: ${JWT_SECRET:0:20}..."
echo "Redis: ${REDIS_PASSWORD}"
echo "ScyllaDB: ${SCYLLA_PASSWORD}"
echo "Elasticsearch: ${ELASTICSEARCH_PASSWORD}"
echo "Grafana: ${GRAFANA_PASSWORD}"
echo ""
echo "⚠️  IMPORTANT: Save these credentials in a secure location!"
echo "⚠️  The .env file contains sensitive information - do not commit to git!"
echo ""
echo "✅ Configuration complete. You can now run:"
echo "   docker-compose up -d"