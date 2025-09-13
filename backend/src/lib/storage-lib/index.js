/**
 * Storage Library - Unified Database Interface
 * 
 * Menyediakan interface terpadu untuk berbagai database
 * Mendukung Redis, ScyllaDB, dan Elasticsearch
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import RedisClient from './redis-client.js';
import ScyllaClient from './scylla-client.js';
import ElasticClient from './elastic-client.js';

/**
 * Storage Manager Class
 * Mengelola koneksi ke semua database dan menyediakan interface terpadu
 */
export class StorageManager {
  constructor(config = {}) {
    this.config = {
      redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        password: process.env.REDIS_PASSWORD || null,
        retryDelayOnFailover: 100,
        retryDelayOnFailure: 50,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        ...config.redis
      },
      scylla: {
        contactPoints: (process.env.SCYLLA_CONTACT_POINTS || 'localhost').split(','),
        localDataCenter: process.env.SCYLLA_LOCAL_DC || 'datacenter1',
        keyspace: process.env.SCYLLA_KEYSPACE || 'mcp_server',
        username: process.env.SCYLLA_USERNAME || null,
        password: process.env.SCYLLA_PASSWORD || null,
        ...config.scylla
      },
      elasticsearch: {
        node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
        username: process.env.ELASTICSEARCH_USERNAME || null,
        password: process.env.ELASTICSEARCH_PASSWORD || null,
        index: process.env.ELASTICSEARCH_INDEX || 'mcp_server',
        ...config.elasticsearch
      }
    };

    this.clients = {};
    this.isConnected = false;
    this.healthStatus = {
      redis: false,
      scylla: false,
      elasticsearch: false
    };
  }

  /**
   * Initialize semua database connections dengan graceful degradation
   */
  async initialize() {
    console.log('🔌 Initializing storage connections...');

    // Initialize clients
    this.clients.redis = new RedisClient(this.config.redis);
    this.clients.scylla = new ScyllaClient(this.config.scylla);
    this.clients.elasticsearch = new ElasticClient(this.config.elasticsearch);

    // Connect to databases with graceful degradation
    const connections = await Promise.allSettled([
      this.clients.redis.connect().catch(err => {
        console.warn('⚠️ Redis connection failed:', err.message);
        return false;
      }),
      this.clients.scylla.connect().catch(err => {
        console.warn('⚠️ ScyllaDB connection failed:', err.message);
        return false;
      }),
      this.clients.elasticsearch.connect().catch(err => {
        console.warn('⚠️ Elasticsearch connection failed:', err.message);
        return false;
      })
    ]);

    // Check connection results
    this.healthStatus.redis = connections[0].status === 'fulfilled' && connections[0].value !== false;
    this.healthStatus.scylla = connections[1].status === 'fulfilled' && connections[1].value !== false;
    this.healthStatus.elasticsearch = connections[2].status === 'fulfilled' && connections[2].value !== false;

    // At least one database should be connected
    const connectedCount = Object.values(this.healthStatus).filter(status => status).length;

    if (connectedCount === 0) {
      console.error('❌ No database connections available');
      throw new Error('All database connections failed');
    }

    this.isConnected = true;

    console.log('📊 Storage connection status:');
    console.log(`  Redis: ${this.healthStatus.redis ? '✅' : '❌'}`);
    console.log(`  ScyllaDB: ${this.healthStatus.scylla ? '✅' : '❌'}`);
    console.log(`  Elasticsearch: ${this.healthStatus.elasticsearch ? '✅' : '❌'}`);
    console.log(`✅ Storage initialized with ${connectedCount}/3 connections`);

    return this.healthStatus;
  }

  /**
   * Update health status untuk semua database
   */
  async updateHealthStatus() {
    const healthChecks = await Promise.allSettled([
      this.clients.redis.healthCheck(),
      this.clients.scylla.healthCheck(),
      this.clients.elasticsearch.healthCheck()
    ]);

    this.healthStatus.redis = healthChecks[0].status === 'fulfilled' && healthChecks[0].value;
    this.healthStatus.scylla = healthChecks[1].status === 'fulfilled' && healthChecks[1].value;
    this.healthStatus.elasticsearch = healthChecks[2].status === 'fulfilled' && healthChecks[2].value;

    return this.healthStatus;
  }

  /**
   * Get client untuk database tertentu
   */
  getClient(database) {
    if (!this.isConnected) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }

    if (!this.clients[database]) {
      throw new Error(`Unknown database: ${database}`);
    }

    // Check if specific database is connected
    if (!this.healthStatus[database]) {
      throw new Error(`Database ${database} is not connected`);
    }

    return this.clients[database];
  }

  /**
   * Cache operations (Redis)
   */
  async cache() {
    return this.getClient('redis');
  }

  /**
   * Persistent storage operations (ScyllaDB)
   */
  async persistence() {
    return this.getClient('scylla');
  }

  /**
   * Search operations (Elasticsearch)
   */
  async search() {
    return this.getClient('elasticsearch');
  }

  /**
   * Transaction wrapper untuk multiple database operations
   */
  async transaction(operations) {
    const results = {};
    const rollbackOperations = [];

    try {
      for (const [database, operation] of Object.entries(operations)) {
        const client = this.getClient(database);
        
        if (typeof operation === 'function') {
          results[database] = await operation(client);
        } else {
          throw new Error(`Operation for ${database} must be a function`);
        }

        // Store rollback operation jika ada
        if (operation.rollback) {
          rollbackOperations.push({ database, rollback: operation.rollback });
        }
      }

      return results;
    } catch (error) {
      // Execute rollback operations
      for (const { database, rollback } of rollbackOperations.reverse()) {
        try {
          await rollback(this.getClient(database));
        } catch (rollbackError) {
          console.error(`Rollback failed for ${database}:`, rollbackError);
        }
      }

      throw error;
    }
  }

  /**
   * Batch operations untuk multiple databases
   */
  async batch(operations) {
    const results = await Promise.allSettled(
      Object.entries(operations).map(async ([database, operation]) => {
        const client = this.getClient(database);
        return { database, result: await operation(client) };
      })
    );

    const successful = [];
    const failed = [];

    results.forEach((result, index) => {
      const database = Object.keys(operations)[index];
      
      if (result.status === 'fulfilled') {
        successful.push({ database, ...result.value });
      } else {
        failed.push({ database, error: result.reason });
      }
    });

    return { successful, failed };
  }

  /**
   * Get comprehensive storage statistics
   */
  async getStatistics() {
    try {
      const [redisStats, scyllaStats, elasticStats] = await Promise.allSettled([
        this.clients.redis.getStatistics(),
        this.clients.scylla.getStatistics(), 
        this.clients.elasticsearch.getStatistics()
      ]);

      return {
        redis: redisStats.status === 'fulfilled' ? redisStats.value : { error: redisStats.reason?.message },
        scylla: scyllaStats.status === 'fulfilled' ? scyllaStats.value : { error: scyllaStats.reason?.message },
        elasticsearch: elasticStats.status === 'fulfilled' ? elasticStats.value : { error: elasticStats.reason?.message },
        overall: {
          connectedDatabases: Object.values(this.healthStatus).filter(Boolean).length,
          totalDatabases: Object.keys(this.healthStatus).length,
          healthStatus: this.healthStatus,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      throw new Error(`Failed to get storage statistics: ${error.message}`);
    }
  }

  /**
   * Backup data dari semua databases
   */
  async backup(options = {}) {
    const { 
      includeRedis = true, 
      includeScylla = true, 
      includeElasticsearch = true,
      backupPath = './backups',
      timestamp = new Date().toISOString().replace(/:/g, '-')
    } = options;

    const backupResults = {};

    try {
      if (includeRedis && this.healthStatus.redis) {
        backupResults.redis = await this.clients.redis.backup(`${backupPath}/redis-${timestamp}.rdb`);
      }

      if (includeScylla && this.healthStatus.scylla) {
        backupResults.scylla = await this.clients.scylla.backup(`${backupPath}/scylla-${timestamp}`);
      }

      if (includeElasticsearch && this.healthStatus.elasticsearch) {
        backupResults.elasticsearch = await this.clients.elasticsearch.backup(`${backupPath}/elastic-${timestamp}`);
      }

      return {
        success: true,
        timestamp,
        backupPath,
        results: backupResults
      };
    } catch (error) {
      throw new Error(`Backup failed: ${error.message}`);
    }
  }

  /**
   * Close semua database connections
   */
  async close() {
    try {
      await Promise.all([
        this.clients.redis?.close(),
        this.clients.scylla?.close(),
        this.clients.elasticsearch?.close()
      ]);

      this.isConnected = false;
      this.healthStatus = { redis: false, scylla: false, elasticsearch: false };
      
      console.log('🔌 All storage connections closed');
    } catch (error) {
      console.error('❌ Error closing storage connections:', error);
      throw error;
    }
  }

  /**
   * Monitor storage health dengan interval checking
   */
  startHealthMonitoring(intervalMs = 30000) {
    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
    }

    this.healthMonitor = setInterval(async () => {
      try {
        const previousHealth = { ...this.healthStatus };
        await this.updateHealthStatus();

        // Log changes in health status
        Object.keys(this.healthStatus).forEach(db => {
          if (previousHealth[db] !== this.healthStatus[db]) {
            const status = this.healthStatus[db] ? '✅ Connected' : '❌ Disconnected';
            console.log(`🔍 Health change detected - ${db}: ${status}`);
          }
        });
      } catch (error) {
        console.error('❌ Health monitoring error:', error);
      }
    }, intervalMs);

    console.log(`🔍 Started health monitoring (${intervalMs}ms interval)`);
    return this.healthMonitor;
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
      this.healthMonitor = null;
      console.log('🔍 Stopped health monitoring');
    }
  }
}

/**
 * Default storage manager instance
 */
const storageManager = new StorageManager();

export default storageManager;

/**
 * Named exports untuk convenience
 */
export { RedisClient, ScyllaClient, ElasticClient };

/**
 * Helper functions
 */
export const createStorageManager = (config) => new StorageManager(config);

export const getDefaultConfig = () => ({
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || null
  },
  scylla: {
    contactPoints: (process.env.SCYLLA_CONTACT_POINTS || 'localhost').split(','),
    keyspace: process.env.SCYLLA_KEYSPACE || 'mcp_server'
  },
  elasticsearch: {
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    index: process.env.ELASTICSEARCH_INDEX || 'mcp_server'
  }
});