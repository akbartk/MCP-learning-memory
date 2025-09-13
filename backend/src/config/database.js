/**
 * Database Configuration
 * 
 * Konfigurasi untuk semua database connections
 * ScyllaDB, Redis, dan Elasticsearch
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { config } from 'dotenv';

// Load environment variables
config();

/**
 * ScyllaDB Configuration
 */
export const scyllaConfig = {
  contactPoints: (process.env.SCYLLA_CONTACT_POINTS || 'localhost').split(','),
  localDataCenter: process.env.SCYLLA_LOCAL_DC || 'datacenter1',
  keyspace: process.env.SCYLLA_KEYSPACE || 'mcp_server',
  username: process.env.SCYLLA_USERNAME || null,
  password: process.env.SCYLLA_PASSWORD || null,
  
  // Connection options
  pooling: {
    coreConnectionsPerHost: parseInt(process.env.SCYLLA_CORE_CONNECTIONS) || 2,
    maxConnectionsPerHost: parseInt(process.env.SCYLLA_MAX_CONNECTIONS) || 8,
    maxRequestsPerConnection: parseInt(process.env.SCYLLA_MAX_REQUESTS) || 32768,
    heartBeatInterval: parseInt(process.env.SCYLLA_HEARTBEAT_INTERVAL) || 30000
  },
  
  // Socket options
  socketOptions: {
    connectTimeout: parseInt(process.env.SCYLLA_CONNECT_TIMEOUT) || 5000,
    readTimeout: parseInt(process.env.SCYLLA_READ_TIMEOUT) || 12000,
    keepAlive: process.env.SCYLLA_KEEP_ALIVE !== 'false',
    keepAliveDelay: parseInt(process.env.SCYLLA_KEEP_ALIVE_DELAY) || 0,
    tcpNoDelay: process.env.SCYLLA_TCP_NO_DELAY !== 'false'
  },
  
  // Query options
  queryOptions: {
    consistency: parseInt(process.env.SCYLLA_CONSISTENCY) || 1, // LOCAL_ONE
    fetchSize: parseInt(process.env.SCYLLA_FETCH_SIZE) || 5000,
    prepare: process.env.SCYLLA_PREPARE !== 'false',
    autoPage: process.env.SCYLLA_AUTO_PAGE !== 'false'
  },
  
  // Retry policy
  policies: {
    retry: {
      retryCount: parseInt(process.env.SCYLLA_RETRY_COUNT) || 3,
      retryDelay: parseInt(process.env.SCYLLA_RETRY_DELAY) || 1000
    },
    loadBalancing: {
      localDc: process.env.SCYLLA_LOCAL_DC || 'datacenter1',
      localHostsFirst: process.env.SCYLLA_LOCAL_HOSTS_FIRST !== 'false'
    }
  },
  
  // SSL options
  sslOptions: process.env.SCYLLA_SSL_ENABLED === 'true' ? {
    cert: process.env.SCYLLA_SSL_CERT || null,
    key: process.env.SCYLLA_SSL_KEY || null,
    ca: process.env.SCYLLA_SSL_CA || null,
    rejectUnauthorized: process.env.SCYLLA_SSL_REJECT_UNAUTHORIZED !== 'false'
  } : null,
  
  // Metrics
  metrics: {
    enabled: process.env.SCYLLA_METRICS_ENABLED === 'true'
  }
};

/**
 * Redis Configuration
 */
export const redisConfig = {
  // Connection
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || null,
  db: parseInt(process.env.REDIS_DB) || 0,
  
  // Connection options
  connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT) || 10000,
  commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT) || 5000,
  retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY_FAILOVER) || 100,
  retryDelayOnFailure: parseInt(process.env.REDIS_RETRY_DELAY_FAILURE) || 50,
  maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES) || 3,
  
  // Lazy connect
  lazyConnect: process.env.REDIS_LAZY_CONNECT !== 'false',
  
  // Keep alive
  keepAlive: parseInt(process.env.REDIS_KEEP_ALIVE) || 30000,
  
  // Family (4 for IPv4, 6 for IPv6)
  family: parseInt(process.env.REDIS_FAMILY) || 4,
  
  // TLS options
  tls: process.env.REDIS_TLS_ENABLED === 'true' ? {
    cert: process.env.REDIS_TLS_CERT || null,
    key: process.env.REDIS_TLS_KEY || null,
    ca: process.env.REDIS_TLS_CA || null,
    rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false'
  } : null,
  
  // Cluster options (jika menggunakan Redis Cluster)
  cluster: process.env.REDIS_CLUSTER_ENABLED === 'true' ? {
    enableOfflineQueue: process.env.REDIS_CLUSTER_OFFLINE_QUEUE !== 'false',
    redisOptions: {
      password: process.env.REDIS_PASSWORD || null
    },
    maxRetriesPerRequest: parseInt(process.env.REDIS_CLUSTER_MAX_RETRIES) || 3
  } : null
};

/**
 * Elasticsearch Configuration
 */
export const elasticsearchConfig = {
  // Node configuration
  node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
  nodes: process.env.ELASTICSEARCH_NODES ? 
    process.env.ELASTICSEARCH_NODES.split(',') : 
    ['http://localhost:9200'],
  
  // Authentication
  auth: (process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD) ? {
    username: process.env.ELASTICSEARCH_USERNAME,
    password: process.env.ELASTICSEARCH_PASSWORD
  } : null,
  
  // API key authentication (alternative to username/password)
  apiKey: process.env.ELASTICSEARCH_API_KEY || null,
  
  // Cloud ID (untuk Elastic Cloud)
  cloud: process.env.ELASTICSEARCH_CLOUD_ID ? {
    id: process.env.ELASTICSEARCH_CLOUD_ID
  } : null,
  
  // Connection options
  maxRetries: parseInt(process.env.ELASTICSEARCH_MAX_RETRIES) || 3,
  requestTimeout: parseInt(process.env.ELASTICSEARCH_REQUEST_TIMEOUT) || 30000,
  pingTimeout: parseInt(process.env.ELASTICSEARCH_PING_TIMEOUT) || 3000,
  
  // Sniffing (node discovery)
  sniffOnStart: process.env.ELASTICSEARCH_SNIFF_ON_START === 'true',
  sniffInterval: process.env.ELASTICSEARCH_SNIFF_INTERVAL ? 
    parseInt(process.env.ELASTICSEARCH_SNIFF_INTERVAL) : false,
  sniffOnConnectionFault: process.env.ELASTICSEARCH_SNIFF_ON_FAULT !== 'false',
  
  // SSL/TLS
  ssl: process.env.ELASTICSEARCH_SSL_ENABLED === 'true' ? {
    cert: process.env.ELASTICSEARCH_SSL_CERT || null,
    key: process.env.ELASTICSEARCH_SSL_KEY || null,
    ca: process.env.ELASTICSEARCH_SSL_CA || null,
    rejectUnauthorized: process.env.ELASTICSEARCH_SSL_REJECT_UNAUTHORIZED !== 'false'
  } : null,
  
  // Compression
  compression: process.env.ELASTICSEARCH_COMPRESSION || 'gzip',
  
  // Suggest compression
  suggestCompression: process.env.ELASTICSEARCH_SUGGEST_COMPRESSION !== 'false',
  
  // Headers
  headers: {
    'User-Agent': `mcp-server/${process.env.APP_VERSION || '1.0.0'}`
  }
};

/**
 * Index configurations untuk Elasticsearch
 */
export const elasticsearchIndices = {
  notes: {
    index: process.env.ELASTICSEARCH_NOTES_INDEX || 'mcp_notes',
    settings: {
      number_of_shards: parseInt(process.env.ELASTICSEARCH_NOTES_SHARDS) || 1,
      number_of_replicas: parseInt(process.env.ELASTICSEARCH_NOTES_REPLICAS) || 1,
      refresh_interval: process.env.ELASTICSEARCH_NOTES_REFRESH || '1s',
      max_result_window: parseInt(process.env.ELASTICSEARCH_NOTES_MAX_RESULT) || 10000
    },
    mappings: {
      properties: {
        id: { type: 'keyword' },
        agent_id: { type: 'keyword' },
        session_id: { type: 'keyword' },
        timestamp: { type: 'date' },
        type: { type: 'keyword' },
        context: {
          type: 'object',
          properties: {
            task: { type: 'text', analyzer: 'standard' },
            project: { type: 'keyword' },
            tags: { type: 'keyword' }
          }
        },
        content: {
          type: 'object',
          properties: {
            action: { type: 'text', analyzer: 'standard' },
            result: { type: 'text', analyzer: 'standard' },
            learning: { type: 'text', analyzer: 'standard' },
            errors: { type: 'text' },
            solution: { type: 'text', analyzer: 'standard' }
          }
        },
        searchable_content: { 
          type: 'text', 
          analyzer: 'standard',
          search_analyzer: 'standard'
        },
        created_at: { type: 'date' }
      }
    }
  },
  
  knowledge: {
    index: process.env.ELASTICSEARCH_KNOWLEDGE_INDEX || 'mcp_knowledge',
    settings: {
      number_of_shards: parseInt(process.env.ELASTICSEARCH_KNOWLEDGE_SHARDS) || 1,
      number_of_replicas: parseInt(process.env.ELASTICSEARCH_KNOWLEDGE_REPLICAS) || 1
    },
    mappings: {
      properties: {
        id: { type: 'keyword' },
        domain: { type: 'keyword' },
        title: { type: 'text', analyzer: 'standard' },
        summary: { type: 'text', analyzer: 'standard' },
        content: { type: 'text', analyzer: 'standard' },
        confidence_score: { type: 'float' },
        version: { type: 'integer' },
        tags: { type: 'keyword' },
        created_at: { type: 'date' },
        updated_at: { type: 'date' }
      }
    }
  },
  
  experiences: {
    index: process.env.ELASTICSEARCH_EXPERIENCES_INDEX || 'mcp_experiences',
    settings: {
      number_of_shards: parseInt(process.env.ELASTICSEARCH_EXPERIENCES_SHARDS) || 1,
      number_of_replicas: parseInt(process.env.ELASTICSEARCH_EXPERIENCES_REPLICAS) || 1
    },
    mappings: {
      properties: {
        id: { type: 'keyword' },
        title: { type: 'text', analyzer: 'standard' },
        description: { type: 'text', analyzer: 'standard' },
        applicable_domain: { type: 'keyword' },
        project_id: { type: 'keyword' },
        outcomes: { type: 'object' },
        lessons_learned: { type: 'text' },
        created_at: { type: 'date' }
      }
    }
  }
};

/**
 * Database table schemas untuk ScyllaDB
 */
export const scyllaSchemas = {
  keyspace: `
    CREATE KEYSPACE IF NOT EXISTS ${scyllaConfig.keyspace}
    WITH REPLICATION = {
      'class': 'SimpleStrategy',
      'replication_factor': ${process.env.SCYLLA_REPLICATION_FACTOR || 1}
    }
  `,
  
  users: `
    CREATE TABLE IF NOT EXISTS ${scyllaConfig.keyspace}.users (
      id UUID PRIMARY KEY,
      email TEXT,
      organization TEXT,
      api_key TEXT,
      subscription TEXT,
      created_at TIMESTAMP,
      last_login TIMESTAMP,
      is_active BOOLEAN
    )
  `,
  
  notes: `
    CREATE TABLE IF NOT EXISTS ${scyllaConfig.keyspace}.notes (
      id UUID PRIMARY KEY,
      agent_id TEXT,
      session_id UUID,
      timestamp TIMESTAMP,
      type TEXT,
      context TEXT,
      content TEXT,
      metadata TEXT,
      created_at TIMESTAMP
    )
  `,
  
  sessions: `
    CREATE TABLE IF NOT EXISTS ${scyllaConfig.keyspace}.sessions (
      id UUID PRIMARY KEY,
      agent_id TEXT,
      user_id UUID,
      started_at TIMESTAMP,
      ended_at TIMESTAMP,
      status TEXT,
      statistics TEXT,
      duration_minutes INT
    )
  `,
  
  knowledge: `
    CREATE TABLE IF NOT EXISTS ${scyllaConfig.keyspace}.knowledge (
      id UUID PRIMARY KEY,
      domain TEXT,
      title TEXT,
      summary TEXT,
      content TEXT,
      confidence_score FLOAT,
      version INT,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    )
  `,
  
  experiences: `
    CREATE TABLE IF NOT EXISTS ${scyllaConfig.keyspace}.experiences (
      id UUID PRIMARY KEY,
      title TEXT,
      description TEXT,
      applicable_domain TEXT,
      project_id TEXT,
      outcomes TEXT,
      lessons_learned TEXT,
      created_at TIMESTAMP
    )
  `,
  
  // Indexes untuk better query performance
  indexes: [
    `CREATE INDEX IF NOT EXISTS ON ${scyllaConfig.keyspace}.users (email)`,
    `CREATE INDEX IF NOT EXISTS ON ${scyllaConfig.keyspace}.users (api_key)`,
    `CREATE INDEX IF NOT EXISTS ON ${scyllaConfig.keyspace}.notes (agent_id)`,
    `CREATE INDEX IF NOT EXISTS ON ${scyllaConfig.keyspace}.notes (session_id)`,
    `CREATE INDEX IF NOT EXISTS ON ${scyllaConfig.keyspace}.sessions (user_id)`,
    `CREATE INDEX IF NOT EXISTS ON ${scyllaConfig.keyspace}.sessions (agent_id)`,
    `CREATE INDEX IF NOT EXISTS ON ${scyllaConfig.keyspace}.knowledge (domain)`,
    `CREATE INDEX IF NOT EXISTS ON ${scyllaConfig.keyspace}.experiences (applicable_domain)`,
    `CREATE INDEX IF NOT EXISTS ON ${scyllaConfig.keyspace}.experiences (project_id)`
  ]
};

/**
 * Environment-specific configurations
 */
export const databaseConfig = {
  development: {
    scylla: {
      ...scyllaConfig,
      queryOptions: {
        ...scyllaConfig.queryOptions,
        consistency: 1 // LOCAL_ONE untuk development
      }
    },
    redis: {
      ...redisConfig,
      retryDelayOnFailover: 500,
      maxRetriesPerRequest: 1
    },
    elasticsearch: {
      ...elasticsearchConfig,
      requestTimeout: 10000,
      maxRetries: 1
    }
  },
  
  production: {
    scylla: {
      ...scyllaConfig,
      queryOptions: {
        ...scyllaConfig.queryOptions,
        consistency: 4 // LOCAL_QUORUM untuk production
      }
    },
    redis: redisConfig,
    elasticsearch: elasticsearchConfig
  },
  
  test: {
    scylla: {
      ...scyllaConfig,
      keyspace: `${scyllaConfig.keyspace}_test`
    },
    redis: {
      ...redisConfig,
      db: (redisConfig.db || 0) + 1 // Use different DB untuk testing
    },
    elasticsearch: {
      ...elasticsearchConfig,
      requestTimeout: 5000
    }
  }
};

/**
 * Get configuration berdasarkan environment
 */
export const getConfig = (env = process.env.NODE_ENV || 'development') => {
  return databaseConfig[env] || databaseConfig.development;
};

/**
 * Connection validation
 */
export const validateConfig = (config) => {
  const errors = [];
  
  // Validate ScyllaDB config
  if (!config.scylla.contactPoints || config.scylla.contactPoints.length === 0) {
    errors.push('ScyllaDB contact points are required');
  }
  
  if (!config.scylla.keyspace) {
    errors.push('ScyllaDB keyspace is required');
  }
  
  // Validate Redis config
  if (!config.redis.host) {
    errors.push('Redis host is required');
  }
  
  if (!config.redis.port || config.redis.port < 1 || config.redis.port > 65535) {
    errors.push('Redis port must be between 1 and 65535');
  }
  
  // Validate Elasticsearch config
  if (!config.elasticsearch.node && !config.elasticsearch.nodes) {
    errors.push('Elasticsearch node(s) are required');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
};

export default {
  scyllaConfig,
  redisConfig,
  elasticsearchConfig,
  elasticsearchIndices,
  scyllaSchemas,
  databaseConfig,
  getConfig,
  validateConfig
};