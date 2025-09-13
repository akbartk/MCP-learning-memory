#!/bin/bash

# ⭐️ MCP Server - Health Check Script
# Checks the health status of all services

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "⭐️ MCP Server - Health Check"
echo "============================="
echo ""

# Function to check service health
check_service() {
    local SERVICE_NAME=$1
    local CHECK_CMD=$2

    echo -n "  $SERVICE_NAME: "
    if eval $CHECK_CMD > /dev/null 2>&1; then
        echo -e "${GREEN}✅ healthy${NC}"
        return 0
    else
        echo -e "${RED}❌ unhealthy${NC}"
        return 1
    fi
}

# Check Docker services
echo "Docker Services:"
echo "----------------"

UNHEALTHY=0

# Redis
check_service "Redis Cache" "docker exec mcp-redis-test redis-cli ping" || UNHEALTHY=$((UNHEALTHY + 1))

# ScyllaDB
check_service "ScyllaDB" "docker exec mcp-scylladb-test cqlsh -e 'SELECT now() FROM system.local'" || UNHEALTHY=$((UNHEALTHY + 1))

# Elasticsearch
check_service "Elasticsearch" "curl -s http://localhost:9200/_cluster/health" || UNHEALTHY=$((UNHEALTHY + 1))

echo ""

# Check API endpoints
echo "API Endpoints:"
echo "--------------"

# Health endpoint
check_service "Health API" "curl -s http://localhost:3000/api/v1/health" || UNHEALTHY=$((UNHEALTHY + 1))

# Metrics endpoint
check_service "Metrics API" "curl -s http://localhost:3000/api/v1/metrics" || UNHEALTHY=$((UNHEALTHY + 1))

echo ""

# Check resource usage
echo "Resource Usage:"
echo "---------------"

# Get container stats
echo "  Container Stats:"
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep mcp- | sed 's/^/    /'

echo ""

# Check disk usage
echo "  Disk Usage:"
echo -n "    Data volumes: "
du -sh docker/volumes 2>/dev/null | cut -f1 || echo "N/A"

echo ""

# Performance metrics (if API is running)
if curl -s http://localhost:3000/api/v1/metrics > /dev/null 2>&1; then
    echo "Performance Metrics:"
    echo "--------------------"

    METRICS=$(curl -s http://localhost:3000/api/v1/metrics)

    if [ ! -z "$METRICS" ]; then
        echo "  (Retrieved from API)"
        # Parse JSON metrics (simplified)
        echo "$METRICS" | grep -o '"queries_per_second":[0-9.]*' | sed 's/"queries_per_second":/  Queries\/sec: /'
        echo "$METRICS" | grep -o '"average_response_time_ms":[0-9.]*' | sed 's/"average_response_time_ms":/  Avg Response: /; s/$/ ms/'
        echo "$METRICS" | grep -o '"cache_hit_rate":[0-9.]*' | sed 's/"cache_hit_rate":/  Cache Hit Rate: /; s/$/%/'
    fi
    echo ""
fi

# Summary
echo "============================="
if [ $UNHEALTHY -eq 0 ]; then
    echo -e "${GREEN}✅ All services are healthy!${NC}"
    echo ""
    echo "Dashboard URLs:"
    echo "  • API Docs:    http://localhost:3000/api-docs"
    echo "  • Monitoring:  http://localhost:3002"
    echo "  • Grafana:     http://localhost:3001"
    echo ""
    echo "⭐️ System is ready for use!"
else
    echo -e "${RED}❌ $UNHEALTHY service(s) unhealthy${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  • Check logs: docker-compose logs [service-name]"
    echo "  • Restart services: ./scripts/stop.sh && ./scripts/start.sh"
    echo "  • Check ports: lsof -i :3000,6379,9042,9200"
    exit 1
fi