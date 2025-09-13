#!/usr/bin/env node

/**
 * Search Library CLI - Command Line Interface for Search Testing
 * 
 * CLI untuk testing dan debugging search functionality
 * Mendukung semantic search, pattern matching, dan hybrid search
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { program } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync } from 'fs';
import searchManager from './index.js';
import SemanticSearch from './semantic.js';
import PatternMatcher from './pattern-matcher.js';

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

// Sample documents untuk testing
const sampleDocuments = [
  {
    id: 'doc1',
    title: 'Introduction to Machine Learning',
    content: 'Machine learning is a subset of artificial intelligence that focuses on algorithms that can learn from data. It includes supervised learning, unsupervised learning, and reinforcement learning.',
    summary: 'Overview of machine learning fundamentals',
    tags: ['ai', 'machine-learning', 'algorithms'],
    category: 'technology',
    userId: 'user1',
    embedding: Array.from({ length: 1536 }, () => Math.random() - 0.5),
    createdAt: '2024-01-15T10:00:00Z'
  },
  {
    id: 'doc2',
    title: 'JavaScript Async Programming',
    content: 'Asynchronous programming in JavaScript involves promises, async/await, and callbacks. Contact us at support@example.com for more information or call +1-555-123-4567.',
    summary: 'Guide to async JavaScript programming',
    tags: ['javascript', 'programming', 'async'],
    category: 'programming',
    userId: 'user1',
    embedding: Array.from({ length: 1536 }, () => Math.random() - 0.5),
    createdAt: '2024-01-20T14:30:00Z'
  },
  {
    id: 'doc3',
    title: 'Data Science Best Practices',
    content: 'Data science projects require careful planning, data cleaning, feature engineering, and model validation. Always document your process and version your code.',
    summary: 'Best practices for data science projects',
    tags: ['data-science', 'best-practices', 'methodology'],
    category: 'data-science',
    userId: 'user2',
    embedding: Array.from({ length: 1536 }, () => Math.random() - 0.5),
    createdAt: '2024-01-25T09:15:00Z'
  }
];

// Setup sample data
async function setupSampleData() {
  const semanticSearch = new SemanticSearch();
  
  for (const doc of sampleDocuments) {
    await semanticSearch.indexDocument(doc);
  }
  
  return semanticSearch;
}

// Command: Search
program
  .command('search')
  .description('Perform search with various types')
  .option('-q, --query <query>', 'Search query')
  .option('-t, --type <type>', 'Search type (semantic, fulltext, pattern, hybrid)', 'fulltext')
  .option('-l, --limit <limit>', 'Result limit', '5')
  .option('-u, --user <userId>', 'Filter by user ID')
  .option('-o, --output <file>', 'Output file for results')
  .action(async (options) => {
    try {
      if (!options.query) {
        console.log(chalk.blue('📝 Using default query: "machine learning"'));
        options.query = 'machine learning';
      }

      console.log(chalk.blue(`🔍 Performing ${options.type} search for: "${options.query}"\n`));

      // Setup sample data
      await setupSampleData();

      const query = {
        type: options.type,
        text: options.query
      };

      const searchOptions = {
        limit: parseInt(options.limit),
        userId: options.user,
        includeHighlight: true,
        includeMetadata: true
      };

      const results = await searchManager.search(query, searchOptions);

      if (options.output) {
        writeFileSync(options.output, JSON.stringify(results, null, 2));
        console.log(chalk.green(`💾 Results saved to: ${options.output}\n`));
      }

      printResult('Search Results', {
        query: options.query,
        searchType: results.metadata?.searchType || options.type,
        totalResults: results.total,
        responseTime: results.metadata?.responseTime || 0,
        results: results.results.map(r => ({
          id: r.id,
          title: r.title,
          score: r.score,
          summary: r.summary,
          highlight: r.highlight
        }))
      });

    } catch (error) {
      printResult('Search Failed', { error: error.message }, false);
    }
  });

// Command: Semantic Search
program
  .command('semantic')
  .description('Perform semantic search')
  .option('-q, --query <query>', 'Search query')
  .option('-t, --threshold <threshold>', 'Similarity threshold', '0.7')
  .option('-l, --limit <limit>', 'Result limit', '5')
  .action(async (options) => {
    try {
      const query = options.query || 'artificial intelligence algorithms';
      console.log(chalk.blue(`🧠 Performing semantic search for: "${query}"\n`));

      const semanticSearch = await setupSampleData();
      
      const results = await semanticSearch.search({
        text: query,
        embedding: null // Will be generated from text
      }, {
        limit: parseInt(options.limit),
        threshold: parseFloat(options.threshold)
      });

      printResult('Semantic Search Results', {
        query,
        threshold: parseFloat(options.threshold),
        totalResults: results.total,
        averageSimilarity: results.metadata?.averageSimilarity,
        results: results.results.map(r => ({
          id: r.id,
          title: r.title,
          similarity: r.similarity,
          score: r.score,
          summary: r.summary
        }))
      });

    } catch (error) {
      printResult('Semantic Search Failed', { error: error.message }, false);
    }
  });

// Command: Pattern Search
program
  .command('pattern')
  .description('Perform pattern-based search')
  .option('-p, --pattern <pattern>', 'Pattern to search')
  .option('-t, --type <type>', 'Pattern type (regex, wildcard, fuzzy, predefined)', 'regex')
  .option('-l, --limit <limit>', 'Result limit', '5')
  .action(async (options) => {
    try {
      const pattern = options.pattern || (options.type === 'predefined' ? 'email' : '\\d{3}-\\d{3}-\\d{4}');
      console.log(chalk.blue(`🔍 Performing ${options.type} pattern search for: "${pattern}"\n`));

      const patternMatcher = new PatternMatcher();
      
      const query = {
        type: 'pattern'
      };

      // Set pattern berdasarkan type
      switch (options.type) {
        case 'regex':
          query.regex = pattern;
          break;
        case 'wildcard':
          query.pattern = pattern;
          break;
        case 'fuzzy':
          query.fuzzy = true;
          query.text = pattern;
          break;
        case 'predefined':
          query.pattern = pattern;
          break;
      }

      const results = await patternMatcher.search(query, {
        limit: parseInt(options.limit)
      });

      printResult('Pattern Search Results', {
        pattern,
        patternType: options.type,
        totalResults: results.total,
        results: results.results.map(r => ({
          id: r.id,
          title: r.title,
          score: r.score,
          matches: r.matches,
          patternInfo: r.patternInfo
        }))
      });

    } catch (error) {
      printResult('Pattern Search Failed', { error: error.message }, false);
    }
  });

// Command: Hybrid Search
program
  .command('hybrid')
  .description('Perform hybrid search combining multiple methods')
  .option('-q, --query <query>', 'Search query')
  .option('-l, --limit <limit>', 'Result limit', '5')
  .action(async (options) => {
    try {
      const query = options.query || 'machine learning algorithms';
      console.log(chalk.blue(`🔄 Performing hybrid search for: "${query}"\n`));

      await setupSampleData();

      const hybridQuery = {
        type: 'hybrid',
        queries: [
          { type: 'semantic', text: query },
          { type: 'fulltext', text: query },
          { type: 'pattern', pattern: query.split(' ')[0] } // First word as pattern
        ],
        weights: [0.5, 0.3, 0.2]
      };

      const results = await searchManager.search(hybridQuery, {
        limit: parseInt(options.limit)
      });

      printResult('Hybrid Search Results', {
        query,
        searchBreakdown: results.breakdown,
        totalResults: results.total,
        results: results.results.map(r => ({
          id: r.id,
          title: r.title,
          score: r.score,
          sources: r.sources,
          summary: r.summary
        }))
      });

    } catch (error) {
      printResult('Hybrid Search Failed', { error: error.message }, false);
    }
  });

// Command: Index Document
program
  .command('index')
  .description('Index a document for semantic search')
  .option('-f, --file <file>', 'JSON file containing document data')
  .option('-t, --title <title>', 'Document title')
  .option('-c, --content <content>', 'Document content')
  .action(async (options) => {
    try {
      let document;

      if (options.file) {
        const fileContent = readFileSync(options.file, 'utf8');
        document = JSON.parse(fileContent);
      } else if (options.title && options.content) {
        document = {
          id: Date.now().toString(),
          title: options.title,
          content: options.content,
          userId: 'cli-user',
          createdAt: new Date().toISOString(),
          embedding: Array.from({ length: 1536 }, () => Math.random() - 0.5) // Mock embedding
        };
      } else {
        throw new Error('Either provide --file or both --title and --content');
      }

      const semanticSearch = new SemanticSearch();
      await semanticSearch.indexDocument(document);

      printResult('Document Indexed', {
        documentId: document.id,
        title: document.title,
        indexed: true,
        indexSize: semanticSearch.getIndexSize()
      });

    } catch (error) {
      printResult('Indexing Failed', { error: error.message }, false);
    }
  });

// Command: Similarity Test
program
  .command('similarity')
  .description('Test similarity between two texts')
  .requiredOption('-1, --text1 <text1>', 'First text')
  .requiredOption('-2, --text2 <text2>', 'Second text')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`🔍 Testing similarity between texts...\n`));

      const semanticSearch = new SemanticSearch();
      
      // Generate mock embeddings untuk demonstration
      const embedding1 = Array.from({ length: 1536 }, () => Math.random() - 0.5);
      const embedding2 = Array.from({ length: 1536 }, () => Math.random() - 0.5);

      const cosineSimilarity = semanticSearch.calculateCosineSimilarity(embedding1, embedding2);

      // Also test dengan pattern matcher untuk text similarity
      const patternMatcher = new PatternMatcher();
      const textSimilarity = patternMatcher.calculateStringSimilarity(options.text1, options.text2);

      printResult('Similarity Analysis', {
        text1: options.text1.substring(0, 100) + (options.text1.length > 100 ? '...' : ''),
        text2: options.text2.substring(0, 100) + (options.text2.length > 100 ? '...' : ''),
        similarities: {
          cosine: cosineSimilarity,
          textSimilarity: textSimilarity,
          interpretation: {
            cosine: cosineSimilarity > 0.8 ? 'Very Similar' : 
                   cosineSimilarity > 0.6 ? 'Similar' : 
                   cosineSimilarity > 0.4 ? 'Somewhat Similar' : 'Different',
            text: textSimilarity > 0.8 ? 'Very Similar' : 
                  textSimilarity > 0.6 ? 'Similar' : 
                  textSimilarity > 0.4 ? 'Somewhat Similar' : 'Different'
          }
        }
      });

    } catch (error) {
      printResult('Similarity Test Failed', { error: error.message }, false);
    }
  });

// Command: Performance Test
program
  .command('perf-test')
  .description('Run performance test on search operations')
  .option('-c, --count <count>', 'Number of search operations', '20')
  .option('-t, --type <type>', 'Search type to test', 'semantic')
  .action(async (options) => {
    const count = parseInt(options.count);
    console.log(chalk.blue(`🚀 Running performance test with ${count} ${options.type} searches...\n`));

    try {
      await setupSampleData();

      const queries = [
        'machine learning algorithms',
        'javascript programming',
        'data science methodology',
        'artificial intelligence',
        'software development'
      ];

      const startTime = Date.now();
      const results = [];

      for (let i = 0; i < count; i++) {
        const query = queries[i % queries.length];
        const searchStart = Date.now();
        
        try {
          const result = await searchManager.search({
            type: options.type,
            text: query
          }, { limit: 5 });
          
          results.push({
            query,
            responseTime: Date.now() - searchStart,
            resultCount: result.total,
            success: true
          });
        } catch (error) {
          results.push({
            query,
            responseTime: Date.now() - searchStart,
            error: error.message,
            success: false
          });
        }
      }

      const totalTime = Date.now() - startTime;
      const successfulSearches = results.filter(r => r.success);
      const averageResponseTime = successfulSearches.reduce((sum, r) => sum + r.responseTime, 0) / successfulSearches.length;

      printResult('Performance Test Results', {
        searchType: options.type,
        totalSearches: count,
        successful: successfulSearches.length,
        failed: count - successfulSearches.length,
        totalTime: `${totalTime}ms`,
        averageResponseTime: `${Math.round(averageResponseTime)}ms`,
        searchesPerSecond: Math.round((count / totalTime) * 1000),
        breakdown: results.slice(0, 5) // Show first 5 results
      });

    } catch (error) {
      printResult('Performance Test Failed', { error: error.message }, false);
    }
  });

// Command: Statistics
program
  .command('stats')
  .description('Show search statistics')
  .action(async () => {
    try {
      const stats = searchManager.getStatistics();
      
      printResult('Search Library Statistics', stats);

    } catch (error) {
      printResult('Statistics Failed', { error: error.message }, false);
    }
  });

// Command: Interactive Mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive search mode')
  .action(async () => {
    console.log(chalk.blue('🔍 Search Library Interactive Mode'));
    console.log(chalk.gray('Available commands: search, semantic, pattern, similarity, stats, exit'));
    console.log('');

    // Setup sample data
    await setupSampleData();

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    function prompt() {
      rl.question(chalk.cyan('search> '), async (input) => {
        const args = input.trim().split(' ');
        const command = args[0];

        try {
          switch (command) {
            case 'search':
              if (args.length < 2) {
                console.log(chalk.red('Usage: search <query>'));
                break;
              }
              const query = args.slice(1).join(' ');
              const result = await searchManager.search({ text: query }, { limit: 3 });
              console.log(chalk.green(`Found ${result.total} results:`));
              result.results.forEach((r, i) => {
                console.log(chalk.cyan(`${i + 1}. ${r.title} (score: ${r.score?.toFixed(3)})`));
              });
              break;

            case 'semantic':
              if (args.length < 2) {
                console.log(chalk.red('Usage: semantic <query>'));
                break;
              }
              const semQuery = args.slice(1).join(' ');
              const semanticSearch = new SemanticSearch();
              await setupSampleData();
              const semResult = await semanticSearch.search({ text: semQuery }, { limit: 3 });
              console.log(chalk.green(`Found ${semResult.total} semantic results:`));
              semResult.results.forEach((r, i) => {
                console.log(chalk.cyan(`${i + 1}. ${r.title} (similarity: ${r.similarity?.toFixed(3)})`));
              });
              break;

            case 'pattern':
              if (args.length < 2) {
                console.log(chalk.red('Usage: pattern <pattern>'));
                break;
              }
              const pattern = args.slice(1).join(' ');
              const patternMatcher = new PatternMatcher();
              const patResult = await patternMatcher.search({ regex: pattern }, { limit: 3 });
              console.log(chalk.green(`Found ${patResult.total} pattern matches:`));
              patResult.results.forEach((r, i) => {
                console.log(chalk.cyan(`${i + 1}. ${r.title} (score: ${r.score?.toFixed(3)})`));
              });
              break;

            case 'similarity':
              if (args.length < 3) {
                console.log(chalk.red('Usage: similarity <text1> <text2>'));
                break;
              }
              const text1 = args[1];
              const text2 = args[2];
              const patMatcher = new PatternMatcher();
              const similarity = patMatcher.calculateStringSimilarity(text1, text2);
              console.log(chalk.green(`Similarity: ${similarity.toFixed(3)}`));
              break;

            case 'stats':
              const statistics = searchManager.getStatistics();
              console.log(JSON.stringify(statistics, null, 2));
              break;

            case 'exit':
              rl.close();
              return;

            default:
              console.log(chalk.yellow('Unknown command. Available: search, semantic, pattern, similarity, stats, exit'));
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
  .name('search-cli')
  .description('CLI for testing MCP Server Search Library')
  .version('1.0.0');

// Handle unknown commands
program.on('command:*', function (operands) {
  console.error(chalk.red(`❌ Unknown command: ${operands[0]}`));
  console.log(chalk.yellow('💡 Run "search-cli --help" to see available commands'));
  process.exit(1);
});

// Parse arguments
if (process.argv.length === 2) {
  program.help();
} else {
  program.parse();
}

export default program;