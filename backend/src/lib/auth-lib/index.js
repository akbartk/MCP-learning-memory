/**
 * Auth Library - JWT Authentication Core
 * 
 * Menyediakan fungsionalitas authentication menggunakan JWT tokens
 * Mendukung token generation, validation, dan refresh
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Konfigurasi default untuk JWT
 */
const DEFAULT_CONFIG = {
  accessTokenExpiry: process.env.JWT_EXPIRES_IN || '15m',
  refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  secret: process.env.JWT_SECRET || 'default-secret-change-this',
  algorithm: 'HS256',
  issuer: 'mcp-server',
  audience: 'mcp-client'
};

/**
 * Auth Library Class
 */
export class AuthLib {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Validasi konfigurasi
    if (this.config.secret === 'default-secret-change-this') {
      console.warn('⚠️  WARNING: Using default JWT secret. Change this in production!');
    }
  }

  /**
   * Generate JWT access token
   * @param {Object} payload - Data yang akan disimpan dalam token
   * @param {Object} options - Opsi tambahan untuk token
   * @returns {string} JWT token
   */
  generateAccessToken(payload, options = {}) {
    try {
      const tokenPayload = {
        sub: payload.userId || payload.sub,
        iat: Math.floor(Date.now() / 1000),
        jti: uuidv4(),
        ...payload
      };

      return jwt.sign(tokenPayload, this.config.secret, {
        expiresIn: options.expiresIn || this.config.accessTokenExpiry,
        algorithm: this.config.algorithm,
        issuer: this.config.issuer,
        audience: this.config.audience
      });
    } catch (error) {
      throw new Error(`Failed to generate access token: ${error.message}`);
    }
  }

  /**
   * Generate JWT refresh token
   * @param {Object} payload - Data yang akan disimpan dalam token
   * @returns {string} JWT refresh token
   */
  generateRefreshToken(payload) {
    try {
      const tokenPayload = {
        sub: payload.userId || payload.sub,
        type: 'refresh',
        iat: Math.floor(Date.now() / 1000),
        jti: uuidv4()
      };

      return jwt.sign(tokenPayload, this.config.secret, {
        expiresIn: this.config.refreshTokenExpiry,
        algorithm: this.config.algorithm,
        issuer: this.config.issuer,
        audience: this.config.audience
      });
    } catch (error) {
      throw new Error(`Failed to generate refresh token: ${error.message}`);
    }
  }

  /**
   * Generate token pair (access + refresh)
   * @param {Object} payload - Data yang akan disimpan dalam token
   * @returns {Object} Object berisi accessToken dan refreshToken
   */
  generateTokenPair(payload) {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken(payload),
      expiresIn: this.config.accessTokenExpiry,
      tokenType: 'Bearer'
    };
  }

  /**
   * Validate JWT token
   * @param {string} token - JWT token untuk divalidasi
   * @param {Object} options - Opsi validasi
   * @returns {Object} Decoded token payload
   */
  validateToken(token, options = {}) {
    try {
      const decoded = jwt.verify(token, this.config.secret, {
        algorithms: [this.config.algorithm],
        issuer: this.config.issuer,
        audience: this.config.audience,
        ...options
      });

      return {
        valid: true,
        payload: decoded,
        expired: false
      };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return {
          valid: false,
          payload: null,
          expired: true,
          error: 'Token has expired'
        };
      }

      return {
        valid: false,
        payload: null,
        expired: false,
        error: error.message
      };
    }
  }

  /**
   * Refresh access token menggunakan refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Object} New token pair
   */
  refreshTokens(refreshToken) {
    try {
      const validation = this.validateToken(refreshToken);
      
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const { payload } = validation;
      
      // Validasi bahwa ini adalah refresh token
      if (payload.type !== 'refresh') {
        throw new Error('Invalid token type. Expected refresh token.');
      }

      // Generate token baru
      return this.generateTokenPair({
        userId: payload.sub,
        // Preserve additional claims jika ada
        ...Object.keys(payload)
          .filter(key => !['sub', 'type', 'iat', 'exp', 'jti', 'iss', 'aud'].includes(key))
          .reduce((obj, key) => ({ ...obj, [key]: payload[key] }), {})
      });
    } catch (error) {
      throw new Error(`Failed to refresh tokens: ${error.message}`);
    }
  }

  /**
   * Hash password menggunakan bcrypt
   * @param {string} password - Plain text password
   * @param {number} saltRounds - Jumlah salt rounds (default: 12)
   * @returns {Promise<string>} Hashed password
   */
  async hashPassword(password, saltRounds = 12) {
    try {
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      throw new Error(`Failed to hash password: ${error.message}`);
    }
  }

  /**
   * Verify password dengan hash
   * @param {string} password - Plain text password
   * @param {string} hash - Hashed password
   * @returns {Promise<boolean>} True jika password cocok
   */
  async verifyPassword(password, hash) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      throw new Error(`Failed to verify password: ${error.message}`);
    }
  }

  /**
   * Decode token tanpa validasi (untuk debugging)
   * @param {string} token - JWT token
   * @returns {Object} Decoded token
   */
  decodeToken(token) {
    try {
      return jwt.decode(token, { complete: true });
    } catch (error) {
      throw new Error(`Failed to decode token: ${error.message}`);
    }
  }

  /**
   * Get token expiration info
   * @param {string} token - JWT token
   * @returns {Object} Expiration info
   */
  getTokenExpiration(token) {
    try {
      const decoded = jwt.decode(token);
      
      if (!decoded || !decoded.exp) {
        return { expired: null, expiresAt: null, timeLeft: null };
      }

      const expiresAt = new Date(decoded.exp * 1000);
      const now = new Date();
      const timeLeft = expiresAt.getTime() - now.getTime();

      return {
        expired: timeLeft <= 0,
        expiresAt,
        timeLeft: Math.max(0, timeLeft),
        timeLeftFormatted: this.formatTimeLeft(timeLeft)
      };
    } catch (error) {
      throw new Error(`Failed to get token expiration: ${error.message}`);
    }
  }

  /**
   * Format time left dalam format yang readable
   * @param {number} milliseconds - Time left dalam milliseconds
   * @returns {string} Formatted time
   */
  formatTimeLeft(milliseconds) {
    if (milliseconds <= 0) return 'Expired';

    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

/**
 * Default instance
 */
const authLib = new AuthLib();

export default authLib;

/**
 * Named exports untuk convenience
 */
export const {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  validateToken,
  refreshTokens,
  hashPassword,
  verifyPassword,
  decodeToken,
  getTokenExpiration
} = authLib;