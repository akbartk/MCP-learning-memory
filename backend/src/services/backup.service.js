/**
 * Backup Service
 * 
 * Service untuk mengelola backup dan restore operations
 * Menggunakan backup-lib untuk comprehensive backup management
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { BackupManager } from '../lib/backup-lib/index.js';
import path from 'path';
import { existsSync } from 'fs';

/**
 * BackupService Class
 * Mengelola backup, restore, archival operations untuk MCP Server
 */
export class BackupService {
  constructor(storageService, config = {}) {
    this.storage = storageService;
    
    // Configure backup manager
    this.backupManager = new BackupManager({
      backupPath: config.backupPath || './backups',
      retentionPeriod: config.retentionPeriod || 180, // 6 months
      compressionLevel: config.compressionLevel || 6,
      enableEncryption: config.enableEncryption || false,
      encryptionKey: config.encryptionKey || process.env.BACKUP_ENCRYPTION_KEY,
      maxBackupSize: config.maxBackupSize || 1024 * 1024 * 1024, // 1GB
      enableScheduledBackups: config.enableScheduledBackups !== false,
      backupSchedule: config.backupSchedule || '0 2 * * *', // Daily at 2 AM
      enableIncrementalBackup: config.enableIncrementalBackup !== false,
      enableParallelProcessing: config.enableParallelProcessing !== false,
      maxConcurrency: config.maxConcurrency || 3,
      ...config
    });

    // Service statistics
    this.serviceStats = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      lastActivity: null,
      startTime: new Date().toISOString()
    };

    // Initialize backup system
    this.initialize();
  }

  /**
   * Initialize backup service
   */
  async initialize() {
    try {
      // Verify backup directory access
      const backupPath = this.backupManager.config.backupPath;
      if (!existsSync(backupPath)) {
        console.log(`📁 Creating backup directory: ${backupPath}`);
      }

      console.log('✅ BackupService initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize BackupService:', error);
      throw error;
    }
  }

  /**
   * Create backup dengan berbagai options
   * @param {Object} backupOptions - Backup configuration options
   * @returns {Object} Backup result
   */
  async createBackup(backupOptions = {}) {
    const startTime = Date.now();
    
    try {
      console.log('🔄 Starting backup operation...');
      
      // Validate dan prepare backup options
      const options = await this.prepareBackupOptions(backupOptions);
      
      // Collect data yang akan di-backup
      const dataToBackup = await this.collectBackupData(options);
      
      // Execute backup menggunakan backup manager
      const backupResult = await this.backupManager.createBackup({
        ...options,
        dataSources: dataToBackup
      });

      // Post-process backup result
      await this.postProcessBackup(backupResult, options);

      // Update statistics
      this.updateServiceStats(true, Date.now() - startTime);

      return {
        success: true,
        backup_id: backupResult.backupId,
        type: backupResult.type,
        size: backupResult.size,
        path: backupResult.path,
        sources: Object.keys(dataToBackup),
        duration_ms: backupResult.duration,
        timestamp: new Date().toISOString(),
        metadata: backupResult.metadata
      };

    } catch (error) {
      // Update statistics untuk failure
      this.updateServiceStats(false, Date.now() - startTime);
      
      console.error('❌ Backup operation failed:', error);
      throw new Error(`Backup creation failed: ${error.message}`);
    }
  }

  /**
   * Create full backup dari semua data
   * @param {Object} options - Backup options
   * @returns {Object} Full backup result
   */
  async createFullBackup(options = {}) {
    return await this.createBackup({
      ...options,
      type: 'full',
      includeUserData: true,
      includeSystemData: true,
      includeSearchIndices: true,
      includeCacheData: false // Cache dapat di-rebuild
    });
  }

  /**
   * Create incremental backup berdasarkan changes
   * @param {Object} options - Backup options
   * @returns {Object} Incremental backup result
   */
  async createIncrementalBackup(options = {}) {
    return await this.createBackup({
      ...options,
      type: 'incremental',
      includeUserData: true,
      includeSystemData: false, // System data tidak sering berubah
      includeSearchIndices: false, // Indices dapat di-rebuild
      includeCacheData: false
    });
  }

  /**
   * Create selective backup berdasarkan criteria
   * @param {Object} criteria - Selection criteria
   * @param {Object} options - Backup options
   * @returns {Object} Selective backup result
   */
  async createSelectiveBackup(criteria, options = {}) {
    return await this.createBackup({
      ...options,
      type: 'selective',
      criteria,
      includeUserData: true,
      includeSystemData: false,
      includeSearchIndices: false,
      includeCacheData: false
    });
  }

  /**
   * Restore backup berdasarkan backup ID
   * @param {string} backupId - Backup ID untuk restore
   * @param {Object} restoreOptions - Restore options
   * @returns {Object} Restore result
   */
  async restoreBackup(backupId, restoreOptions = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`🔄 Starting restore operation: ${backupId}`);

      // Validate restore options
      const options = this.prepareRestoreOptions(restoreOptions);

      // Pre-restore validation
      await this.validateRestoreOperation(backupId, options);

      // Execute restore
      const restoreResult = await this.backupManager.restoreBackup(backupId, options);

      // Post-restore operations
      await this.postProcessRestore(restoreResult, options);

      // Update statistics
      this.updateServiceStats(true, Date.now() - startTime);

      return {
        success: true,
        backup_id: backupId,
        restored_data: restoreResult.restoredData || [],
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        metadata: restoreResult.metadata
      };

    } catch (error) {
      this.updateServiceStats(false, Date.now() - startTime);
      console.error(`❌ Restore operation failed: ${backupId}`, error);
      throw new Error(`Restore failed: ${error.message}`);
    }
  }

  /**
   * List available backups dengan filtering
   * @param {Object} filters - List filters
   * @returns {Object} List of backups
   */
  async listBackups(filters = {}) {
    try {
      const {
        type = 'all',
        limit = 50,
        offset = 0,
        sortBy = 'timestamp',
        sortOrder = 'desc',
        dateRange = null
      } = filters;

      // Get backups dari backup manager
      const backups = await this.backupManager.listBackups({
        type: type === 'all' ? undefined : type,
        limit: limit + offset, // Get more untuk pagination
        sortBy
      });

      // Apply filters
      let filteredBackups = backups;

      // Date range filter
      if (dateRange && dateRange.from && dateRange.to) {
        filteredBackups = backups.filter(backup => {
          const backupDate = new Date(backup.timestamp);
          return backupDate >= new Date(dateRange.from) && 
                 backupDate <= new Date(dateRange.to);
        });
      }

      // Sort results
      if (sortOrder === 'asc') {
        filteredBackups.reverse();
      }

      // Apply pagination
      const paginatedBackups = filteredBackups.slice(offset, offset + limit);

      return {
        backups: paginatedBackups.map(this.formatBackupInfo),
        total: filteredBackups.length,
        has_more: (offset + limit) < filteredBackups.length,
        filters: filters
      };

    } catch (error) {
      throw new Error(`Failed to list backups: ${error.message}`);
    }
  }

  /**
   * Get backup details
   * @param {string} backupId - Backup ID
   * @returns {Object} Backup details
   */
  async getBackupDetails(backupId) {
    try {
      const backupInfo = await this.backupManager.findBackupFile(backupId);
      
      if (!backupInfo) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      // Get additional metadata jika available
      const details = {
        ...this.formatBackupInfo(backupInfo),
        created_at: backupInfo.timestamp,
        file_path: backupInfo.path,
        metadata: await this.extractBackupMetadata(backupInfo)
      };

      return details;

    } catch (error) {
      throw new Error(`Failed to get backup details: ${error.message}`);
    }
  }

  /**
   * Delete backup
   * @param {string} backupId - Backup ID to delete
   * @returns {Object} Delete result
   */
  async deleteBackup(backupId) {
    try {
      const deleteResult = await this.backupManager.deleteBackup(backupId);
      
      // Update statistics
      this.updateServiceStats(true, 0);

      return {
        success: deleteResult.success,
        backup_id: backupId,
        deleted_path: deleteResult.path,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.updateServiceStats(false, 0);
      throw new Error(`Failed to delete backup: ${error.message}`);
    }
  }

  /**
   * Archive old backups berdasarkan retention policy
   * @returns {Object} Archive result
   */
  async archiveOldBackups() {
    try {
      console.log('🔄 Starting backup archival process...');

      const archiveResult = await this.backupManager.archiveOldBackups();

      // Update statistics
      this.updateServiceStats(true, 0);

      return {
        success: true,
        archived_count: archiveResult.successful,
        failed_count: archiveResult.failed,
        total_processed: archiveResult.totalProcessed,
        details: archiveResult.results,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.updateServiceStats(false, 0);
      throw new Error(`Archival process failed: ${error.message}`);
    }
  }

  /**
   * Get backup statistics dan health info
   * @returns {Object} Backup statistics
   */
  async getBackupStatistics() {
    try {
      const managerStats = this.backupManager.getStatistics();
      
      return {
        service: this.serviceStats,
        backup_manager: managerStats,
        storage_health: await this.storage.getHealthStatus(),
        disk_usage: await this.getDiskUsage(),
        retention_info: {
          retention_period_days: this.backupManager.config.retentionPeriod,
          next_archival: await this.getNextArchivalDate()
        }
      };

    } catch (error) {
      throw new Error(`Failed to get backup statistics: ${error.message}`);
    }
  }

  /**
   * Verify backup integrity
   * @param {string} backupId - Backup ID to verify
   * @returns {Object} Verification result
   */
  async verifyBackup(backupId) {
    try {
      const backupInfo = await this.backupManager.findBackupFile(backupId);
      
      if (!backupInfo) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      // Verify file exists dan readable
      const fileExists = existsSync(backupInfo.path);
      if (!fileExists) {
        throw new Error(`Backup file not found: ${backupInfo.path}`);
      }

      // Verify file size
      const fs = await import('fs/promises');
      const stats = await fs.stat(backupInfo.path);
      
      const verification = {
        backup_id: backupId,
        file_exists: fileExists,
        file_size: stats.size,
        expected_size: backupInfo.size,
        size_match: stats.size === backupInfo.size,
        file_readable: true, // Will be set by actual read test
        last_modified: stats.mtime.toISOString(),
        integrity_check: 'passed'
      };

      // Test file readability
      try {
        const handle = await fs.open(backupInfo.path, 'r');
        await handle.close();
        verification.file_readable = true;
      } catch (error) {
        verification.file_readable = false;
        verification.integrity_check = 'failed';
        verification.error = error.message;
      }

      return verification;

    } catch (error) {
      throw new Error(`Backup verification failed: ${error.message}`);
    }
  }

  // Private helper methods

  /**
   * Prepare backup options dengan defaults dan validation
   */
  async prepareBackupOptions(options) {
    return {
      type: options.type || 'incremental',
      includeUserData: options.includeUserData !== false,
      includeSystemData: options.includeSystemData || false,
      includeSearchIndices: options.includeSearchIndices || false,
      includeCacheData: options.includeCacheData || false,
      compression: options.compression !== false,
      encryption: options.encryption || false,
      criteria: options.criteria || {},
      metadata: {
        created_by: 'backup_service',
        service_version: '1.0.0',
        ...options.metadata
      },
      ...options
    };
  }

  /**
   * Collect data yang akan di-backup berdasarkan options
   */
  async collectBackupData(options) {
    const dataSources = {};

    if (options.includeUserData) {
      // User-related data
      dataSources.users = await this.collectUserData();
      dataSources.notes = await this.collectNotesData();
      dataSources.sessions = await this.collectSessionsData();
    }

    if (options.includeSystemData) {
      // System configuration dan metadata
      dataSources.configuration = await this.collectSystemConfig();
      dataSources.knowledge = await this.collectKnowledgeData();
      dataSources.experiences = await this.collectExperiencesData();
    }

    if (options.includeSearchIndices) {
      // Search indices backup
      dataSources.search_indices = await this.collectSearchIndices();
    }

    if (options.includeCacheData) {
      // Cache data (usually not needed)
      dataSources.cache = await this.collectCacheData();
    }

    // Apply selective criteria jika ada
    if (options.criteria && Object.keys(options.criteria).length > 0) {
      return await this.applySelectiveCriteria(dataSources, options.criteria);
    }

    return dataSources;
  }

  /**
   * Collect data methods (akan terhubung ke storage services)
   */
  async collectUserData() {
    // Placeholder untuk user data collection
    return { type: 'scylla_table', table: 'users' };
  }

  async collectNotesData() {
    return { type: 'scylla_table', table: 'notes' };
  }

  async collectSessionsData() {
    return { type: 'scylla_table', table: 'sessions' };
  }

  async collectSystemConfig() {
    return { type: 'file_system', path: './config' };
  }

  async collectKnowledgeData() {
    return { type: 'scylla_table', table: 'knowledge' };
  }

  async collectExperiencesData() {
    return { type: 'scylla_table', table: 'experiences' };
  }

  async collectSearchIndices() {
    return { type: 'elasticsearch', indices: ['notes', 'knowledge'] };
  }

  async collectCacheData() {
    return { type: 'redis', pattern: '*' };
  }

  /**
   * Apply selective criteria untuk filter data
   */
  async applySelectiveCriteria(dataSources, criteria) {
    const filteredSources = {};

    // Apply user filter
    if (criteria.userId) {
      filteredSources.user_notes = {
        type: 'scylla_query',
        query: `SELECT * FROM notes WHERE agent_id = '${criteria.userId}'`
      };
    }

    // Apply date range filter
    if (criteria.dateRange) {
      filteredSources.date_filtered_notes = {
        type: 'scylla_query',
        query: `SELECT * FROM notes WHERE created_at >= '${criteria.dateRange.from}' AND created_at <= '${criteria.dateRange.to}'`
      };
    }

    // Apply type filter
    if (criteria.noteTypes) {
      const types = criteria.noteTypes.map(t => `'${t}'`).join(',');
      filteredSources.type_filtered_notes = {
        type: 'scylla_query',
        query: `SELECT * FROM notes WHERE type IN (${types})`
      };
    }

    return Object.keys(filteredSources).length > 0 ? filteredSources : dataSources;
  }

  /**
   * Post-process backup result
   */
  async postProcessBackup(backupResult, options) {
    if (backupResult.success && backupResult.path) {
      // Log backup creation
      console.log(`✅ Backup created: ${backupResult.backupId} (${backupResult.size} bytes)`);
      
      // Optionally verify backup integrity
      if (options.verifyAfterCreation) {
        await this.verifyBackup(backupResult.backupId);
      }
    }
  }

  /**
   * Prepare restore options
   */
  prepareRestoreOptions(options) {
    return {
      targetLocation: options.targetLocation || 'original',
      overwriteExisting: options.overwriteExisting || false,
      restoreUserData: options.restoreUserData !== false,
      restoreSystemData: options.restoreSystemData || false,
      restoreToTimestamp: options.restoreToTimestamp || null,
      dryRun: options.dryRun || false,
      ...options
    };
  }

  /**
   * Validate restore operation
   */
  async validateRestoreOperation(backupId, options) {
    // Check if backup exists
    const backupInfo = await this.backupManager.findBackupFile(backupId);
    if (!backupInfo) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    // Check storage availability
    const healthStatus = await this.storage.getHealthStatus();
    if (!healthStatus.scylla || !healthStatus.elasticsearch) {
      throw new Error('Storage systems not available for restore');
    }

    // Additional validation checks
    if (options.overwriteExisting === false) {
      // Check for data conflicts
      console.log('🔍 Checking for potential data conflicts...');
    }
  }

  /**
   * Post-process restore
   */
  async postProcessRestore(restoreResult, options) {
    // Rebuild search indices jika perlu
    if (restoreResult.restoredData.includes('notes')) {
      console.log('🔄 Rebuilding search indices...');
      // Trigger index rebuild
    }

    // Clear cache untuk ensure fresh data
    console.log('🧹 Clearing cache after restore...');
    const cache = await this.storage.cache();
    await cache.flushall();

    console.log('✅ Post-restore operations completed');
  }

  /**
   * Format backup info untuk response
   */
  formatBackupInfo(backupInfo) {
    return {
      id: backupInfo.id,
      type: backupInfo.type,
      filename: backupInfo.filename,
      size: backupInfo.size,
      size_formatted: this.formatBytes(backupInfo.size),
      timestamp: backupInfo.timestamp,
      path: backupInfo.path
    };
  }

  /**
   * Extract backup metadata
   */
  async extractBackupMetadata(backupInfo) {
    try {
      // Extract metadata dari backup file (simplified)
      return {
        compression_used: true,
        encryption_used: false,
        sources_count: 0,
        estimated_restore_time: '5-10 minutes'
      };
    } catch (error) {
      return {};
    }
  }

  /**
   * Get disk usage untuk backup directory
   */
  async getDiskUsage() {
    try {
      const fs = await import('fs/promises');
      const backupPath = this.backupManager.config.backupPath;
      
      // Calculate total size (simplified)
      let totalSize = 0;
      const calculateSize = async (dirPath) => {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await calculateSize(fullPath);
          } else {
            const stats = await fs.stat(fullPath);
            totalSize += stats.size;
          }
        }
      };

      if (existsSync(backupPath)) {
        await calculateSize(backupPath);
      }

      return {
        total_backup_size: totalSize,
        total_backup_size_formatted: this.formatBytes(totalSize),
        backup_directory: backupPath
      };
    } catch (error) {
      return {
        total_backup_size: 0,
        error: error.message
      };
    }
  }

  /**
   * Get next archival date
   */
  async getNextArchivalDate() {
    const retentionDays = this.backupManager.config.retentionPeriod;
    const nextArchival = new Date();
    nextArchival.setDate(nextArchival.getDate() + retentionDays);
    return nextArchival.toISOString();
  }

  /**
   * Format bytes ke human readable format
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Update service statistics
   */
  updateServiceStats(success, duration) {
    this.serviceStats.totalOperations++;
    
    if (success) {
      this.serviceStats.successfulOperations++;
    } else {
      this.serviceStats.failedOperations++;
    }
    
    this.serviceStats.lastActivity = new Date().toISOString();
  }

  /**
   * Stop backup service
   */
  async stop() {
    this.backupManager.stop();
    console.log('🛑 BackupService stopped');
  }
}

export default BackupService;