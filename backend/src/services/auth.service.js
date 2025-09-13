/**
 * Authentication Service
 * 
 * Service untuk mengelola autentikasi subscriber dan token management
 * Menggunakan auth-lib untuk JWT operations
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { AuthLib } from '../lib/auth-lib/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * AuthService Class
 * Mengelola subscriber registration, authentication, dan token management
 */
export class AuthService {
  constructor(storageService) {
    this.storage = storageService;
    this.authLib = new AuthLib();
    
    // Konfigurasi subscription tiers
    this.subscriptionTiers = {
      basic: {
        agentLimit: 5,
        requestsPerHour: 1000,
        features: ['basic_memory', 'notes_storage']
      },
      pro: {
        agentLimit: 25,
        requestsPerHour: 10000,
        features: ['basic_memory', 'notes_storage', 'advanced_search', 'analytics']
      },
      enterprise: {
        agentLimit: -1, // unlimited
        requestsPerHour: 100000,
        features: ['basic_memory', 'notes_storage', 'advanced_search', 'analytics', 'backup', 'custom_integration']
      }
    };
  }

  /**
   * Register subscriber baru
   * @param {Object} subscriberData - Data subscriber
   * @returns {Object} Subscription response dengan user_id dan api_key
   */
  async subscribe(subscriberData) {
    try {
      const { email, organization, tier } = subscriberData;

      // Validasi tier
      if (!this.subscriptionTiers[tier]) {
        throw new Error(`Invalid subscription tier: ${tier}`);
      }

      // Check apakah email sudah terdaftar
      const existingUser = await this.findUserByEmail(email);
      if (existingUser) {
        throw new Error('Email already registered');
      }

      // Generate user ID dan API key
      const userId = uuidv4();
      const apiKey = this.generateApiKey();

      // Buat subscription object
      const subscription = {
        status: 'active',
        tier,
        agentLimit: this.subscriptionTiers[tier].agentLimit,
        expiresAt: this.calculateExpirationDate(tier),
        features: this.subscriptionTiers[tier].features,
        createdAt: new Date().toISOString()
      };

      // Simpan user data
      const userData = {
        id: userId,
        email,
        organization,
        apiKey,
        subscription,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        isActive: true
      };

      // Simpan ke database
      await this.saveUser(userData);

      // Return response sesuai OpenAPI schema
      return {
        user_id: userId,
        api_key: apiKey,
        subscription: {
          status: subscription.status,
          tier: subscription.tier,
          agent_limit: subscription.agentLimit,
          expires_at: subscription.expiresAt
        }
      };
    } catch (error) {
      throw new Error(`Failed to create subscription: ${error.message}`);
    }
  }

  /**
   * Generate access token dari API key
   * @param {string} apiKey - API key dari subscriber
   * @returns {Object} Token response dengan access_token dan refresh_token
   */
  async generateToken(apiKey) {
    try {
      // Validasi API key
      const user = await this.findUserByApiKey(apiKey);
      if (!user) {
        throw new Error('Invalid API key');
      }

      // Check apakah user masih aktif
      if (!user.isActive) {
        throw new Error('User account is deactivated');
      }

      // Check apakah subscription masih aktif
      if (user.subscription.status !== 'active') {
        throw new Error('Subscription is not active');
      }

      // Check apakah subscription belum expired
      if (new Date(user.subscription.expiresAt) < new Date()) {
        throw new Error('Subscription has expired');
      }

      // Generate token pair
      const tokenPayload = {
        userId: user.id,
        email: user.email,
        organization: user.organization,
        tier: user.subscription.tier,
        features: user.subscription.features
      };

      const tokens = this.authLib.generateTokenPair(tokenPayload);

      // Update last login
      await this.updateLastLogin(user.id);

      // Cache token untuk rate limiting (optional)
      await this.cacheUserToken(user.id, tokens.accessToken);

      return {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: this.parseExpiration(tokens.expiresIn)
      };
    } catch (error) {
      throw new Error(`Failed to generate token: ${error.message}`);
    }
  }

  /**
   * Refresh access token
   * @param {string} refreshToken - Refresh token
   * @returns {Object} New token pair
   */
  async refreshToken(refreshToken) {
    try {
      const tokens = this.authLib.refreshTokens(refreshToken);
      
      // Update cache
      const validation = this.authLib.validateToken(tokens.accessToken);
      if (validation.valid && validation.payload.userId) {
        await this.cacheUserToken(validation.payload.userId, tokens.accessToken);
      }

      return {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: this.parseExpiration(tokens.expiresIn)
      };
    } catch (error) {
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  /**
   * Validate JWT token
   * @param {string} token - JWT token
   * @returns {Object} Validation result
   */
  async validateToken(token) {
    try {
      const validation = this.authLib.validateToken(token);
      
      if (!validation.valid) {
        return validation;
      }

      // Additional checks untuk user status
      const user = await this.findUserById(validation.payload.userId);
      if (!user || !user.isActive) {
        return {
          valid: false,
          payload: null,
          expired: false,
          error: 'User not found or deactivated'
        };
      }

      // Check subscription status
      if (user.subscription.status !== 'active' || 
          new Date(user.subscription.expiresAt) < new Date()) {
        return {
          valid: false,
          payload: null,
          expired: false,
          error: 'Subscription expired or inactive'
        };
      }

      return {
        ...validation,
        user: {
          id: user.id,
          email: user.email,
          organization: user.organization,
          subscription: user.subscription
        }
      };
    } catch (error) {
      throw new Error(`Failed to validate token: ${error.message}`);
    }
  }

  /**
   * Get user subscription info
   * @param {string} userId - User ID
   * @returns {Object} Subscription details
   */
  async getSubscription(userId) {
    try {
      const user = await this.findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      return user.subscription;
    } catch (error) {
      throw new Error(`Failed to get subscription: ${error.message}`);
    }
  }

  /**
   * Update subscription tier
   * @param {string} userId - User ID
   * @param {string} newTier - New subscription tier
   * @returns {Object} Updated subscription
   */
  async updateSubscription(userId, newTier) {
    try {
      if (!this.subscriptionTiers[newTier]) {
        throw new Error(`Invalid subscription tier: ${newTier}`);
      }

      const user = await this.findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Update subscription
      const updatedSubscription = {
        ...user.subscription,
        tier: newTier,
        agentLimit: this.subscriptionTiers[newTier].agentLimit,
        features: this.subscriptionTiers[newTier].features,
        updatedAt: new Date().toISOString()
      };

      await this.updateUser(userId, { subscription: updatedSubscription });

      return updatedSubscription;
    } catch (error) {
      throw new Error(`Failed to update subscription: ${error.message}`);
    }
  }

  /**
   * Revoke API key (generate new one)
   * @param {string} userId - User ID
   * @returns {string} New API key
   */
  async revokeApiKey(userId) {
    try {
      const newApiKey = this.generateApiKey();
      await this.updateUser(userId, { 
        apiKey: newApiKey,
        updatedAt: new Date().toISOString()
      });

      return newApiKey;
    } catch (error) {
      throw new Error(`Failed to revoke API key: ${error.message}`);
    }
  }

  // Private helper methods

  /**
   * Generate secure API key
   * @returns {string} API key
   */
  generateApiKey() {
    const prefix = 'mcp';
    const randomPart = uuidv4().replace(/-/g, '');
    return `${prefix}_${randomPart}`;
  }

  /**
   * Calculate subscription expiration date
   * @param {string} tier - Subscription tier
   * @returns {string} ISO date string
   */
  calculateExpirationDate(tier) {
    const now = new Date();
    const expirationMonths = tier === 'basic' ? 1 : tier === 'pro' ? 12 : 24;
    now.setMonth(now.getMonth() + expirationMonths);
    return now.toISOString();
  }

  /**
   * Parse expiration string ke seconds
   * @param {string} expiration - Expiration string (e.g., "15m")
   * @returns {number} Seconds
   */
  parseExpiration(expiration) {
    const match = expiration.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // default 15 minutes

    const [, value, unit] = match;
    const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
    return parseInt(value) * (multipliers[unit] || 60);
  }

  // Database operations (akan menggunakan StorageService)

  async saveUser(userData) {
    try {
      // Try ScyllaDB first
      const persistence = await this.storage.persistence();
      const query = `
        INSERT INTO users (id, email, organization, api_key, subscription, created_at, last_login, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        userData.id,
        userData.email,
        userData.organization,
        userData.apiKey,
        JSON.stringify(userData.subscription),
        userData.createdAt,
        userData.lastLogin,
        userData.isActive
      ];

      return await persistence.execute(query, params);
    } catch (error) {
      // Fallback to Redis cache if ScyllaDB is not available
      console.warn('⚠️ ScyllaDB not available, using Redis cache for user data');

      try {
        // Use storage service methods directly
        await this.storage.cacheSet(`user:${userData.id}`, userData, 86400); // 24 hours TTL
        await this.storage.cacheSet(`user:email:${userData.email}`, userData.id, 86400);
        await this.storage.cacheSet(`user:apikey:${userData.apiKey}`, userData.id, 86400);

        return { success: true, cached: true };
      } catch (cacheError) {
        throw new Error(`Failed to save user data: ${cacheError.message}`);
      }
    }
  }

  async findUserByEmail(email) {
    const persistence = await this.storage.persistence();
    const query = 'SELECT * FROM users WHERE email = ? LIMIT 1';
    const result = await persistence.execute(query, [email]);
    return result.rows.length > 0 ? this.mapUserFromDb(result.rows[0]) : null;
  }

  async findUserByApiKey(apiKey) {
    const persistence = await this.storage.persistence();
    const query = 'SELECT * FROM users WHERE api_key = ? LIMIT 1';
    const result = await persistence.execute(query, [apiKey]);
    return result.rows.length > 0 ? this.mapUserFromDb(result.rows[0]) : null;
  }

  async findUserById(userId) {
    const persistence = await this.storage.persistence();
    const query = 'SELECT * FROM users WHERE id = ? LIMIT 1';
    const result = await persistence.execute(query, [userId]);
    return result.rows.length > 0 ? this.mapUserFromDb(result.rows[0]) : null;
  }

  async updateUser(userId, updates) {
    const persistence = await this.storage.persistence();
    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const query = `UPDATE users SET ${setClause} WHERE id = ?`;
    const values = [...Object.values(updates), userId];
    
    return await persistence.execute(query, values);
  }

  async updateLastLogin(userId) {
    return await this.updateUser(userId, { last_login: new Date().toISOString() });
  }

  async cacheUserToken(userId, token) {
    const cache = await this.storage.cache();
    const key = `user_token:${userId}`;
    await cache.setex(key, 900, token); // 15 minutes
  }

  /**
   * Map database row ke user object
   * @param {Object} row - Database row
   * @returns {Object} User object
   */
  mapUserFromDb(row) {
    return {
      id: row.id,
      email: row.email,
      organization: row.organization,
      apiKey: row.api_key,
      subscription: typeof row.subscription === 'string' 
        ? JSON.parse(row.subscription) 
        : row.subscription,
      createdAt: row.created_at,
      lastLogin: row.last_login,
      isActive: row.is_active
    };
  }
}

export default AuthService;