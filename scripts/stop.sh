#!/bin/bash

# ⭐️ MCP Server - Stop Script
# Stops all running services

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "⭐️ Stopping MCP Server"
echo "======================"
echo ""

# Check which compose file to use
if docker-compose -f docker-compose.test.yml ps 2>/dev/null | grep -q "mcp-"; then
    COMPOSE_FILE="docker-compose.test.yml"
    echo "Stopping TEST environment..."
elif docker-compose ps 2>/dev/null | grep -q "mcp-"; then
    COMPOSE_FILE="docker-compose.yml"
    echo "Stopping PRODUCTION environment..."
else
    echo -e "${YELLOW}⚠️  No running services found${NC}"
    exit 0
fi

# Stop services
docker-compose -f $COMPOSE_FILE down

echo ""
echo -e "${GREEN}✅ All services stopped${NC}"
echo ""

# Ask about data cleanup
read -p "Do you want to remove data volumes? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Removing data volumes..."
    docker-compose -f $COMPOSE_FILE down -v
    rm -f .initialized
    echo -e "${GREEN}✅ Data volumes removed${NC}"
else
    echo "Data volumes preserved"
fi

echo ""
echo "⭐️ MCP Server stopped"