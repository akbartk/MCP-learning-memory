#!/usr/bin/env node

/**
 * Storage Library CLI - Command Line Interface for Database Operations
 * 
 * CLI untuk testing dan debugging database functionality
 * Mendukung Redis, ScyllaDB, dan Elasticsearch operations
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { program } from 'commander';
import chalk from 'chalk';
import storageManager from './index.js';

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

// Helper function untuk init storage
async function initializeStorage() {
  try {
    console.log(chalk.blue('🔌 Initializing storage connections...\n'));
    await storageManager.initialize();
    return true;
  } catch (error) {
    printResult('Storage Initialization Failed', { error: error.message }, false);
    process.exit(1);
  }
}

// Command: Health Check
program
  .command('health')
  .description('Check health of all database connections')
  .action(async () => {
    await initializeStorage();
    
    try {
      const health = await storageManager.updateHealthStatus();
      const stats = await storageManager.getStatistics();
      
      printResult('Database Health Status', {
        health,
        statistics: stats
      });
    } catch (error) {
      printResult('Health Check Failed', { error: error.message }, false);
    } finally {
      await storageManager.close();
    }
  });

// Command: Redis Operations
program
  .command('redis')
  .description('Redis database operations')
  .option('-a, --action <action>', 'Action to perform', 'ping')
  .option('-k, --key <key>', 'Redis key', 'test-key')
  .option('-v, --value <value>', 'Redis value', 'test-value')
  .option('-t, --ttl <ttl>', 'TTL in seconds', '300')
  .action(async (options) => {
    await initializeStorage();
    
    try {
      const redis = await storageManager.cache();
      let result;

      switch (options.action) {
        case 'ping':
          result = await redis.healthCheck();
          printResult('Redis Ping', { connected: result });
          break;

        case 'set':
          result = await redis.set(options.key, options.value, { ttl: parseInt(options.ttl) });
          printResult('Redis SET', { key: options.key, value: options.value, result });
          break;

        case 'get':
          result = await redis.get(options.key);
          printResult('Redis GET', { key: options.key, value: result });
          break;

        case 'del':
          result = await redis.del(options.key);
          printResult('Redis DELETE', { key: options.key, deleted: result });
          break;

        case 'stats':
          result = await redis.getStatistics();
          printResult('Redis Statistics', result);
          break;

        case 'test':
          // Comprehensive test
          const testKey = `test-${Date.now()}`;
          const testValue = { message: 'Hello Redis!', timestamp: new Date().toISOString() };
          
          await redis.set(testKey, testValue, { ttl: 60 });
          const retrieved = await redis.get(testKey);
          const exists = await redis.exists(testKey);
          const ttl = await redis.ttl(testKey);
          await redis.del(testKey);
          
          printResult('Redis Comprehensive Test', {
            set: 'success',
            get: retrieved,
            exists,
            ttl,
            cleanup: 'success'
          });
          break;

        default:
          console.log(chalk.red('Unknown Redis action. Available: ping, set, get, del, stats, test'));
      }
    } catch (error) {
      printResult('Redis Operation Failed', { error: error.message }, false);
    } finally {
      await storageManager.close();
    }
  });

// Command: ScyllaDB Operations
program
  .command('scylla')
  .description('ScyllaDB database operations')
  .option('-a, --action <action>', 'Action to perform', 'ping')
  .option('-q, --query <query>', 'CQL query', 'SELECT now() FROM system.local')
  .action(async (options) => {
    await initializeStorage();
    
    try {
      const scylla = await storageManager.persistence();
      let result;

      switch (options.action) {
        case 'ping':
          result = await scylla.healthCheck();
          printResult('ScyllaDB Ping', { connected: result });
          break;

        case 'query':
          result = await scylla.execute(options.query);
          printResult('ScyllaDB Query', { 
            query: options.query,
            rows: result.rows,
            rowCount: result.rowLength 
          });
          break;

        case 'stats':
          result = await scylla.getStatistics();
          printResult('ScyllaDB Statistics', result);
          break;

        case 'test':
          // Test basic operations
          const testUser = {
            id: require('uuid').v4(),
            username: `testuser_${Date.now()}`,
            email: `test${Date.now()}@example.com`,
            passwordHash: 'test-hash',
            roles: ['user'],
            permissions: ['read'],
            metadata: { source: 'cli-test' }
          };

          await scylla.createUser(testUser);
          const retrieved = await scylla.getUserById(testUser.id);
          
          printResult('ScyllaDB Comprehensive Test', {
            created: testUser.id,
            retrieved: retrieved ? 'success' : 'failed',
            userData: retrieved
          });
          break;

        default:
          console.log(chalk.red('Unknown ScyllaDB action. Available: ping, query, stats, test'));
      }
    } catch (error) {
      printResult('ScyllaDB Operation Failed', { error: error.message }, false);
    } finally {
      await storageManager.close();
    }
  });

// Command: Elasticsearch Operations  
program
  .command('elastic')
  .description('Elasticsearch operations')
  .option('-a, --action <action>', 'Action to perform', 'ping')
  .option('-i, --index <index>', 'Index type', 'notes')
  .option('-q, --query <query>', 'Search query', 'test')
  .action(async (options) => {
    await initializeStorage();
    
    try {
      const elastic = await storageManager.search();
      let result;

      switch (options.action) {
        case 'ping':
          result = await elastic.healthCheck();
          printResult('Elasticsearch Ping', { connected: result });
          break;

        case 'search':
          result = await elastic.fullTextSearch(options.index, options.query, { size: 5 });
          printResult('Elasticsearch Search', {
            query: options.query,
            index: options.index,
            totalHits: result.total,
            hits: result.hits
          });
          break;

        case 'stats':
          result = await elastic.getStatistics();
          printResult('Elasticsearch Statistics', result);
          break;

        case 'test':
          // Test indexing dan search
          const testNote = {
            id: require('uuid').v4(),
            userId: 'test-user',
            title: 'Test Note from CLI',
            content: 'This is a test note created from the CLI tool to verify Elasticsearch functionality.',
            summary: 'CLI test note',
            tags: ['test', 'cli'],
            category: 'testing',
            priority: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: { source: 'cli-test' }
          };

          await elastic.indexNote(testNote);
          
          // Wait sedikit untuk indexing
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const searchResult = await elastic.fullTextSearch('notes', 'CLI test', { size: 1 });
          
          printResult('Elasticsearch Comprehensive Test', {
            indexed: testNote.id,
            searchResults: searchResult.total,
            found: searchResult.hits.length > 0 ? 'success' : 'failed'
          });
          break;

        default:
          console.log(chalk.red('Unknown Elasticsearch action. Available: ping, search, stats, test'));
      }
    } catch (error) {
      printResult('Elasticsearch Operation Failed', { error: error.message }, false);
    } finally {
      await storageManager.close();
    }
  });

// Command: Backup Operations
program
  .command('backup')
  .description('Backup all databases')
  .option('-p, --path <path>', 'Backup path', './backups')
  .option('--redis', 'Include Redis backup', true)
  .option('--scylla', 'Include ScyllaDB backup', true)
  .option('--elastic', 'Include Elasticsearch backup', true)
  .action(async (options) => {
    await initializeStorage();
    
    try {
      const backupOptions = {
        backupPath: options.path,
        includeRedis: options.redis,
        includeScylla: options.scylla,
        includeElasticsearch: options.elastic
      };

      const result = await storageManager.backup(backupOptions);
      printResult('Database Backup', result);
    } catch (error) {
      printResult('Backup Failed', { error: error.message }, false);
    } finally {
      await storageManager.close();
    }
  });

// Command: Performance Test
program
  .command('perf-test')
  .description('Run performance test on all databases')
  .option('-c, --count <count>', 'Number of operations', '100')
  .action(async (options) => {
    const count = parseInt(options.count);
    console.log(chalk.blue(`🚀 Running performance test with ${count} operations...\n`));

    await initializeStorage();

    try {
      const startTime = Date.now();
      
      // Redis performance test
      console.time('Redis Operations');
      const redis = await storageManager.cache();
      for (let i = 0; i < count; i++) {
        await redis.set(`perf-test-${i}`, { data: `value-${i}`, timestamp: Date.now() }, { ttl: 60 });
      }
      for (let i = 0; i < count; i++) {
        await redis.get(`perf-test-${i}`);
      }
      console.timeEnd('Redis Operations');

      // ScyllaDB performance test (smaller count karena lebih lambat)
      const scyllaCount = Math.min(count, 50);
      console.time('ScyllaDB Operations');
      const scylla = await storageManager.persistence();
      for (let i = 0; i < scyllaCount; i++) {
        const testUser = {
          id: require('uuid').v4(),
          username: `perftest_${i}`,
          email: `perftest${i}@example.com`,
          passwordHash: 'test-hash',
          roles: ['user'],
          permissions: ['read']
        };
        await scylla.createUser(testUser);
      }
      console.timeEnd('ScyllaDB Operations');

      // Elasticsearch performance test
      console.time('Elasticsearch Operations');
      const elastic = await storageManager.search();
      const bulkOps = [];
      for (let i = 0; i < count; i++) {
        bulkOps.push({
          action: 'index',
          indexType: 'notes',
          id: `perf-test-${i}`,
          document: {
            title: `Performance Test Note ${i}`,
            content: `This is performance test note number ${i}`,
            user_id: 'perf-test-user',
            created_at: new Date().toISOString()
          }
        });
      }
      await elastic.bulk(bulkOps);
      console.timeEnd('Elasticsearch Operations');

      const totalTime = Date.now() - startTime;

      printResult('Performance Test Results', {
        totalOperations: count,
        totalTime: `${totalTime}ms`,
        averageTime: `${Math.round(totalTime / count)}ms per operation`,
        redis: `${count * 2} operations (set + get)`,
        scylla: `${scyllaCount} user creations`,
        elasticsearch: `${count} document indexing`
      });

    } catch (error) {
      printResult('Performance Test Failed', { error: error.message }, false);
    } finally {
      await storageManager.close();
    }
  });

// Command: Transaction Test
program
  .command('transaction')
  .description('Test transaction across multiple databases')
  .action(async (options) => {
    await initializeStorage();

    try {
      const transactionId = require('uuid').v4();
      
      const result = await storageManager.transaction({
        redis: async (redis) => {
          await redis.set(`transaction:${transactionId}`, {
            status: 'started',
            timestamp: new Date().toISOString()
          }, { ttl: 300 });
          return 'Redis operation completed';
        },
        
        scylla: async (scylla) => {
          const user = {
            id: transactionId,
            username: `transaction_user`,
            email: `transaction@example.com`,
            passwordHash: 'test-hash',
            roles: ['user'],
            permissions: ['read']
          };
          await scylla.createUser(user);
          return 'ScyllaDB operation completed';
        },
        
        elasticsearch: async (elastic) => {
          await elastic.index('logs', {
            message: 'Transaction test log',
            level: 'info',
            transaction_id: transactionId,
            timestamp: new Date().toISOString()
          });
          return 'Elasticsearch operation completed';
        }
      });

      printResult('Transaction Test', {
        transactionId,
        results: result
      });

    } catch (error) {
      printResult('Transaction Test Failed', { error: error.message }, false);
    } finally {
      await storageManager.close();
    }
  });

// Command: Interactive Mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(async () => {
    console.log(chalk.blue('💾 Storage Library Interactive Mode'));
    console.log(chalk.gray('Available commands: redis, scylla, elastic, health, stats, exit'));
    console.log('');

    await initializeStorage();

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    function prompt() {
      rl.question(chalk.cyan('storage> '), async (input) => {
        const args = input.trim().split(' ');
        const command = args[0];

        try {
          switch (command) {
            case 'redis':
              const redis = await storageManager.cache();
              const redisResult = await redis.healthCheck();
              console.log(chalk.green('Redis:'), redisResult ? 'Connected' : 'Disconnected');
              break;

            case 'scylla':
              const scylla = await storageManager.persistence();
              const scyllaResult = await scylla.healthCheck();
              console.log(chalk.green('ScyllaDB:'), scyllaResult ? 'Connected' : 'Disconnected');
              break;

            case 'elastic':
              const elastic = await storageManager.search();
              const elasticResult = await elastic.healthCheck();
              console.log(chalk.green('Elasticsearch:'), elasticResult ? 'Connected' : 'Disconnected');
              break;

            case 'health':
              const health = await storageManager.updateHealthStatus();
              console.log(JSON.stringify(health, null, 2));
              break;

            case 'stats':
              const stats = await storageManager.getStatistics();
              console.log(JSON.stringify(stats, null, 2));
              break;

            case 'exit':
              await storageManager.close();
              rl.close();
              return;

            default:
              console.log(chalk.yellow('Unknown command. Available: redis, scylla, elastic, health, stats, exit'));
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

// Setup program
program
  .name('storage-cli')
  .description('CLI for testing MCP Server Storage Library')
  .version('1.0.0');

// Handle unknown commands
program.on('command:*', function (operands) {
  console.error(chalk.red(`❌ Unknown command: ${operands[0]}`));
  console.log(chalk.yellow('💡 Run "storage-cli --help" to see available commands'));
  process.exit(1);
});

// Parse arguments
if (process.argv.length === 2) {
  program.help();
} else {
  program.parse();
}

export default program;