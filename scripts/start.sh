#!/bin/bash

# ⭐️ MCP Server - Start Script
# Starts all services using Docker Compose

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "⭐️ Starting MCP Server Learning-AI + Memory"
echo "==========================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Please run ./scripts/setup.sh first"
    exit 1
fi

# Select environment
if [ "$1" == "test" ]; then
    echo "Starting TEST environment (lightweight)..."
    COMPOSE_FILE="docker-compose.test.yml"
elif [ "$1" == "dev" ]; then
    echo "Starting DEVELOPMENT environment..."
    COMPOSE_FILE="docker-compose.yml"
else
    echo "Starting PRODUCTION environment..."
    COMPOSE_FILE="docker-compose.yml"
fi

# Start services
echo "Starting Docker services..."
docker-compose -f $COMPOSE_FILE up -d

# Wait for services to be healthy
echo ""
echo "Waiting for services to be healthy..."
SERVICES=("redis" "scylladb" "elasticsearch")
MAX_WAIT=60
WAIT_TIME=0

for SERVICE in "${SERVICES[@]}"; do
    echo -n "  Checking $SERVICE..."
    while [ $WAIT_TIME -lt $MAX_WAIT ]; do
        if docker-compose -f $COMPOSE_FILE ps | grep $SERVICE | grep -q "healthy"; then
            echo -e " ${GREEN}✅ healthy${NC}"
            break
        fi
        sleep 2
        WAIT_TIME=$((WAIT_TIME + 2))
        echo -n "."
    done

    if [ $WAIT_TIME -ge $MAX_WAIT ]; then
        echo -e " ${RED}❌ timeout${NC}"
        echo "Service $SERVICE failed to become healthy"
        echo "Check logs: docker-compose -f $COMPOSE_FILE logs $SERVICE"
        exit 1
    fi
    WAIT_TIME=0
done

# Initialize databases if needed
if [ ! -f .initialized ]; then
    echo ""
    echo "First time setup detected. Initializing databases..."
    sleep 5
    ./scripts/init-db.sh
    touch .initialized
fi

# Show status
echo ""
echo "==========================================="
echo -e "${GREEN}✅ All services started successfully!${NC}"
echo ""
echo "Services running at:"
echo "  • API Backend:    http://localhost:3000"
echo "  • Monitoring:     http://localhost:3002"
echo "  • Grafana:        http://localhost:3001 (admin/admin)"
echo "  • Redis:          localhost:6379"
echo "  • ScyllaDB:       localhost:9042"
echo "  • Elasticsearch:  http://localhost:9200"
echo ""
echo "Useful commands:"
echo "  • View logs:      docker-compose -f $COMPOSE_FILE logs -f"
echo "  • Stop services:  ./scripts/stop.sh"
echo "  • Run tests:      ./scripts/test.sh"
echo "  • Health check:   ./scripts/health.sh"
echo ""
echo "⭐️ MCP Server is ready!"