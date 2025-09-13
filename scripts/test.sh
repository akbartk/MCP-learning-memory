#!/bin/bash

# ⭐️ MCP Server - Test Script
# Runs various test suites

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "⭐️ MCP Server - Test Runner"
echo "============================"
echo ""

# Parse arguments
TEST_TYPE=${1:-"all"}

# Function to run tests
run_test() {
    local TEST_NAME=$1
    local TEST_CMD=$2

    echo -e "${BLUE}Running $TEST_NAME...${NC}"
    if eval $TEST_CMD; then
        echo -e "${GREEN}✅ $TEST_NAME passed${NC}"
        return 0
    else
        echo -e "${RED}❌ $TEST_NAME failed${NC}"
        return 1
    fi
    echo ""
}

# Check if services are running
check_services() {
    echo "Checking if services are running..."

    if ! docker ps | grep -q "mcp-redis"; then
        echo -e "${YELLOW}⚠️  Services not running. Starting test environment...${NC}"
        ./scripts/start.sh test
        sleep 10
    else
        echo -e "${GREEN}✅ Services are running${NC}"
    fi
    echo ""
}

# Health check
health_check() {
    echo "Performing health check..."

    # Check Redis
    if docker exec mcp-redis-test redis-cli ping > /dev/null 2>&1; then
        echo -e "  Redis:         ${GREEN}✅ healthy${NC}"
    else
        echo -e "  Redis:         ${RED}❌ unhealthy${NC}"
        return 1
    fi

    # Check ScyllaDB
    if docker exec mcp-scylladb-test cqlsh -e "SELECT now() FROM system.local" > /dev/null 2>&1; then
        echo -e "  ScyllaDB:      ${GREEN}✅ healthy${NC}"
    else
        echo -e "  ScyllaDB:      ${RED}❌ unhealthy${NC}"
        return 1
    fi

    # Check Elasticsearch
    if curl -s http://localhost:9200/_cluster/health > /dev/null 2>&1; then
        echo -e "  Elasticsearch: ${GREEN}✅ healthy${NC}"
    else
        echo -e "  Elasticsearch: ${RED}❌ unhealthy${NC}"
        return 1
    fi

    echo ""
    return 0
}

# API endpoint test
api_test() {
    echo "Testing API endpoints..."

    # Test health endpoint
    echo -n "  /health endpoint: "
    if curl -s http://localhost:3000/api/v1/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
    else
        echo -e "${YELLOW}⚠️  API not running${NC}"
        return 1
    fi

    # Test metrics endpoint
    echo -n "  /metrics endpoint: "
    if curl -s http://localhost:3000/api/v1/metrics > /dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
    else
        echo -e "${YELLOW}⚠️${NC}"
    fi

    echo ""
    return 0
}

# Run development tests with mock databases
dev_test() {
    echo "Running development tests (mock databases)..."
    cd backend
    if [ -f "tests/run-development-tests.js" ]; then
        npm run test:dev
    else
        echo -e "${YELLOW}⚠️  Development tests not found${NC}"
    fi
    cd ..
}

# Run integration tests
integration_test() {
    echo "Running integration tests..."
    cd backend
    npm run test:integration
    cd ..
}

# Run contract tests
contract_test() {
    echo "Running contract tests..."
    cd backend
    npm run test:contract
    cd ..
}

# Performance test
performance_test() {
    echo "Running basic performance test..."

    # Simple load test using curl
    echo "  Sending 100 requests to /health endpoint..."

    TOTAL_TIME=0
    SUCCESS=0
    FAILED=0

    for i in {1..100}; do
        START=$(date +%s%N)
        if curl -s http://localhost:3000/api/v1/health > /dev/null 2>&1; then
            SUCCESS=$((SUCCESS + 1))
        else
            FAILED=$((FAILED + 1))
        fi
        END=$(date +%s%N)
        ELAPSED=$((($END - $START) / 1000000))
        TOTAL_TIME=$((TOTAL_TIME + ELAPSED))
    done

    AVG_TIME=$((TOTAL_TIME / 100))

    echo "  Results:"
    echo "    • Successful: $SUCCESS/100"
    echo "    • Failed:     $FAILED/100"
    echo "    • Avg time:   ${AVG_TIME}ms"

    if [ $AVG_TIME -lt 100 ]; then
        echo -e "    • Performance: ${GREEN}✅ Excellent (<100ms)${NC}"
    elif [ $AVG_TIME -lt 200 ]; then
        echo -e "    • Performance: ${YELLOW}⚠️  Good (<200ms)${NC}"
    else
        echo -e "    • Performance: ${RED}❌ Needs improvement (>200ms)${NC}"
    fi

    echo ""
}

# Main execution
main() {
    FAILED_TESTS=0

    case $TEST_TYPE in
        "health")
            check_services
            health_check || FAILED_TESTS=$((FAILED_TESTS + 1))
            ;;
        "api")
            check_services
            api_test || FAILED_TESTS=$((FAILED_TESTS + 1))
            ;;
        "dev")
            dev_test || FAILED_TESTS=$((FAILED_TESTS + 1))
            ;;
        "integration")
            check_services
            integration_test || FAILED_TESTS=$((FAILED_TESTS + 1))
            ;;
        "contract")
            contract_test || FAILED_TESTS=$((FAILED_TESTS + 1))
            ;;
        "performance")
            check_services
            performance_test || FAILED_TESTS=$((FAILED_TESTS + 1))
            ;;
        "all")
            check_services
            health_check || FAILED_TESTS=$((FAILED_TESTS + 1))
            api_test || FAILED_TESTS=$((FAILED_TESTS + 1))
            dev_test || FAILED_TESTS=$((FAILED_TESTS + 1))
            performance_test || FAILED_TESTS=$((FAILED_TESTS + 1))
            ;;
        *)
            echo "Usage: $0 [health|api|dev|integration|contract|performance|all]"
            echo ""
            echo "Test types:"
            echo "  health      - Check if all services are healthy"
            echo "  api         - Test API endpoints"
            echo "  dev         - Run development tests with mock databases"
            echo "  integration - Run integration tests"
            echo "  contract    - Run contract tests"
            echo "  performance - Run basic performance test"
            echo "  all         - Run all tests (default)"
            exit 1
            ;;
    esac

    echo "============================"
    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "${GREEN}✅ All tests passed!${NC}"
        echo "⭐️ MCP Server is working correctly"
    else
        echo -e "${RED}❌ $FAILED_TESTS test(s) failed${NC}"
        echo "Please check the logs for details"
        exit 1
    fi
}

main