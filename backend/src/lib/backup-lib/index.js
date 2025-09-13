/**
 * Backup Library - Backup and Archival Management
 * 
 * Menyediakan comprehensive backup dan archival system
 * Mendukung scheduled backups, data retention, dan restoration
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { promisify } from 'util';
import cron from 'node-cron';
import archiver from './archiver.js';
import restorer from './restore.js';

/**
 * Backup Manager Class
 */
export class BackupManager {
  constructor(config = {}) {
    this.config = {
      backupPath: config.backupPath || './backups',
      retentionPeriod: config.retentionPeriod || 180, // 6 months in days
      compressionLevel: config.compressionLevel || 6,
      enableEncryption: config.enableEncryption || false,
      encryptionKey: config.encryptionKey || null,
      maxBackupSize: config.maxBackupSize || 1024 * 1024 * 1024, // 1GB
      enableScheduledBackups: config.enableScheduledBackups !== false,
      backupSchedule: config.backupSchedule || '0 2 * * *', // Daily at 2 AM
      enableIncrementalBackup: config.enableIncrementalBackup !== false,
      enableParallelProcessing: config.enableParallelProcessing !== false,
      maxConcurrency: config.maxConcurrency || 3,
      ...config
    };

    this.archiver = archiver;
    this.restorer = restorer;
    
    // Backup statistics
    this.statistics = {
      totalBackups: 0,
      successfulBackups: 0,
      failedBackups: 0,
      totalDataBackedUp: 0,
      lastBackupTime: null,
      nextScheduledBackup: null,
      retentionCleanups: 0,
      startTime: Date.now()
    };

    // Active backup jobs
    this.activeJobs = new Map();
    this.scheduledJobs = new Map();

    // Initialize backup directory
    this.initializeBackupDirectory();

    // Setup scheduled backups
    if (this.config.enableScheduledBackups) {
      this.setupScheduledBackups();
    }
  }

  /**
   * Initialize backup directory structure
   */
  initializeBackupDirectory() {
    try {
      const directories = [
        this.config.backupPath,
        join(this.config.backupPath, 'full'),
        join(this.config.backupPath, 'incremental'),
        join(this.config.backupPath, 'archived'),
        join(this.config.backupPath, 'temp')
      ];

      directories.forEach(dir => {
        if (!existsSync(dir)) {
          try {
            mkdirSync(dir, { recursive: true });
          } catch (mkdirError) {
            console.warn(`⚠️ Could not create backup directory ${dir}: ${mkdirError.message}`);
            // Don't throw, continue with available directories
          }
        }
      });

      console.log(`✅ Backup directories initialized: ${this.config.backupPath}`);
    } catch (error) {
      console.warn('⚠️ Backup directory initialization warning:', error.message);
      // Don't throw, allow system to run without backup capability
    }
  }

  /**
   * Create comprehensive backup
   * @param {Object} options - Backup options
   * @returns {Object} Backup result
   */
  async createBackup(options = {}) {
    const backupId = this.generateBackupId();
    const startTime = Date.now();

    try {
      console.log(`🔄 Starting backup: ${backupId}`);

      // Validate options
      const backupOptions = this.validateBackupOptions(options);
      
      // Register active job
      this.activeJobs.set(backupId, {
        id: backupId,
        startTime,
        status: 'running',
        options: backupOptions
      });

      // Determine backup type
      const backupType = this.determineBackupType(backupOptions);
      
      // Create backup berdasarkan type
      let backupResult;
      switch (backupType) {
        case 'full':
          backupResult = await this.createFullBackup(backupId, backupOptions);
          break;
        case 'incremental':
          backupResult = await this.createIncrementalBackup(backupId, backupOptions);
          break;
        case 'selective':
          backupResult = await this.createSelectiveBackup(backupId, backupOptions);
          break;
        default:
          throw new Error(`Unsupported backup type: ${backupType}`);
      }

      // Post-process backup
      const finalResult = await this.postProcessBackup(backupId, backupResult, backupOptions);

      // Update statistics
      this.updateBackupStatistics(true, finalResult.size, Date.now() - startTime);

      // Cleanup active job
      this.activeJobs.delete(backupId);

      console.log(`✅ Backup completed: ${backupId} (${Date.now() - startTime}ms)`);

      return {
        success: true,
        backupId,
        ...finalResult,
        duration: Date.now() - startTime
      };

    } catch (error) {
      // Update statistics untuk failure
      this.updateBackupStatistics(false, 0, Date.now() - startTime);

      // Cleanup active job
      this.activeJobs.delete(backupId);

      console.error(`❌ Backup failed: ${backupId}`, error);

      return {
        success: false,
        backupId,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Create full backup dari semua data
   */
  async createFullBackup(backupId, options) {
    const backupPath = join(this.config.backupPath, 'full', `${backupId}.zip`);
    
    // Collect data dari berbagai sources
    const dataSources = await this.collectDataSources(options);
    
    // Create compressed archive
    const archiveResult = await this.archiver.createArchive(dataSources, backupPath, {
      compression: this.config.compressionLevel,
      encryption: this.config.enableEncryption ? this.config.encryptionKey : null,
      metadata: {
        backupId,
        type: 'full',
        timestamp: new Date().toISOString(),
        sources: Object.keys(dataSources)
      }
    });

    return {
      type: 'full',
      path: backupPath,
      size: archiveResult.size,
      sources: dataSources,
      metadata: archiveResult.metadata
    };
  }

  /**
   * Create incremental backup berdasarkan changes
   */
  async createIncrementalBackup(backupId, options) {
    const backupPath = join(this.config.backupPath, 'incremental', `${backupId}.zip`);
    
    // Get last backup timestamp
    const lastBackupTime = await this.getLastBackupTimestamp(options);
    
    // Collect changed data since last backup
    const changedData = await this.collectChangedData(lastBackupTime, options);
    
    if (Object.keys(changedData).length === 0) {
      return {
        type: 'incremental',
        path: null,
        size: 0,
        sources: {},
        message: 'No changes detected since last backup'
      };
    }

    // Create incremental archive
    const archiveResult = await this.archiver.createArchive(changedData, backupPath, {
      compression: this.config.compressionLevel,
      encryption: this.config.enableEncryption ? this.config.encryptionKey : null,
      metadata: {
        backupId,
        type: 'incremental',
        timestamp: new Date().toISOString(),
        baseTimestamp: lastBackupTime,
        sources: Object.keys(changedData)
      }
    });

    return {
      type: 'incremental',
      path: backupPath,
      size: archiveResult.size,
      sources: changedData,
      metadata: archiveResult.metadata
    };
  }

  /**
   * Create selective backup untuk specific data
   */
  async createSelectiveBackup(backupId, options) {
    const backupPath = join(this.config.backupPath, 'full', `${backupId}_selective.zip`);
    
    // Filter data berdasarkan criteria
    const selectedData = await this.collectSelectiveData(options);
    
    // Create selective archive
    const archiveResult = await this.archiver.createArchive(selectedData, backupPath, {
      compression: this.config.compressionLevel,
      encryption: this.config.enableEncryption ? this.config.encryptionKey : null,
      metadata: {
        backupId,
        type: 'selective',
        timestamp: new Date().toISOString(),
        criteria: options.criteria,
        sources: Object.keys(selectedData)
      }
    });

    return {
      type: 'selective',
      path: backupPath,
      size: archiveResult.size,
      sources: selectedData,
      metadata: archiveResult.metadata
    };
  }

  /**
   * Restore backup
   * @param {string} backupId - Backup ID to restore
   * @param {Object} options - Restore options
   * @returns {Object} Restore result
   */
  async restoreBackup(backupId, options = {}) {
    try {
      console.log(`🔄 Starting restore: ${backupId}`);

      // Find backup file
      const backupInfo = await this.findBackupFile(backupId);
      if (!backupInfo) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      // Restore using restorer
      const restoreResult = await this.restorer.restoreBackup(backupInfo, options);

      console.log(`✅ Restore completed: ${backupId}`);
      return restoreResult;

    } catch (error) {
      console.error(`❌ Restore failed: ${backupId}`, error);
      throw error;
    }
  }

  /**
   * List available backups
   */
  async listBackups(options = {}) {
    try {
      const { type = 'all', limit = 50, sortBy = 'timestamp' } = options;
      const backups = [];

      // Scan backup directories
      const directories = type === 'all' 
        ? ['full', 'incremental'] 
        : [type];

      for (const dir of directories) {
        const backupDir = join(this.config.backupPath, dir);
        if (existsSync(backupDir)) {
          const files = await this.scanBackupDirectory(backupDir, dir);
          backups.push(...files);
        }
      }

      // Sort dan limit results
      const sorted = this.sortBackups(backups, sortBy);
      return sorted.slice(0, limit);

    } catch (error) {
      throw new Error(`Failed to list backups: ${error.message}`);
    }
  }

  /**
   * Delete backup
   */
  async deleteBackup(backupId) {
    try {
      const backupInfo = await this.findBackupFile(backupId);
      if (!backupInfo) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      // Delete backup file
      const fs = await import('fs/promises');
      await fs.unlink(backupInfo.path);

      console.log(`🗑️ Backup deleted: ${backupId}`);
      return { success: true, backupId, path: backupInfo.path };

    } catch (error) {
      throw new Error(`Failed to delete backup: ${error.message}`);
    }
  }

  /**
   * Archive old backups berdasarkan retention policy
   */
  async archiveOldBackups() {
    try {
      console.log('🔄 Starting backup archival process...');

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionPeriod);

      const backups = await this.listBackups({ type: 'all', limit: 1000 });
      const oldBackups = backups.filter(backup => 
        new Date(backup.timestamp) < cutoffDate
      );

      const archiveResults = [];

      for (const backup of oldBackups) {
        try {
          // Move ke archived directory
          const archivedPath = join(this.config.backupPath, 'archived', backup.filename);
          const fs = await import('fs/promises');
          await fs.rename(backup.path, archivedPath);

          archiveResults.push({
            backupId: backup.id,
            originalPath: backup.path,
            archivedPath,
            success: true
          });

          console.log(`📦 Archived backup: ${backup.id}`);
        } catch (error) {
          archiveResults.push({
            backupId: backup.id,
            error: error.message,
            success: false
          });
        }
      }

      this.statistics.retentionCleanups++;

      return {
        totalProcessed: oldBackups.length,
        successful: archiveResults.filter(r => r.success).length,
        failed: archiveResults.filter(r => !r.success).length,
        results: archiveResults
      };

    } catch (error) {
      throw new Error(`Archival process failed: ${error.message}`);
    }
  }

  /**
   * Setup scheduled backups
   */
  setupScheduledBackups() {
    try {
      if (this.scheduledJobs.has('main')) {
        this.scheduledJobs.get('main').stop();
      }

      const task = cron.schedule(this.config.backupSchedule, async () => {
        try {
          console.log('⏰ Starting scheduled backup...');
          
          const result = await this.createBackup({
            type: 'incremental',
            automated: true
          });

          console.log('✅ Scheduled backup completed:', result.backupId);
        } catch (error) {
          console.error('❌ Scheduled backup failed:', error);
        }
      }, {
        scheduled: false
      });

      this.scheduledJobs.set('main', task);
      task.start();

      // Calculate next run
      this.updateNextScheduledBackup();

      console.log(`⏰ Scheduled backups enabled: ${this.config.backupSchedule}`);
    } catch (error) {
      console.error('❌ Failed to setup scheduled backups:', error);
    }
  }

  /**
   * Helper methods
   */
  generateBackupId() {
    const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
    const random = Math.random().toString(36).substr(2, 6);
    return `backup_${timestamp}_${random}`;
  }

  validateBackupOptions(options) {
    return {
      type: options.type || 'incremental',
      includeUserData: options.includeUserData !== false,
      includeSystemData: options.includeSystemData !== false,
      includeLogs: options.includeLogs || false,
      criteria: options.criteria || {},
      compression: options.compression !== false,
      encryption: options.encryption || this.config.enableEncryption,
      ...options
    };
  }

  determineBackupType(options) {
    if (options.type) return options.type;
    if (options.criteria && Object.keys(options.criteria).length > 0) return 'selective';
    return this.config.enableIncrementalBackup ? 'incremental' : 'full';
  }

  async collectDataSources(options) {
    // Mock implementation - dalam production akan collect dari storage layers
    const dataSources = {};

    if (options.includeUserData) {
      dataSources.users = { type: 'database', table: 'users' };
      dataSources.notes = { type: 'database', table: 'notes' };
      dataSources.sessions = { type: 'database', table: 'sessions' };
    }

    if (options.includeSystemData) {
      dataSources.config = { type: 'files', path: './config' };
      dataSources.uploads = { type: 'files', path: './uploads' };
    }

    if (options.includeLogs) {
      dataSources.logs = { type: 'elasticsearch', index: 'logs' };
    }

    return dataSources;
  }

  async getLastBackupTimestamp(options) {
    try {
      const backups = await this.listBackups({ type: 'all', limit: 1 });
      return backups.length > 0 ? backups[0].timestamp : null;
    } catch (error) {
      return null;
    }
  }

  async collectChangedData(since, options) {
    // Mock implementation - dalam production akan query changed data
    const changedData = {};

    if (since && options.includeUserData) {
      // Collect data yang berubah since timestamp
      changedData.notes_changed = { 
        type: 'database', 
        table: 'notes',
        where: `updated_at > '${since}'`
      };
    }

    return changedData;
  }

  async collectSelectiveData(options) {
    const { criteria } = options;
    const selectedData = {};

    // Apply criteria untuk select data
    if (criteria.userId) {
      selectedData.user_data = {
        type: 'database',
        table: 'notes',
        where: `user_id = '${criteria.userId}'`
      };
    }

    if (criteria.dateRange) {
      selectedData.date_filtered = {
        type: 'database',
        table: 'notes',
        where: `created_at BETWEEN '${criteria.dateRange.from}' AND '${criteria.dateRange.to}'`
      };
    }

    return selectedData;
  }

  async postProcessBackup(backupId, backupResult, options) {
    // Verify backup integrity
    if (backupResult.path && existsSync(backupResult.path)) {
      const stats = statSync(backupResult.path);
      backupResult.size = stats.size;
      backupResult.verified = true;
    }

    // Check size limits
    if (backupResult.size > this.config.maxBackupSize) {
      console.warn(`⚠️ Backup size (${backupResult.size}) exceeds limit (${this.config.maxBackupSize})`);
    }

    return backupResult;
  }

  async findBackupFile(backupId) {
    const directories = ['full', 'incremental', 'archived'];
    
    for (const dir of directories) {
      const backupDir = join(this.config.backupPath, dir);
      if (existsSync(backupDir)) {
        const fs = await import('fs/promises');
        const files = await fs.readdir(backupDir);
        
        const matchingFile = files.find(file => file.includes(backupId));
        if (matchingFile) {
          const fullPath = join(backupDir, matchingFile);
          const stats = statSync(fullPath);
          
          return {
            id: backupId,
            filename: matchingFile,
            path: fullPath,
            type: dir,
            size: stats.size,
            timestamp: stats.mtime.toISOString()
          };
        }
      }
    }

    return null;
  }

  async scanBackupDirectory(directory, type) {
    const fs = await import('fs/promises');
    const files = await fs.readdir(directory);
    const backups = [];

    for (const file of files) {
      if (file.endsWith('.zip')) {
        const fullPath = join(directory, file);
        const stats = statSync(fullPath);
        
        backups.push({
          id: this.extractBackupId(file),
          filename: file,
          path: fullPath,
          type,
          size: stats.size,
          timestamp: stats.mtime.toISOString()
        });
      }
    }

    return backups;
  }

  extractBackupId(filename) {
    // Extract backup ID dari filename
    const match = filename.match(/backup_(\d+T\d+Z_\w+)/);
    return match ? match[1] : filename.replace('.zip', '');
  }

  sortBackups(backups, sortBy) {
    return backups.sort((a, b) => {
      switch (sortBy) {
        case 'timestamp':
          return new Date(b.timestamp) - new Date(a.timestamp);
        case 'size':
          return b.size - a.size;
        case 'type':
          return a.type.localeCompare(b.type);
        default:
          return 0;
      }
    });
  }

  updateBackupStatistics(success, size, duration) {
    this.statistics.totalBackups++;
    
    if (success) {
      this.statistics.successfulBackups++;
      this.statistics.totalDataBackedUp += size;
      this.statistics.lastBackupTime = new Date().toISOString();
    } else {
      this.statistics.failedBackups++;
    }
  }

  updateNextScheduledBackup() {
    // Calculate next cron execution
    try {
      const cronParser = require('cron-parser');
      const interval = cronParser.parseExpression(this.config.backupSchedule);
      this.statistics.nextScheduledBackup = interval.next().toString();
    } catch (error) {
      this.statistics.nextScheduledBackup = 'Invalid schedule';
    }
  }

  /**
   * Get comprehensive statistics
   */
  getStatistics() {
    const uptime = Date.now() - this.statistics.startTime;
    
    return {
      ...this.statistics,
      uptime,
      successRate: this.statistics.totalBackups > 0 
        ? this.statistics.successfulBackups / this.statistics.totalBackups 
        : 0,
      averageBackupSize: this.statistics.successfulBackups > 0
        ? this.statistics.totalDataBackedUp / this.statistics.successfulBackups
        : 0,
      activeJobs: this.activeJobs.size,
      scheduledJobs: this.scheduledJobs.size,
      config: this.config
    };
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    this.scheduledJobs.forEach(job => job.stop());
    this.scheduledJobs.clear();
    console.log('🛑 Backup manager stopped');
  }
}

/**
 * Default backup manager instance
 */
const backupManager = new BackupManager();

export default backupManager;

/**
 * Named exports
 */
export { archiver, restorer };