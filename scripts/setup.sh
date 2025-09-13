#!/bin/bash

# ⭐️ MCP Server - Setup Script
# Prepares the environment for first-time setup

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "⭐️ MCP Server Learning-AI + Memory - Setup Script"
echo "=================================================="
echo ""

# Function to print colored messages
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check prerequisites
echo "Checking prerequisites..."

# Check Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi
print_success "Docker found"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi
print_success "Docker Compose found"

# Check Node.js (optional for local development)
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    print_success "Node.js found: $NODE_VERSION"
else
    print_warning "Node.js not found (optional for local development)"
fi

# Create necessary directories
echo ""
echo "Creating directory structure..."
mkdir -p docker/volumes/{redis,scylladb,elasticsearch,prometheus,grafana}
mkdir -p logs
mkdir -p data/backups
print_success "Directories created"

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "Creating .env file from template..."
    if [ -f .env.example ]; then
        cp .env.example .env
        print_success ".env file created from .env.example"
        print_warning "Please edit .env file with your configuration"
    else
        print_error ".env.example not found"
        exit 1
    fi
else
    print_success ".env file already exists"
fi

# Generate JWT secret if not set
if grep -q "^JWT_SECRET=$" .env || grep -q "^JWT_SECRET=your-secret-key-here$" .env; then
    echo ""
    echo "Generating JWT secret..."
    JWT_SECRET=$(openssl rand -base64 32)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    else
        # Linux
        sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    fi
    print_success "JWT secret generated and saved to .env"
fi

# Check port availability
echo ""
echo "Checking port availability..."
PORTS=(3000 3001 3002 6379 9042 9200 9090)
PORTS_IN_USE=()

for PORT in "${PORTS[@]}"; do
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 || netstat -tuln 2>/dev/null | grep -q ":$PORT "; then
        PORTS_IN_USE+=($PORT)
    fi
done

if [ ${#PORTS_IN_USE[@]} -gt 0 ]; then
    print_error "The following ports are already in use: ${PORTS_IN_USE[*]}"
    print_warning "Please free these ports or update the port configuration in .env"
    echo ""
    echo "You can find which process is using a port with:"
    echo "  lsof -i :PORT_NUMBER"
    echo ""
    read -p "Do you want to continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    print_success "All required ports are available"
fi

# Pull Docker images
echo ""
echo "Pulling Docker images (this may take a few minutes)..."
docker-compose -f docker-compose.test.yml pull
print_success "Docker images pulled"

# Initialize backend
echo ""
echo "Initializing backend..."
cd backend
if [ ! -d "node_modules" ]; then
    if command -v npm &> /dev/null; then
        echo "Installing Node.js dependencies..."
        npm install
        print_success "Backend dependencies installed"
    else
        print_warning "Skipping npm install (Node.js not found)"
        print_warning "Backend will be built inside Docker container"
    fi
else
    print_success "Backend dependencies already installed"
fi
cd ..

# Initialize frontend
echo ""
echo "Initializing frontend..."
cd frontend
if [ ! -d "node_modules" ]; then
    if command -v npm &> /dev/null; then
        echo "Installing React dependencies..."
        npm install
        print_success "Frontend dependencies installed"
    else
        print_warning "Skipping npm install (Node.js not found)"
        print_warning "Frontend will be built inside Docker container"
    fi
else
    print_success "Frontend dependencies already installed"
fi
cd ..

# Create initial database schema script
echo ""
echo "Creating database initialization script..."
cat > scripts/init-db.sh << 'EOF'
#!/bin/bash
# Initialize databases

echo "Waiting for ScyllaDB to be ready..."
sleep 10

# Create keyspace for ScyllaDB
docker exec mcp-scylladb-test cqlsh -e "
CREATE KEYSPACE IF NOT EXISTS mcp_server
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE mcp_server;

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY,
    agent_id TEXT,
    session_id UUID,
    timestamp TIMESTAMP,
    type TEXT,
    context TEXT,
    content TEXT,
    embeddings LIST<FLOAT>,
    metadata TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ON notes (agent_id);
CREATE INDEX IF NOT EXISTS ON notes (timestamp);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email TEXT,
    organization TEXT,
    subscription TEXT,
    api_keys TEXT,
    usage TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ON users (email);
"

echo "✅ ScyllaDB initialized"

# Create Elasticsearch index
curl -X PUT "localhost:9200/notes" -H 'Content-Type: application/json' -d'
{
  "mappings": {
    "properties": {
      "agent_id": { "type": "keyword" },
      "content": { "type": "text" },
      "embeddings": {
        "type": "dense_vector",
        "dims": 768,
        "index": true,
        "similarity": "cosine"
      },
      "timestamp": { "type": "date" }
    }
  }
}'

echo "✅ Elasticsearch initialized"
EOF

chmod +x scripts/init-db.sh
print_success "Database initialization script created"

echo ""
echo "=================================================="
print_success "Setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Review and edit the .env file with your configuration"
echo "2. Start the services: ./scripts/start.sh"
echo "3. Initialize databases: ./scripts/init-db.sh"
echo "4. Run tests: ./scripts/test.sh"
echo "5. Access the dashboard: http://localhost:3002"
echo ""
echo "For more information, see README.md"
echo "⭐️ Happy coding!"