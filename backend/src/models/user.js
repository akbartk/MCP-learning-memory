import Joi from 'joi';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * User Model
 * Authentication dan authorization entity untuk Subscriber/Member
 */
export class User {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.email = data.email;
    this.organization = data.organization;
    this.subscription = data.subscription || {};
    this.api_keys = data.api_keys || [];
    this.usage = data.usage || {
      total_queries: 0,
      total_storage_mb: 0,
      month_queries: 0,
      month_storage_mb: 0
    };
    this.created_at = data.created_at || new Date();
    this.updated_at = data.updated_at || new Date();
  }

  /**
   * Validation schema untuk User entity
   */
  static getValidationSchema() {
    return Joi.object({
      id: Joi.string().uuid().optional(),
      email: Joi.string().email().required()
        .messages({
          'any.required': 'email wajib diisi',
          'string.email': 'format email tidak valid'
        }),
      organization: Joi.string().min(2).max(100).required()
        .messages({
          'any.required': 'organization wajib diisi',
          'string.min': 'organization minimal 2 karakter'
        }),
      subscription: Joi.object({
        status: Joi.string().valid('pending', 'active', 'suspended', 'expired').default('pending'),
        tier: Joi.string().valid('basic', 'pro', 'enterprise').default('basic'),
        started_at: Joi.date().optional(),
        expires_at: Joi.date().optional(),
        agent_limit: Joi.number().integer().min(1).max(100).default(5)
      }).default({}),
      api_keys: Joi.array().items(
        Joi.object({
          key_hash: Joi.string().required(),
          name: Joi.string().required(),
          created_at: Joi.date().required(),
          last_used: Joi.date().allow(null).default(null),
          revoked: Joi.boolean().default(false)
        })
      ).max(5)
        .messages({
          'array.max': 'Maksimal 5 API keys per user'
        }),
      usage: Joi.object({
        total_queries: Joi.number().integer().min(0).default(0),
        total_storage_mb: Joi.number().min(0).default(0),
        month_queries: Joi.number().integer().min(0).default(0),
        month_storage_mb: Joi.number().min(0).default(0)
      }).default({}),
      created_at: Joi.date().optional(),
      updated_at: Joi.date().optional()
    });
  }

  /**
   * Validasi data User
   */
  static validate(data) {
    const schema = this.getValidationSchema();
    return schema.validate(data, { 
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });
  }

  /**
   * Membuat User baru dengan validasi
   */
  static async create(userData, { redis, scylla, elasticsearch }) {
    // Validasi data
    const { error, value } = this.validate(userData);
    if (error) {
      throw new Error(`Validasi gagal: ${error.details.map(d => d.message).join(', ')}`);
    }

    // Cek apakah email sudah digunakan
    const existingUser = await this.findByEmail(value.email, { scylla });
    if (existingUser) {
      throw new Error('Email sudah digunakan');
    }

    const user = new User(value);
    
    // Set default subscription dates
    if (user.subscription.status === 'active' && !user.subscription.started_at) {
      user.subscription.started_at = new Date();
      
      // Set expiry based on tier (default 1 year)
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      user.subscription.expires_at = expiryDate;
    }

    // Set agent limit based on tier
    const tierLimits = {
      basic: 5,
      pro: 20,
      enterprise: 100
    };
    user.subscription.agent_limit = tierLimits[user.subscription.tier] || 5;

    try {
      // 1. Simpan ke ScyllaDB
      const insertQuery = `
        INSERT INTO users (
          id, email, organization, subscription, api_keys, 
          usage, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await scylla.execute(insertQuery, [
        user.id,
        user.email,
        user.organization,
        JSON.stringify(user.subscription),
        JSON.stringify(user.api_keys),
        JSON.stringify(user.usage),
        user.created_at,
        user.updated_at
      ]);

      // 2. Cache ke Redis
      const cacheKey = `user:${user.id}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(user)); // 1 jam

      // Cache by email for fast lookup
      const emailCacheKey = `user:email:${user.email}`;
      await redis.setex(emailCacheKey, 3600, user.id);

      // 3. Index ke Elasticsearch
      await elasticsearch.index({
        index: 'users',
        id: user.id,
        body: {
          id: user.id,
          email: user.email,
          organization: user.organization,
          subscription_status: user.subscription.status,
          subscription_tier: user.subscription.tier,
          agent_limit: user.subscription.agent_limit,
          created_at: user.created_at
        }
      });

      return user;
    } catch (err) {
      throw new Error(`Gagal menyimpan user: ${err.message}`);
    }
  }

  /**
   * Mencari User berdasarkan ID
   */
  static async findById(id, { redis, scylla }) {
    try {
      // Cek cache terlebih dahulu
      const cacheKey = `user:${id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return new User(JSON.parse(cached));
      }

      // Query dari ScyllaDB
      const selectQuery = 'SELECT * FROM users WHERE id = ?';
      const result = await scylla.execute(selectQuery, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const user = new User({
        id: row.id,
        email: row.email,
        organization: row.organization,
        subscription: JSON.parse(row.subscription),
        api_keys: JSON.parse(row.api_keys),
        usage: JSON.parse(row.usage),
        created_at: row.created_at,
        updated_at: row.updated_at
      });

      // Cache untuk akses berikutnya
      await redis.setex(cacheKey, 3600, JSON.stringify(user));

      return user;
    } catch (err) {
      throw new Error(`Gagal mengambil user: ${err.message}`);
    }
  }

  /**
   * Mencari User berdasarkan email
   */
  static async findByEmail(email, { redis, scylla }) {
    try {
      // Cek cache untuk email->id mapping
      const emailCacheKey = `user:email:${email}`;
      const cachedId = await redis.get(emailCacheKey);
      if (cachedId) {
        return await this.findById(cachedId, { redis, scylla });
      }

      // Query dari database
      const selectQuery = 'SELECT * FROM users WHERE email = ?';
      const result = await scylla.execute(selectQuery, [email]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const user = new User({
        id: row.id,
        email: row.email,
        organization: row.organization,
        subscription: JSON.parse(row.subscription),
        api_keys: JSON.parse(row.api_keys),
        usage: JSON.parse(row.usage),
        created_at: row.created_at,
        updated_at: row.updated_at
      });

      // Cache both user data and email mapping
      const cacheKey = `user:${user.id}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(user));
      await redis.setex(emailCacheKey, 3600, user.id);

      return user;
    } catch (err) {
      throw new Error(`Gagal mengambil user berdasarkan email: ${err.message}`);
    }
  }

  /**
   * Generate API Key baru
   */
  async generateApiKey(keyName, { redis, scylla }) {
    try {
      // Cek limit API keys
      const activeKeys = this.api_keys.filter(key => !key.revoked);
      if (activeKeys.length >= 5) {
        throw new Error('Maksimal 5 API keys aktif per user');
      }

      // Cek nama key yang duplikat
      if (this.api_keys.some(key => key.name === keyName && !key.revoked)) {
        throw new Error('Nama API key sudah digunakan');
      }

      // Generate raw key dan hash
      const rawKey = `mcp_${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      const newApiKey = {
        key_hash: keyHash,
        name: keyName,
        created_at: new Date(),
        last_used: null,
        revoked: false
      };

      this.api_keys.push(newApiKey);
      this.updated_at = new Date();

      // Update di database
      const updateQuery = `
        UPDATE users SET api_keys = ?, updated_at = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        JSON.stringify(this.api_keys),
        this.updated_at,
        this.id
      ]);

      // Update cache
      const cacheKey = `user:${this.id}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(this));

      // Cache API key untuk fast auth lookup
      const authCacheKey = `user:auth:${keyHash}`;
      await redis.setex(authCacheKey, 86400, JSON.stringify({
        user_id: this.id,
        key_name: keyName,
        subscription: this.subscription
      }));

      return { key: rawKey, ...newApiKey };
    } catch (err) {
      throw new Error(`Gagal generate API key: ${err.message}`);
    }
  }

  /**
   * Revoke API Key
   */
  async revokeApiKey(keyName, { redis, scylla }) {
    try {
      const keyIndex = this.api_keys.findIndex(key => key.name === keyName && !key.revoked);
      if (keyIndex === -1) {
        throw new Error('API key tidak ditemukan atau sudah di-revoke');
      }

      const keyHash = this.api_keys[keyIndex].key_hash;
      this.api_keys[keyIndex].revoked = true;
      this.updated_at = new Date();

      // Update di database
      const updateQuery = `
        UPDATE users SET api_keys = ?, updated_at = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        JSON.stringify(this.api_keys),
        this.updated_at,
        this.id
      ]);

      // Update cache
      const cacheKey = `user:${this.id}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(this));

      // Hapus auth cache
      const authCacheKey = `user:auth:${keyHash}`;
      await redis.del(authCacheKey);

      return this.api_keys[keyIndex];
    } catch (err) {
      throw new Error(`Gagal revoke API key: ${err.message}`);
    }
  }

  /**
   * Authenticate user dengan API key
   */
  static async authenticateApiKey(apiKey, { redis, scylla }) {
    try {
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      // Cek cache untuk fast auth
      const authCacheKey = `user:auth:${keyHash}`;
      const cached = await redis.get(authCacheKey);
      if (cached) {
        const authData = JSON.parse(cached);
        
        // Update last_used timestamp
        await this._updateApiKeyLastUsed(authData.user_id, keyHash, { redis, scylla });
        
        return {
          user_id: authData.user_id,
          subscription: authData.subscription,
          key_name: authData.key_name
        };
      }

      // Query dari database jika tidak ada di cache
      const user = await this._findUserByApiKeyHash(keyHash, { scylla });
      if (!user) {
        return null;
      }

      const apiKeyData = user.api_keys.find(key => key.key_hash === keyHash);
      if (!apiKeyData || apiKeyData.revoked) {
        return null;
      }

      // Cache untuk akses berikutnya
      await redis.setex(authCacheKey, 86400, JSON.stringify({
        user_id: user.id,
        key_name: apiKeyData.name,
        subscription: user.subscription
      }));

      // Update last_used
      await this._updateApiKeyLastUsed(user.id, keyHash, { redis, scylla });

      return {
        user_id: user.id,
        subscription: user.subscription,
        key_name: apiKeyData.name
      };
    } catch (err) {
      throw new Error(`Gagal authenticate API key: ${err.message}`);
    }
  }

  /**
   * Helper untuk mencari user berdasarkan API key hash
   */
  static async _findUserByApiKeyHash(keyHash, { scylla }) {
    // Ini memerlukan global secondary index pada api_keys di ScyllaDB
    // Untuk sementara, kita bisa menggunakan pendekatan scan (tidak optimal untuk production)
    const selectQuery = `
      SELECT * FROM users 
      WHERE api_keys CONTAINS ? 
      ALLOW FILTERING
    `;
    
    const result = await scylla.execute(selectQuery, [keyHash]);
    
    for (const row of result.rows) {
      const apiKeys = JSON.parse(row.api_keys);
      if (apiKeys.some(key => key.key_hash === keyHash && !key.revoked)) {
        return new User({
          id: row.id,
          email: row.email,
          organization: row.organization,
          subscription: JSON.parse(row.subscription),
          api_keys: apiKeys,
          usage: JSON.parse(row.usage),
          created_at: row.created_at,
          updated_at: row.updated_at
        });
      }
    }
    
    return null;
  }

  /**
   * Update last_used timestamp untuk API key
   */
  static async _updateApiKeyLastUsed(userId, keyHash, { redis, scylla }) {
    try {
      // Update di database (async, tidak perlu menunggu)
      const updateQuery = `
        UPDATE users 
        SET api_keys = api_keys + {key_hash: ?, last_used: ?}
        WHERE id = ?
      `;
      
      // Ini adalah simplified version - implementasi sebenarnya perlu update nested field
      // Untuk sementara kita skip update ini untuk performa
      
      // Update cache dengan last_used baru jika ada
      const cacheKey = `user:${userId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        const user = JSON.parse(cached);
        const keyIndex = user.api_keys.findIndex(key => key.key_hash === keyHash);
        if (keyIndex !== -1) {
          user.api_keys[keyIndex].last_used = new Date();
          await redis.setex(cacheKey, 3600, JSON.stringify(user));
        }
      }
    } catch (err) {
      console.error('Error updating API key last_used:', err);
      // Don't throw error untuk avoid blocking authentication
    }
  }

  /**
   * Update subscription status
   */
  async updateSubscription(subscriptionData, { redis, scylla, elasticsearch }) {
    const validTransitions = {
      pending: ['active', 'expired'],
      active: ['suspended', 'expired'],
      suspended: ['active', 'expired'],
      expired: ['active'] // renewal
    };

    if (subscriptionData.status && 
        !validTransitions[this.subscription.status].includes(subscriptionData.status)) {
      throw new Error(`Transisi subscription dari ${this.subscription.status} ke ${subscriptionData.status} tidak diperbolehkan`);
    }

    try {
      // Update subscription fields
      Object.assign(this.subscription, subscriptionData);
      
      // Update agent limit based on tier
      if (subscriptionData.tier) {
        const tierLimits = {
          basic: 5,
          pro: 20,
          enterprise: 100
        };
        this.subscription.agent_limit = tierLimits[subscriptionData.tier];
      }

      this.updated_at = new Date();

      // Update di database
      const updateQuery = `
        UPDATE users SET subscription = ?, updated_at = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        JSON.stringify(this.subscription),
        this.updated_at,
        this.id
      ]);

      // Update cache
      const cacheKey = `user:${this.id}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(this));

      // Update search index
      await elasticsearch.update({
        index: 'users',
        id: this.id,
        body: {
          doc: {
            subscription_status: this.subscription.status,
            subscription_tier: this.subscription.tier,
            agent_limit: this.subscription.agent_limit,
            updated_at: this.updated_at
          }
        }
      });

      return this;
    } catch (err) {
      throw new Error(`Gagal update subscription: ${err.message}`);
    }
  }

  /**
   * Update usage statistics
   */
  async updateUsage(usageData, { redis, scylla }) {
    try {
      // Validate usage data
      const usageSchema = Joi.object({
        queries_increment: Joi.number().integer().min(0).default(0),
        storage_increment_mb: Joi.number().min(0).default(0),
        reset_monthly: Joi.boolean().default(false)
      });

      const { error, value } = usageSchema.validate(usageData);
      if (error) {
        throw new Error(`Validasi usage data gagal: ${error.details.map(d => d.message).join(', ')}`);
      }

      // Reset monthly stats jika diminta
      if (value.reset_monthly) {
        this.usage.month_queries = 0;
        this.usage.month_storage_mb = 0;
      }

      // Update usage
      this.usage.total_queries += value.queries_increment;
      this.usage.total_storage_mb += value.storage_increment_mb;
      this.usage.month_queries += value.queries_increment;
      this.usage.month_storage_mb += value.storage_increment_mb;
      this.updated_at = new Date();

      // Update di database
      const updateQuery = `
        UPDATE users SET usage = ?, updated_at = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        JSON.stringify(this.usage),
        this.updated_at,
        this.id
      ]);

      // Update cache
      const cacheKey = `user:${this.id}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(this));

      return this;
    } catch (err) {
      throw new Error(`Gagal update usage: ${err.message}`);
    }
  }

  /**
   * Check subscription limits
   */
  checkLimits(operation) {
    const limits = {
      basic: {
        max_queries_per_month: 10000,
        max_storage_mb: 1000,
        max_agents: 5
      },
      pro: {
        max_queries_per_month: 100000,
        max_storage_mb: 10000,
        max_agents: 20
      },
      enterprise: {
        max_queries_per_month: 1000000,
        max_storage_mb: 100000,
        max_agents: 100
      }
    };

    const tierLimits = limits[this.subscription.tier] || limits.basic;
    
    const result = {
      valid: true,
      reason: null,
      usage: this.usage,
      limits: tierLimits
    };

    // Check subscription status
    if (this.subscription.status !== 'active') {
      result.valid = false;
      result.reason = `Subscription status: ${this.subscription.status}`;
      return result;
    }

    // Check expiry
    if (this.subscription.expires_at && new Date() > new Date(this.subscription.expires_at)) {
      result.valid = false;
      result.reason = 'Subscription expired';
      return result;
    }

    // Check specific operation limits
    switch (operation) {
      case 'query':
        if (this.usage.month_queries >= tierLimits.max_queries_per_month) {
          result.valid = false;
          result.reason = 'Monthly query limit exceeded';
        }
        break;
      
      case 'storage':
        if (this.usage.month_storage_mb >= tierLimits.max_storage_mb) {
          result.valid = false;
          result.reason = 'Monthly storage limit exceeded';
        }
        break;
      
      case 'agent':
        // This would need additional check for current active agents
        // For now, just check the configured limit
        if (this.subscription.agent_limit <= 0) {
          result.valid = false;
          result.reason = 'Agent limit reached';
        }
        break;
    }

    return result;
  }

  /**
   * Get user statistics
   */
  static async getStats({ scylla }) {
    try {
      const statsQuery = `
        SELECT subscription.tier as tier, subscription.status as status, 
               COUNT(*) as count, AVG(usage.total_queries) as avg_queries
        FROM users 
        GROUP BY subscription.tier, subscription.status
      `;
      
      const result = await scylla.execute(statsQuery, []);
      
      const stats = {
        total_users: 0,
        by_tier: {},
        by_status: {},
        avg_queries_per_user: 0
      };

      let totalQueries = 0;
      
      result.rows.forEach(row => {
        const count = parseInt(row.count);
        const tier = row.tier;
        const status = row.status;
        
        stats.total_users += count;
        stats.by_tier[tier] = (stats.by_tier[tier] || 0) + count;
        stats.by_status[status] = (stats.by_status[status] || 0) + count;
        
        totalQueries += row.avg_queries * count;
      });

      stats.avg_queries_per_user = stats.total_users > 0 ? totalQueries / stats.total_users : 0;

      return stats;
    } catch (err) {
      throw new Error(`Gagal mengambil statistik user: ${err.message}`);
    }
  }

  /**
   * Search users (admin only)
   */
  static async search(query, filters = {}, { elasticsearch }) {
    try {
      const searchBody = {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: query,
                  fields: ['email^2', 'organization']
                }
              }
            ]
          }
        },
        size: filters.limit || 20,
        from: filters.offset || 0
      };

      // Add filters
      if (filters.tier) {
        searchBody.query.bool.must.push({
          term: { subscription_tier: filters.tier }
        });
      }

      if (filters.status) {
        searchBody.query.bool.must.push({
          term: { subscription_status: filters.status }
        });
      }

      // Sort by creation date
      searchBody.sort = [
        { created_at: { order: 'desc' } }
      ];

      const response = await elasticsearch.search({
        index: 'users',
        body: searchBody
      });

      return {
        total: response.body.hits.total.value,
        users: response.body.hits.hits.map(hit => hit._source)
      };
    } catch (err) {
      throw new Error(`Gagal melakukan search users: ${err.message}`);
    }
  }

  /**
   * Convert to JSON (exclude sensitive data)
   */
  toJSON() {
    return {
      id: this.id,
      email: this.email,
      organization: this.organization,
      subscription: this.subscription,
      api_keys: this.api_keys.map(key => ({
        name: key.name,
        created_at: key.created_at,
        last_used: key.last_used,
        revoked: key.revoked
        // Exclude key_hash for security
      })),
      usage: this.usage,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  /**
   * Convert to safe JSON (public data only)
   */
  toSafeJSON() {
    return {
      id: this.id,
      organization: this.organization,
      subscription: {
        tier: this.subscription.tier,
        status: this.subscription.status
      },
      created_at: this.created_at
    };
  }
}

export default User;