/**
 * Redis Client - Redis Database Interface
 * 
 * Client untuk Redis database operations
 * Mendukung caching, pub/sub, dan data structures
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { createClient } from 'redis';
import { promisify } from 'util';

export default class RedisClient {
  constructor(config = {}) {
    this.config = {
      url: config.url || process.env.REDIS_URL || 'redis://localhost:6379',
      password: config.password || process.env.REDIS_PASSWORD || null,
      retryDelayOnFailover: config.retryDelayOnFailover || 100,
      retryDelayOnFailure: config.retryDelayOnFailure || 50,
      maxRetriesPerRequest: config.maxRetriesPerRequest || 3,
      lazyConnect: config.lazyConnect || true,
      ...config
    };

    this.client = null;
    this.subscriber = null;
    this.publisher = null;
    this.isConnected = false;
    this.connectionRetries = 0;
    this.maxRetries = 5;
  }

  /**
   * Connect ke Redis server
   */
  async connect() {
    try {
      // Build Redis connection options
      const redisOptions = {
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > this.maxRetries) {
              console.error('Max Redis reconnection attempts reached');
              return new Error('Max retries reached');
            }
            return Math.min(retries * 50, 500);
          },
          connectTimeout: 10000,
          commandTimeout: 5000
        },
        // Handle connection retry
        retryStrategy: (times) => {
          if (times > this.maxRetries) {
            return null;
          }
          return Math.min(times * 100, 3000);
        }
      };

      // Parse URL - Redis client expects URL format
      if (this.config.url) {
        redisOptions.url = this.config.url;
      }

      // Main client untuk read/write operations
      this.client = createClient(redisOptions);

      // Set connection flag awal
      this.isConnected = false;

      // Event handlers
      this.client.on('error', (error) => {
        console.error('⚠️ Redis client error:', error.message);
        // Don't throw, let it retry
      });

      this.client.on('connect', () => {
        console.log('🔌 Redis client connecting...');
      });

      this.client.on('ready', () => {
        console.log('✅ Redis client connected and ready');
        this.isConnected = true;
        this.connectionRetries = 0;
      });

      this.client.on('end', () => {
        console.log('🔌 Redis client connection closed');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        this.connectionRetries++;
        console.log(`🔄 Redis client reconnecting... (attempt ${this.connectionRetries})`);
      });

      // Connect dengan timeout
      const connectTimeout = setTimeout(() => {
        throw new Error('Redis connection timeout after 10 seconds');
      }, 10000);

      await this.client.connect();
      clearTimeout(connectTimeout);

      // Wait for ready state
      if (!this.isConnected) {
        await new Promise((resolve) => {
          const checkReady = setInterval(() => {
            if (this.isConnected) {
              clearInterval(checkReady);
              resolve();
            }
          }, 100);

          // Timeout after 5 seconds
          setTimeout(() => {
            clearInterval(checkReady);
            resolve();
          }, 5000);
        });
      }

      // Separate clients untuk pub/sub
      if (!this.config.lazyConnect && this.isConnected) {
        await this.initializePubSub();
      }

      return this.isConnected;
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      throw new Error(`Redis connection failed: ${error.message}`);
    }
  }

  /**
   * Initialize pub/sub clients
   */
  async initializePubSub() {
    try {
      // Subscriber client
      this.subscriber = this.client.duplicate();
      await this.subscriber.connect();

      // Publisher client
      this.publisher = this.client.duplicate();
      await this.publisher.connect();

      console.log('✅ Redis pub/sub clients initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Redis pub/sub:', error);
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      if (!this.client || !this.isConnected) return false;
      
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('❌ Redis health check failed:', error);
      return false;
    }
  }

  /**
   * Basic key-value operations
   */
  async set(key, value, options = {}) {
    try {
      const { ttl, nx, xx } = options;
      const args = [];

      if (ttl) args.push('EX', ttl);
      if (nx) args.push('NX');
      if (xx) args.push('XX');

      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
      
      if (args.length > 0) {
        return await this.client.set(key, serializedValue, ...args);
      }
      
      return await this.client.set(key, serializedValue);
    } catch (error) {
      throw new Error(`Redis SET failed: ${error.message}`);
    }
  }

  async get(key, options = {}) {
    try {
      const value = await this.client.get(key);
      
      if (value === null) return null;

      // Try to parse JSON, fallback to string
      if (options.json !== false) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }

      return value;
    } catch (error) {
      throw new Error(`Redis GET failed: ${error.message}`);
    }
  }

  async del(key) {
    try {
      return await this.client.del(key);
    } catch (error) {
      throw new Error(`Redis DEL failed: ${error.message}`);
    }
  }

  async exists(key) {
    try {
      return await this.client.exists(key);
    } catch (error) {
      throw new Error(`Redis EXISTS failed: ${error.message}`);
    }
  }

  async ttl(key) {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      throw new Error(`Redis TTL failed: ${error.message}`);
    }
  }

  async expire(key, seconds) {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      throw new Error(`Redis EXPIRE failed: ${error.message}`);
    }
  }

  /**
   * List operations
   */
  async lpush(key, ...values) {
    try {
      const serializedValues = values.map(v => typeof v === 'object' ? JSON.stringify(v) : v);
      return await this.client.lPush(key, serializedValues);
    } catch (error) {
      throw new Error(`Redis LPUSH failed: ${error.message}`);
    }
  }

  async rpush(key, ...values) {
    try {
      const serializedValues = values.map(v => typeof v === 'object' ? JSON.stringify(v) : v);
      return await this.client.rPush(key, serializedValues);
    } catch (error) {
      throw new Error(`Redis RPUSH failed: ${error.message}`);
    }
  }

  async lpop(key, count = 1) {
    try {
      const values = await this.client.lPop(key, count);
      if (!values) return null;
      
      if (Array.isArray(values)) {
        return values.map(v => {
          try { return JSON.parse(v); } catch { return v; }
        });
      }
      
      try { return JSON.parse(values); } catch { return values; }
    } catch (error) {
      throw new Error(`Redis LPOP failed: ${error.message}`);
    }
  }

  async rpop(key, count = 1) {
    try {
      const values = await this.client.rPop(key, count);
      if (!values) return null;
      
      if (Array.isArray(values)) {
        return values.map(v => {
          try { return JSON.parse(v); } catch { return v; }
        });
      }
      
      try { return JSON.parse(values); } catch { return values; }
    } catch (error) {
      throw new Error(`Redis RPOP failed: ${error.message}`);
    }
  }

  async llen(key) {
    try {
      return await this.client.lLen(key);
    } catch (error) {
      throw new Error(`Redis LLEN failed: ${error.message}`);
    }
  }

  async lrange(key, start = 0, stop = -1) {
    try {
      const values = await this.client.lRange(key, start, stop);
      return values.map(v => {
        try { return JSON.parse(v); } catch { return v; }
      });
    } catch (error) {
      throw new Error(`Redis LRANGE failed: ${error.message}`);
    }
  }

  /**
   * Hash operations
   */
  async hset(key, field, value) {
    try {
      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
      return await this.client.hSet(key, field, serializedValue);
    } catch (error) {
      throw new Error(`Redis HSET failed: ${error.message}`);
    }
  }

  async hget(key, field) {
    try {
      const value = await this.client.hGet(key, field);
      if (value === null) return null;
      
      try { return JSON.parse(value); } catch { return value; }
    } catch (error) {
      throw new Error(`Redis HGET failed: ${error.message}`);
    }
  }

  async hgetall(key) {
    try {
      const hash = await this.client.hGetAll(key);
      const result = {};
      
      for (const [field, value] of Object.entries(hash)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          result[field] = value;
        }
      }
      
      return result;
    } catch (error) {
      throw new Error(`Redis HGETALL failed: ${error.message}`);
    }
  }

  async hdel(key, ...fields) {
    try {
      return await this.client.hDel(key, fields);
    } catch (error) {
      throw new Error(`Redis HDEL failed: ${error.message}`);
    }
  }

  /**
   * Set operations
   */
  async sadd(key, ...members) {
    try {
      const serializedMembers = members.map(m => typeof m === 'object' ? JSON.stringify(m) : m);
      return await this.client.sAdd(key, serializedMembers);
    } catch (error) {
      throw new Error(`Redis SADD failed: ${error.message}`);
    }
  }

  async srem(key, ...members) {
    try {
      const serializedMembers = members.map(m => typeof m === 'object' ? JSON.stringify(m) : m);
      return await this.client.sRem(key, serializedMembers);
    } catch (error) {
      throw new Error(`Redis SREM failed: ${error.message}`);
    }
  }

  async smembers(key) {
    try {
      const members = await this.client.sMembers(key);
      return members.map(m => {
        try { return JSON.parse(m); } catch { return m; }
      });
    } catch (error) {
      throw new Error(`Redis SMEMBERS failed: ${error.message}`);
    }
  }

  async sismember(key, member) {
    try {
      const serializedMember = typeof member === 'object' ? JSON.stringify(member) : member;
      return await this.client.sIsMember(key, serializedMember);
    } catch (error) {
      throw new Error(`Redis SISMEMBER failed: ${error.message}`);
    }
  }

  /**
   * Pub/Sub operations
   */
  async publish(channel, message) {
    try {
      if (!this.publisher) {
        await this.initializePubSub();
      }
      
      const serializedMessage = typeof message === 'object' ? JSON.stringify(message) : message;
      return await this.publisher.publish(channel, serializedMessage);
    } catch (error) {
      throw new Error(`Redis PUBLISH failed: ${error.message}`);
    }
  }

  async subscribe(channel, callback) {
    try {
      if (!this.subscriber) {
        await this.initializePubSub();
      }

      await this.subscriber.subscribe(channel, (message) => {
        try {
          const parsedMessage = JSON.parse(message);
          callback(parsedMessage, channel);
        } catch {
          callback(message, channel);
        }
      });
    } catch (error) {
      throw new Error(`Redis SUBSCRIBE failed: ${error.message}`);
    }
  }

  async unsubscribe(channel) {
    try {
      if (this.subscriber) {
        await this.subscriber.unsubscribe(channel);
      }
    } catch (error) {
      throw new Error(`Redis UNSUBSCRIBE failed: ${error.message}`);
    }
  }

  /**
   * Advanced operations
   */
  async pipeline(commands) {
    try {
      const pipeline = this.client.multi();
      
      commands.forEach(([command, ...args]) => {
        pipeline[command.toLowerCase()](...args);
      });

      return await pipeline.exec();
    } catch (error) {
      throw new Error(`Redis PIPELINE failed: ${error.message}`);
    }
  }

  async lock(key, ttl = 30, retries = 3) {
    const lockKey = `lock:${key}`;
    const lockValue = Date.now().toString();

    for (let i = 0; i < retries; i++) {
      try {
        const result = await this.set(lockKey, lockValue, { ttl, nx: true });
        if (result === 'OK') {
          return {
            key: lockKey,
            value: lockValue,
            unlock: async () => {
              const current = await this.get(lockKey);
              if (current === lockValue) {
                await this.del(lockKey);
                return true;
              }
              return false;
            }
          };
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
      } catch (error) {
        if (i === retries - 1) throw error;
      }
    }

    throw new Error(`Failed to acquire lock for key: ${key}`);
  }

  /**
   * Get statistics
   */
  async getStatistics() {
    try {
      const info = await this.client.info();
      const memory = await this.client.info('memory');
      const stats = await this.client.info('stats');
      
      return {
        connected: this.isConnected,
        version: this.extractInfoValue(info, 'redis_version'),
        uptime: parseInt(this.extractInfoValue(info, 'uptime_in_seconds')),
        memory: {
          used: this.extractInfoValue(memory, 'used_memory_human'),
          peak: this.extractInfoValue(memory, 'used_memory_peak_human'),
          fragmentation: parseFloat(this.extractInfoValue(memory, 'mem_fragmentation_ratio'))
        },
        stats: {
          totalConnections: parseInt(this.extractInfoValue(stats, 'total_connections_received')),
          totalCommands: parseInt(this.extractInfoValue(stats, 'total_commands_processed')),
          keyspaceHits: parseInt(this.extractInfoValue(stats, 'keyspace_hits')),
          keyspaceMisses: parseInt(this.extractInfoValue(stats, 'keyspace_misses'))
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to get Redis statistics: ${error.message}`);
    }
  }

  extractInfoValue(info, key) {
    const lines = info.split('\r\n');
    const line = lines.find(l => l.startsWith(`${key}:`));
    return line ? line.split(':')[1] : null;
  }

  /**
   * Backup operations
   */
  async backup(filepath) {
    try {
      // Redis BGSAVE untuk create background snapshot
      await this.client.bgSave();
      
      // Return info about backup
      return {
        success: true,
        filepath,
        timestamp: new Date().toISOString(),
        method: 'BGSAVE'
      };
    } catch (error) {
      throw new Error(`Redis backup failed: ${error.message}`);
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      if (this.subscriber) await this.subscriber.quit();
      if (this.publisher) await this.publisher.quit();
      if (this.client) await this.client.quit();
      
      this.isConnected = false;
      console.log('🔌 Redis connections closed');
    } catch (error) {
      console.error('❌ Error closing Redis connections:', error);
      throw error;
    }
  }
}