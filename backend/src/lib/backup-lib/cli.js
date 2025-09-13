#!/usr/bin/env node

/**
 * Backup Library CLI - Command Line Interface for Backup Operations
 * 
 * CLI untuk testing dan debugging backup functionality
 * Mendukung backup creation, restoration, archival, dan management
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { program } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import backupManager from './index.js';
import archiver from './archiver.js';
import restorer from './restore.js';

// Helper function untuk format output
function formatOutput(data, format = 'json') {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  return data;
}

// Helper function untuk print hasil
function printResult(title, data, success = true) {
  console.log(success ? chalk.green(`✅ ${title}`) : chalk.red(`❌ ${title}`));
  console.log(formatOutput(data));
  console.log('');
}

// Helper function untuk format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Command: Create Backup
program
  .command('create')
  .description('Create a new backup')
  .option('-t, --type <type>', 'Backup type (full, incremental, selective)', 'incremental')
  .option('-o, --output <path>', 'Output directory for backup', './backups')
  .option('--include-user-data', 'Include user data', true)
  .option('--include-system-data', 'Include system data', true)
  .option('--include-logs', 'Include logs', false)
  .option('-c, --compression <level>', 'Compression level (0-9)', '6')
  .option('--encrypt', 'Enable encryption', false)
  .option('--key <key>', 'Encryption key')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`📦 Creating ${options.type} backup...\n`));

      const backupOptions = {
        type: options.type,
        includeUserData: options.includeUserData,
        includeSystemData: options.includeSystemData,
        includeLogs: options.includeLogs,
        compression: parseInt(options.compression),
        encryption: options.encrypt ? (options.key || 'default-key') : null
      };

      // Configure backup manager
      const customBackupManager = new backupManager.constructor({
        backupPath: options.output,
        compressionLevel: parseInt(options.compression),
        enableEncryption: options.encrypt,
        encryptionKey: options.key
      });

      const result = await customBackupManager.createBackup(backupOptions);

      printResult('Backup Creation', {
        backupId: result.backupId,
        success: result.success,
        type: result.type,
        size: result.size ? formatBytes(result.size) : 'N/A',
        compressionRatio: result.compressionRatio ? 
          `${(result.compressionRatio * 100).toFixed(1)}%` : 'N/A',
        duration: `${result.duration}ms`,
        path: result.path,
        error: result.error
      }, result.success);

    } catch (error) {
      printResult('Backup Creation Failed', { error: error.message }, false);
    }
  });

// Command: Restore Backup
program
  .command('restore')
  .description('Restore a backup')
  .requiredOption('-i, --id <backupId>', 'Backup ID to restore')
  .option('-p, --path <path>', 'Restore path', './restore')
  .option('--overwrite', 'Overwrite existing files', false)
  .option('--partial', 'Allow partial restore', false)
  .option('--key <key>', 'Decryption key for encrypted backups')
  .option('--include-types <types>', 'Include only these types (comma-separated)')
  .option('--exclude-types <types>', 'Exclude these types (comma-separated)')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`🔄 Restoring backup: ${options.id}...\n`));

      // Mock backup info - dalam production akan query dari database
      const backupInfo = {
        id: options.id,
        path: `./backups/full/${options.id}.zip`,
        size: 1024 * 1024, // 1MB mock
        timestamp: new Date().toISOString()
      };

      // Check jika backup file ada
      if (!existsSync(backupInfo.path)) {
        throw new Error(`Backup file not found: ${backupInfo.path}`);
      }

      const restoreOptions = {
        restorePath: options.path,
        overwriteExisting: options.overwrite,
        allowPartialRestore: options.partial,
        encryptionKey: options.key,
        continueOnError: true
      };

      // Add selective restore options
      if (options.includeTypes) {
        restoreOptions.selectiveRestore = {
          includeTypes: options.includeTypes.split(',').map(t => t.trim())
        };
      }

      if (options.excludeTypes) {
        restoreOptions.selectiveRestore = restoreOptions.selectiveRestore || {};
        restoreOptions.selectiveRestore.excludeTypes = options.excludeTypes.split(',').map(t => t.trim());
      }

      // Configure restorer
      const customRestorer = new restorer.constructor({
        restorePath: options.path,
        overwriteExisting: options.overwrite,
        enablePartialRestore: options.partial
      });

      const result = await customRestorer.restoreBackup(backupInfo, restoreOptions);

      printResult('Backup Restore', {
        restoreId: result.restoreId,
        backupId: result.backupId,
        success: result.success,
        restoredEntries: result.successCount || 0,
        failedEntries: result.failureCount || 0,
        totalSize: result.totalSize ? formatBytes(result.totalSize) : 'N/A',
        duration: `${result.duration}ms`,
        error: result.error
      }, result.success);

    } catch (error) {
      printResult('Restore Failed', { error: error.message }, false);
    }
  });

// Command: List Backups
program
  .command('list')
  .description('List available backups')
  .option('-t, --type <type>', 'Filter by backup type (full, incremental)', 'all')
  .option('-l, --limit <limit>', 'Maximum number of backups to show', '10')
  .option('-s, --sort <sort>', 'Sort by (timestamp, size, type)', 'timestamp')
  .action(async (options) => {
    try {
      const backups = await backupManager.listBackups({
        type: options.type,
        limit: parseInt(options.limit),
        sortBy: options.sort
      });

      printResult('Available Backups', {
        count: backups.length,
        backups: backups.map(backup => ({
          id: backup.id,
          type: backup.type,
          filename: backup.filename,
          size: formatBytes(backup.size),
          timestamp: backup.timestamp,
          age: this.calculateAge(backup.timestamp)
        }))
      });

    } catch (error) {
      printResult('List Backups Failed', { error: error.message }, false);
    }
  });

// Command: Delete Backup
program
  .command('delete')
  .description('Delete a backup')
  .requiredOption('-i, --id <backupId>', 'Backup ID to delete')
  .option('--confirm', 'Confirm deletion without prompt', false)
  .action(async (options) => {
    try {
      if (!options.confirm) {
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        const confirmed = await new Promise((resolve) => {
          rl.question(chalk.yellow(`⚠️  Are you sure you want to delete backup ${options.id}? (y/N): `), (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
          });
        });

        if (!confirmed) {
          console.log(chalk.gray('Operation cancelled.'));
          return;
        }
      }

      const result = await backupManager.deleteBackup(options.id);

      printResult('Backup Deletion', {
        backupId: result.backupId,
        deleted: result.success,
        path: result.path
      }, result.success);

    } catch (error) {
      printResult('Delete Backup Failed', { error: error.message }, false);
    }
  });

// Command: Archive Old Backups
program
  .command('archive')
  .description('Archive old backups based on retention policy')
  .option('-d, --days <days>', 'Archive backups older than N days', '180')
  .option('--dry-run', 'Show what would be archived without doing it', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue(`📦 Archiving backups older than ${options.days} days...\n`));

      if (options.dryRun) {
        console.log(chalk.yellow('🔍 DRY RUN - No files will be moved\n'));
      }

      // Configure backup manager dengan retention period
      const customBackupManager = new backupManager.constructor({
        retentionPeriod: parseInt(options.days)
      });

      const result = await customBackupManager.archiveOldBackups();

      printResult('Backup Archival', {
        totalProcessed: result.totalProcessed,
        successful: result.successful,
        failed: result.failed,
        results: result.results.slice(0, 10).map(r => ({
          backupId: r.backupId,
          success: r.success,
          archivedPath: r.archivedPath,
          error: r.error
        }))
      }, result.failed === 0);

    } catch (error) {
      printResult('Archival Failed', { error: error.message }, false);
    }
  });

// Command: Create Archive
program
  .command('create-archive')
  .description('Create custom archive from data sources')
  .requiredOption('-s, --sources <sources>', 'JSON file containing data sources')
  .requiredOption('-o, --output <output>', 'Output archive path')
  .option('-c, --compression <level>', 'Compression level (0-9)', '6')
  .option('--encrypt', 'Enable encryption', false)
  .option('--key <key>', 'Encryption key')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`📦 Creating custom archive: ${options.output}...\n`));

      // Read data sources
      const sourcesData = JSON.parse(readFileSync(options.sources, 'utf8'));

      const archiveOptions = {
        compression: parseInt(options.compression),
        encryption: options.encrypt ? (options.key || 'default-key') : null,
        metadata: {
          created: new Date().toISOString(),
          sources: Object.keys(sourcesData)
        }
      };

      const result = await archiver.createArchive(sourcesData, options.output, archiveOptions);

      printResult('Archive Creation', {
        success: result.success,
        path: result.path,
        originalSize: formatBytes(result.originalSize),
        compressedSize: formatBytes(result.compressedSize),
        compressionRatio: `${(result.compressionRatio * 100).toFixed(1)}%`,
        entryCount: result.metadata?.archive?.entryCount || 0,
        processingTime: `${result.processingTime}ms`
      }, result.success);

    } catch (error) {
      printResult('Archive Creation Failed', { error: error.message }, false);
    }
  });

// Command: Test Backup/Restore Cycle
program
  .command('test-cycle')
  .description('Test complete backup and restore cycle')
  .option('-t, --type <type>', 'Backup type to test', 'full')
  .option('--cleanup', 'Cleanup test files after completion', true)
  .action(async (options) => {
    console.log(chalk.blue(`🧪 Testing backup/restore cycle with ${options.type} backup...\n`));

    try {
      // Step 1: Create test backup
      console.log(chalk.cyan('Step 1: Creating test backup...'));
      const backupResult = await backupManager.createBackup({
        type: options.type,
        includeUserData: true,
        includeSystemData: false,
        includeLogs: false
      });

      if (!backupResult.success) {
        throw new Error(`Backup creation failed: ${backupResult.error}`);
      }

      console.log(chalk.green(`✅ Backup created: ${backupResult.backupId}`));

      // Step 2: Test restore
      console.log(chalk.cyan('\nStep 2: Testing restore...'));
      
      // Mock backup info
      const backupInfo = {
        id: backupResult.backupId,
        path: backupResult.path,
        size: backupResult.size,
        timestamp: new Date().toISOString()
      };

      const restoreResult = await restorer.restoreBackup(backupInfo, {
        restorePath: './test-restore',
        continueOnError: true
      });

      if (!restoreResult.success) {
        throw new Error(`Restore failed: ${restoreResult.error}`);
      }

      console.log(chalk.green(`✅ Restore completed: ${restoreResult.restoreId}`));

      // Step 3: Cleanup
      if (options.cleanup) {
        console.log(chalk.cyan('\nStep 3: Cleaning up test files...'));
        
        // Delete test backup
        try {
          await backupManager.deleteBackup(backupResult.backupId);
          console.log(chalk.green('✅ Test backup deleted'));
        } catch (error) {
          console.log(chalk.yellow('⚠️ Failed to delete test backup:', error.message));
        }

        // Cleanup restore directory
        try {
          const fs = require('fs');
          if (fs.existsSync('./test-restore')) {
            fs.rmSync('./test-restore', { recursive: true, force: true });
            console.log(chalk.green('✅ Test restore directory cleaned'));
          }
        } catch (error) {
          console.log(chalk.yellow('⚠️ Failed to cleanup restore directory:', error.message));
        }
      }

      printResult('Backup/Restore Cycle Test', {
        backupCreation: {
          success: backupResult.success,
          backupId: backupResult.backupId,
          size: formatBytes(backupResult.size || 0),
          duration: `${backupResult.duration}ms`
        },
        restore: {
          success: restoreResult.success,
          restoreId: restoreResult.restoreId,
          restoredEntries: restoreResult.successCount || 0,
          duration: `${restoreResult.duration}ms`
        },
        overallSuccess: backupResult.success && restoreResult.success
      });

    } catch (error) {
      printResult('Test Cycle Failed', { error: error.message }, false);
    }
  });

// Command: Statistics
program
  .command('stats')
  .description('Show backup system statistics')
  .option('--component <component>', 'Show stats for specific component (backup, archive, restore)')
  .action(async (options) => {
    try {
      const stats = {};

      if (!options.component || options.component === 'backup') {
        stats.backup = backupManager.getStatistics();
      }

      if (!options.component || options.component === 'archive') {
        stats.archive = archiver.getStatistics();
      }

      if (!options.component || options.component === 'restore') {
        stats.restore = restorer.getStatistics();
      }

      // Format statistics untuk better readability
      const formattedStats = Object.entries(stats).reduce((acc, [component, data]) => {
        acc[component] = {
          ...data,
          totalDataBackedUp: data.totalDataBackedUp ? formatBytes(data.totalDataBackedUp) : undefined,
          totalBytesProcessed: data.totalBytesProcessed ? formatBytes(data.totalBytesProcessed) : undefined,
          totalBytesRestored: data.totalBytesRestored ? formatBytes(data.totalBytesRestored) : undefined,
          averageBackupSize: data.averageBackupSize ? formatBytes(data.averageBackupSize) : undefined,
          uptime: data.uptime ? `${Math.round(data.uptime / 1000)}s` : undefined
        };
        return acc;
      }, {});

      printResult('Backup System Statistics', formattedStats);

    } catch (error) {
      printResult('Statistics Failed', { error: error.message }, false);
    }
  });

// Command: Interactive Mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive backup management mode')
  .action(() => {
    console.log(chalk.blue('💾 Backup Management Interactive Mode'));
    console.log(chalk.gray('Available commands: create, restore, list, delete, archive, stats, exit'));
    console.log('');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    function prompt() {
      rl.question(chalk.cyan('backup> '), async (input) => {
        const args = input.trim().split(' ');
        const command = args[0];

        try {
          switch (command) {
            case 'create':
              console.log(chalk.blue('Creating incremental backup...'));
              const backupResult = await backupManager.createBackup({ type: 'incremental' });
              console.log(backupResult.success ? 
                chalk.green(`✅ Backup created: ${backupResult.backupId}`) :
                chalk.red(`❌ Backup failed: ${backupResult.error}`)
              );
              break;

            case 'list':
              const backups = await backupManager.listBackups({ limit: 5 });
              console.log(chalk.green(`Found ${backups.length} backups:`));
              backups.forEach((backup, i) => {
                console.log(chalk.cyan(`${i + 1}. ${backup.id} (${backup.type}, ${formatBytes(backup.size)})`));
              });
              break;

            case 'stats':
              const stats = backupManager.getStatistics();
              console.log(chalk.green('Statistics:'));
              console.log(chalk.cyan(`Total backups: ${stats.totalBackups}`));
              console.log(chalk.cyan(`Success rate: ${(stats.successRate * 100).toFixed(1)}%`));
              console.log(chalk.cyan(`Data backed up: ${formatBytes(stats.totalDataBackedUp)}`));
              break;

            case 'archive':
              console.log(chalk.blue('Archiving old backups...'));
              const archiveResult = await backupManager.archiveOldBackups();
              console.log(chalk.green(`✅ Archived ${archiveResult.successful} backups`));
              break;

            case 'exit':
              rl.close();
              return;

            default:
              console.log(chalk.yellow('Unknown command. Available: create, restore, list, delete, archive, stats, exit'));
          }
        } catch (error) {
          console.log(chalk.red('Error:'), error.message);
        }

        console.log('');
        prompt();
      });
    }

    prompt();
  });

// Helper method untuk calculate age
function calculateAge(timestamp) {
  const now = new Date();
  const created = new Date(timestamp);
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

// Setup program
program
  .name('backup-cli')
  .description('CLI for testing MCP Server Backup Library')
  .version('1.0.0');

// Handle unknown commands
program.on('command:*', function (operands) {
  console.error(chalk.red(`❌ Unknown command: ${operands[0]}`));
  console.log(chalk.yellow('💡 Run "backup-cli --help" to see available commands'));
  process.exit(1);
});

// Parse arguments
if (process.argv.length === 2) {
  program.help();
} else {
  program.parse();
}

export default program;