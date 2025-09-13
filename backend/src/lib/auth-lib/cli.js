#!/usr/bin/env node

/**
 * Auth Library CLI - Command Line Interface for Testing
 * 
 * CLI untuk testing dan debugging authentication functionality
 * Mendukung token generation, validation, dan utilities lainnya
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { program } from 'commander';
import authLib from './index.js';
import chalk from 'chalk';

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

// Command: Generate Token
program
  .command('generate-token')
  .alias('gen')
  .description('Generate JWT access token')
  .option('-u, --user-id <userId>', 'User ID', 'test-user-123')
  .option('-r, --roles <roles>', 'User roles (comma separated)', 'user')
  .option('-p, --permissions <permissions>', 'User permissions (comma separated)', '')
  .option('-e, --expires <expires>', 'Token expiration', '15m')
  .option('--include-refresh', 'Include refresh token')
  .action((options) => {
    try {
      const payload = {
        userId: options.userId,
        roles: options.roles.split(',').map(r => r.trim()),
        email: `${options.userId}@example.com`
      };

      if (options.permissions) {
        payload.permissions = options.permissions.split(',').map(p => p.trim());
      }

      if (options.includeRefresh) {
        const tokens = authLib.generateTokenPair(payload);
        printResult('Token Pair Generated', tokens);
      } else {
        const token = authLib.generateAccessToken(payload, { expiresIn: options.expires });
        printResult('Access Token Generated', { 
          token, 
          payload,
          expiresIn: options.expires 
        });
      }
    } catch (error) {
      printResult('Token Generation Failed', { error: error.message }, false);
    }
  });

// Command: Validate Token
program
  .command('validate-token')
  .alias('validate')
  .description('Validate JWT token')
  .argument('<token>', 'JWT token to validate')
  .option('--no-expiry-check', 'Skip expiry validation')
  .action((token, options) => {
    try {
      const validationOptions = {};
      if (options.noExpiryCheck) {
        validationOptions.ignoreExpiration = true;
      }

      const result = authLib.validateToken(token, validationOptions);
      
      if (result.valid) {
        const expiration = authLib.getTokenExpiration(token);
        printResult('Token Validation', {
          ...result,
          expiration
        });
      } else {
        printResult('Token Validation Failed', result, false);
      }
    } catch (error) {
      printResult('Token Validation Error', { error: error.message }, false);
    }
  });

// Command: Decode Token
program
  .command('decode-token')
  .alias('decode')
  .description('Decode JWT token without validation')
  .argument('<token>', 'JWT token to decode')
  .action((token) => {
    try {
      const decoded = authLib.decodeToken(token);
      const expiration = authLib.getTokenExpiration(token);
      
      printResult('Token Decoded', {
        header: decoded.header,
        payload: decoded.payload,
        signature: decoded.signature ? 'Present' : 'None',
        expiration
      });
    } catch (error) {
      printResult('Token Decode Failed', { error: error.message }, false);
    }
  });

// Command: Refresh Token
program
  .command('refresh-token')
  .alias('refresh')
  .description('Refresh access token using refresh token')
  .argument('<refreshToken>', 'Refresh token')
  .action((refreshToken) => {
    try {
      const newTokens = authLib.refreshTokens(refreshToken);
      printResult('Tokens Refreshed', newTokens);
    } catch (error) {
      printResult('Token Refresh Failed', { error: error.message }, false);
    }
  });

// Command: Hash Password
program
  .command('hash-password')
  .alias('hash')
  .description('Hash password using bcrypt')
  .argument('<password>', 'Password to hash')
  .option('-r, --rounds <rounds>', 'Salt rounds', '12')
  .action(async (password, options) => {
    try {
      const saltRounds = parseInt(options.rounds);
      const hash = await authLib.hashPassword(password, saltRounds);
      
      printResult('Password Hashed', {
        password: password.length > 8 ? password.substring(0, 8) + '...' : password,
        hash,
        saltRounds
      });
    } catch (error) {
      printResult('Password Hashing Failed', { error: error.message }, false);
    }
  });

// Command: Verify Password
program
  .command('verify-password')
  .alias('verify')
  .description('Verify password against hash')
  .argument('<password>', 'Plain text password')
  .argument('<hash>', 'Password hash')
  .action(async (password, hash) => {
    try {
      const isValid = await authLib.verifyPassword(password, hash);
      
      printResult('Password Verification', {
        password: password.length > 8 ? password.substring(0, 8) + '...' : password,
        hash: hash.substring(0, 20) + '...',
        valid: isValid
      }, isValid);
    } catch (error) {
      printResult('Password Verification Failed', { error: error.message }, false);
    }
  });

// Command: Token Info
program
  .command('token-info')
  .alias('info')
  .description('Get detailed token information')
  .argument('<token>', 'JWT token')
  .action((token) => {
    try {
      const decoded = authLib.decodeToken(token);
      const validation = authLib.validateToken(token);
      const expiration = authLib.getTokenExpiration(token);
      
      printResult('Token Information', {
        header: decoded.header,
        payload: decoded.payload,
        validation: {
          valid: validation.valid,
          expired: validation.expired,
          error: validation.error
        },
        expiration,
        tokenLength: token.length,
        tokenPreview: token.substring(0, 50) + '...'
      });
    } catch (error) {
      printResult('Token Info Failed', { error: error.message }, false);
    }
  });

// Command: Performance Test
program
  .command('perf-test')
  .description('Run performance test for token operations')
  .option('-c, --count <count>', 'Number of operations', '1000')
  .action(async (options) => {
    const count = parseInt(options.count);
    console.log(chalk.blue(`🚀 Running performance test with ${count} operations...\n`));

    try {
      // Test token generation
      console.time('Token Generation');
      const tokens = [];
      for (let i = 0; i < count; i++) {
        tokens.push(authLib.generateAccessToken({ userId: `user-${i}` }));
      }
      console.timeEnd('Token Generation');

      // Test token validation
      console.time('Token Validation');
      let validCount = 0;
      for (const token of tokens) {
        const result = authLib.validateToken(token);
        if (result.valid) validCount++;
      }
      console.timeEnd('Token Validation');

      // Test password hashing
      console.time('Password Hashing');
      const hashes = [];
      for (let i = 0; i < Math.min(count, 100); i++) { // Limit karena bcrypt slow
        hashes.push(await authLib.hashPassword(`password-${i}`));
      }
      console.timeEnd('Password Hashing');

      printResult('Performance Test Results', {
        operations: count,
        tokensGenerated: tokens.length,
        tokensValidated: validCount,
        passwordsHashed: hashes.length,
        averageTokenLength: Math.round(tokens.reduce((sum, t) => sum + t.length, 0) / tokens.length)
      });
    } catch (error) {
      printResult('Performance Test Failed', { error: error.message }, false);
    }
  });

// Command: Interactive Mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(() => {
    console.log(chalk.blue('🔐 Auth Library Interactive Mode'));
    console.log(chalk.gray('Available commands: generate, validate, decode, refresh, hash, verify, info, exit'));
    console.log('');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    function prompt() {
      rl.question(chalk.cyan('auth> '), async (input) => {
        const args = input.trim().split(' ');
        const command = args[0];

        try {
          switch (command) {
            case 'generate':
              const token = authLib.generateAccessToken({ userId: args[1] || 'test-user' });
              console.log(chalk.green('Token:'), token);
              break;

            case 'validate':
              if (!args[1]) {
                console.log(chalk.red('Usage: validate <token>'));
                break;
              }
              const validation = authLib.validateToken(args[1]);
              console.log(validation.valid ? chalk.green('Valid') : chalk.red('Invalid'));
              if (!validation.valid) console.log(chalk.red('Error:'), validation.error);
              break;

            case 'decode':
              if (!args[1]) {
                console.log(chalk.red('Usage: decode <token>'));
                break;
              }
              const decoded = authLib.decodeToken(args[1]);
              console.log(JSON.stringify(decoded.payload, null, 2));
              break;

            case 'hash':
              if (!args[1]) {
                console.log(chalk.red('Usage: hash <password>'));
                break;
              }
              const hash = await authLib.hashPassword(args[1]);
              console.log(chalk.green('Hash:'), hash);
              break;

            case 'exit':
              rl.close();
              return;

            default:
              console.log(chalk.yellow('Unknown command. Available: generate, validate, decode, hash, exit'));
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
  .name('auth-cli')
  .description('CLI for testing MCP Server Auth Library')
  .version('1.0.0');

// Handle unknown commands
program.on('command:*', function (operands) {
  console.error(chalk.red(`❌ Unknown command: ${operands[0]}`));
  console.log(chalk.yellow('💡 Run "auth-cli --help" to see available commands'));
  process.exit(1);
});

// Parse arguments
if (process.argv.length === 2) {
  program.help();
} else {
  program.parse();
}

export default program;