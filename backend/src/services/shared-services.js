/**
 * Shared Services Singleton
 *
 * Provides singleton instances of services to ensure proper initialization
 * and sharing across all routes and modules
 *
 * @author MCP Server Team
 * @version 1.0.0
 */

import StorageService from './storage.service.js';
import CacheService from './cache.service.js';
import SearchService from './search.service.js';
import BackupService from './backup.service.js';
import AuthService from './auth.service.js';

class SharedServices {
  constructor() {
    this.storageService = null;
    this.cacheService = null;
    this.searchService = null;
    this.backupService = null;
    this.authService = null;
    this.initialized = false;
  }

  /**
   * Initialize all services
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      console.log('🔄 Initializing shared services...');

      // Initialize storage service
      this.storageService = new StorageService();
      await this.storageService.initialize();
      console.log('✅ StorageService initialized');

      // Initialize cache service
      this.cacheService = new CacheService(this.storageService);
      console.log('✅ CacheService initialized');

      // Initialize search service
      this.searchService = new SearchService(this.storageService);
      console.log('✅ SearchService initialized');

      // Initialize backup service
      this.backupService = new BackupService(this.storageService);
      console.log('✅ BackupService initialized');

      // Initialize auth service
      this.authService = new AuthService(this.storageService);
      console.log('✅ AuthService initialized');

      this.initialized = true;
      console.log('✅ All shared services initialized successfully');

    } catch (error) {
      console.error('❌ Shared services initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get storage service instance
   */
  getStorageService() {
    if (!this.initialized) {
      throw new Error('Shared services not initialized. Call initialize() first.');
    }
    return this.storageService;
  }

  /**
   * Get cache service instance
   */
  getCacheService() {
    if (!this.initialized) {
      throw new Error('Shared services not initialized. Call initialize() first.');
    }
    return this.cacheService;
  }

  /**
   * Get search service instance
   */
  getSearchService() {
    if (!this.initialized) {
      throw new Error('Shared services not initialized. Call initialize() first.');
    }
    return this.searchService;
  }

  /**
   * Get backup service instance
   */
  getBackupService() {
    if (!this.initialized) {
      throw new Error('Shared services not initialized. Call initialize() first.');
    }
    return this.backupService;
  }

  /**
   * Get auth service instance
   */
  getAuthService() {
    if (!this.initialized) {
      throw new Error('Shared services not initialized. Call initialize() first.');
    }
    return this.authService;
  }

  /**
   * Close all services
   */
  async close() {
    if (this.storageService) {
      await this.storageService.close();
    }
    if (this.backupService) {
      await this.backupService.stop();
    }
    this.initialized = false;
    console.log('🔌 All shared services closed');
  }
}

// Create singleton instance
const sharedServices = new SharedServices();

export default sharedServices;
export { sharedServices };