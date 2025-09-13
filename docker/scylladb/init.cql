-- ⭐️ ScyllaDB Initialization Script for MCP Server

-- Create keyspace with replication
CREATE KEYSPACE IF NOT EXISTS mcp_memory
WITH replication = {
  'class': 'SimpleStrategy',
  'replication_factor': 1
} AND durable_writes = true;

USE mcp_memory;

-- Notes table for storing AI learning data
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY,
  agent_id TEXT,
  content TEXT,
  context TEXT,
  metadata MAP<TEXT, TEXT>,
  embeddings LIST<FLOAT>,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  version INT
) WITH compression = {'sstable_compression': 'LZ4Compressor'}
  AND caching = {'keys': 'ALL', 'rows_per_partition': 'ALL'}
  AND gc_grace_seconds = 864000;

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_notes_agent_id ON notes (agent_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes (created_at);

-- Knowledge table for aggregated insights
CREATE TABLE IF NOT EXISTS knowledge (
  id UUID PRIMARY KEY,
  agent_id TEXT,
  domain TEXT,
  category TEXT,
  key TEXT,
  value TEXT,
  confidence FLOAT,
  source_notes LIST<UUID>,
  metadata MAP<TEXT, TEXT>,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  status TEXT
) WITH compression = {'sstable_compression': 'LZ4Compressor'}
  AND caching = {'keys': 'ALL', 'rows_per_partition': 'ALL'};

-- Create indexes for knowledge queries
CREATE INDEX IF NOT EXISTS idx_knowledge_agent_id ON knowledge (agent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_domain ON knowledge (domain);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge (category);
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge (status);

-- Experience table for learning journey tracking
CREATE TABLE IF NOT EXISTS experiences (
  id UUID PRIMARY KEY,
  agent_id TEXT,
  session_id UUID,
  type TEXT,
  outcome TEXT,
  learning_points LIST<TEXT>,
  context_before TEXT,
  context_after TEXT,
  metadata MAP<TEXT, TEXT>,
  created_at TIMESTAMP,
  duration_ms BIGINT,
  success_rate FLOAT
) WITH compression = {'sstable_compression': 'LZ4Compressor'}
  AND caching = {'keys': 'ALL', 'rows_per_partition': 'ALL'};

-- Create indexes for experience queries
CREATE INDEX IF NOT EXISTS idx_experiences_agent_id ON experiences (agent_id);
CREATE INDEX IF NOT EXISTS idx_experiences_session_id ON experiences (session_id);
CREATE INDEX IF NOT EXISTS idx_experiences_type ON experiences (type);

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT,
  api_key TEXT,
  api_key_hash TEXT,
  tier TEXT,
  subscription_status TEXT,
  metadata MAP<TEXT, TEXT>,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  last_active TIMESTAMP
) WITH compression = {'sstable_compression': 'LZ4Compressor'}
  AND caching = {'keys': 'ALL', 'rows_per_partition': 'ALL'};

-- Create indexes for user queries
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users (api_key_hash);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users (tier);

-- Sessions table for AI agent sessions
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  agent_id TEXT,
  user_id UUID,
  status TEXT,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  note_count INT,
  token_count BIGINT,
  metadata MAP<TEXT, TEXT>,
  statistics MAP<TEXT, TEXT>
) WITH compression = {'sstable_compression': 'LZ4Compressor'}
  AND caching = {'keys': 'ALL', 'rows_per_partition': 'ALL'};

-- Create indexes for session queries
CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions (agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);

-- Metrics table for performance tracking
CREATE TABLE IF NOT EXISTS metrics (
  id UUID PRIMARY KEY,
  metric_type TEXT,
  metric_name TEXT,
  value DOUBLE,
  timestamp TIMESTAMP,
  metadata MAP<TEXT, TEXT>
) WITH compression = {'sstable_compression': 'LZ4Compressor'}
  AND default_time_to_live = 2592000; -- 30 days TTL

-- Create indexes for metrics queries
CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics (metric_type);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics (metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics (timestamp);

-- Create materialized views for common queries

-- View for recent notes by agent
CREATE MATERIALIZED VIEW IF NOT EXISTS recent_notes_by_agent AS
  SELECT * FROM notes
  WHERE agent_id IS NOT NULL AND created_at IS NOT NULL
  PRIMARY KEY (agent_id, created_at, id)
  WITH CLUSTERING ORDER BY (created_at DESC);

-- View for knowledge by domain
CREATE MATERIALIZED VIEW IF NOT EXISTS knowledge_by_domain AS
  SELECT * FROM knowledge
  WHERE domain IS NOT NULL AND created_at IS NOT NULL
  PRIMARY KEY (domain, created_at, id)
  WITH CLUSTERING ORDER BY (created_at DESC);

-- View for active sessions
CREATE MATERIALIZED VIEW IF NOT EXISTS active_sessions AS
  SELECT * FROM sessions
  WHERE status = 'active' AND status IS NOT NULL
  PRIMARY KEY (status, started_at, id)
  WITH CLUSTERING ORDER BY (started_at DESC);