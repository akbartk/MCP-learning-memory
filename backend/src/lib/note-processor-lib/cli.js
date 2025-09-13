#!/usr/bin/env node

/**
 * Note Processor Library CLI - Command Line Interface for Note Processing
 * 
 * CLI untuk testing dan debugging note processing functionality
 * Mendukung validation, processing, embedding generation, dan batch operations
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { program } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync } from 'fs';
import noteProcessor from './index.js';
import validator from './validator.js';
import embeddings from './embeddings.js';

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

// Helper function untuk create sample note
function createSampleNote(userId = 'test-user-123') {
  return {
    userId,
    title: 'Sample Note for Testing',
    content: 'This is a sample note content for testing the note processor library. It contains multiple sentences to test summarization. The content includes various features like multiple paragraphs and different topics to test the categorization and tag generation features.',
    tags: ['sample', 'testing'],
    category: 'testing',
    metadata: {
      source: 'cli-test',
      createdBy: 'note-processor-cli'
    }
  };
}

// Command: Validate Note
program
  .command('validate')
  .description('Validate note data')
  .option('-f, --file <file>', 'JSON file containing note data')
  .option('-t, --type <type>', 'Validation schema type', 'note')
  .action(async (options) => {
    try {
      let noteData;

      if (options.file) {
        const fileContent = readFileSync(options.file, 'utf8');
        noteData = JSON.parse(fileContent);
      } else {
        noteData = createSampleNote();
        console.log(chalk.blue('📝 Using sample note data (use -f option to load from file)\n'));
      }

      const result = await validator.validateNote(noteData, options.type);
      
      printResult('Note Validation', {
        input: noteData,
        validation: result
      }, result.valid);

    } catch (error) {
      printResult('Validation Failed', { error: error.message }, false);
    }
  });

// Command: Process Note
program
  .command('process')
  .description('Process note with full pipeline')
  .option('-f, --file <file>', 'JSON file containing note data')
  .option('-o, --output <file>', 'Output file for processed note')
  .option('--no-summary', 'Disable auto summary generation')
  .option('--no-tags', 'Disable auto tag generation')
  .option('--no-embedding', 'Disable embedding generation')
  .action(async (options) => {
    try {
      let noteData;

      if (options.file) {
        const fileContent = readFileSync(options.file, 'utf8');
        noteData = JSON.parse(fileContent);
      } else {
        noteData = createSampleNote();
        console.log(chalk.blue('📝 Using sample note data (use -f option to load from file)\n'));
      }

      // Configure processor
      const config = {
        autoSummarize: options.summary,
        autoTags: options.tags,
        autoEmbeddings: options.embedding
      };

      const processor = new noteProcessor.constructor(config);
      const result = await processor.processNote(noteData);

      if (options.output && result.success) {
        writeFileSync(options.output, JSON.stringify(result.note, null, 2));
        console.log(chalk.green(`💾 Processed note saved to: ${options.output}\n`));
      }

      printResult('Note Processing', result, result.success);

    } catch (error) {
      printResult('Processing Failed', { error: error.message }, false);
    }
  });

// Command: Batch Process
program
  .command('batch')
  .description('Process multiple notes from JSON file')
  .requiredOption('-f, --file <file>', 'JSON file containing array of notes')
  .option('-o, --output <file>', 'Output file for processed notes')
  .option('-c, --concurrency <num>', 'Processing concurrency', '5')
  .option('--continue-on-error', 'Continue processing on errors', false)
  .action(async (options) => {
    try {
      const fileContent = readFileSync(options.file, 'utf8');
      const notesData = JSON.parse(fileContent);

      if (!Array.isArray(notesData)) {
        throw new Error('File must contain an array of notes');
      }

      console.log(chalk.blue(`🔄 Processing ${notesData.length} notes...\n`));

      const batchOptions = {
        concurrency: parseInt(options.concurrency),
        continueOnError: options.continueOnError,
        progressCallback: (progress) => {
          const percentage = Math.round((progress.processed / progress.total) * 100);
          console.log(chalk.cyan(`Progress: ${progress.processed}/${progress.total} (${percentage}%)`));
        }
      };

      const result = await noteProcessor.batchProcess(notesData, batchOptions);

      if (options.output) {
        const outputData = {
          metadata: {
            totalProcessed: result.totalProcessed,
            successful: result.successful.length,
            failed: result.failed.length,
            processingTime: result.totalTime
          },
          successful: result.successful.map(r => r.note),
          failed: result.failed
        };
        
        writeFileSync(options.output, JSON.stringify(outputData, null, 2));
        console.log(chalk.green(`💾 Batch results saved to: ${options.output}\n`));
      }

      printResult('Batch Processing', {
        summary: {
          totalNotes: notesData.length,
          successful: result.successful.length,
          failed: result.failed.length,
          totalTime: `${result.totalTime}ms`,
          averageTime: `${result.averageProcessingTime}ms per note`
        },
        errors: result.failed.map(f => ({ note: f.originalNote?.title, error: f.error }))
      }, result.failed.length === 0);

    } catch (error) {
      printResult('Batch Processing Failed', { error: error.message }, false);
    }
  });

// Command: Generate Embedding
program
  .command('embedding')
  .description('Generate embedding for text')
  .option('-t, --text <text>', 'Text to embed')
  .option('-f, --file <file>', 'File containing text to embed')
  .option('-p, --provider <provider>', 'Embedding provider', 'mock')
  .option('-o, --output <file>', 'Output file for embedding')
  .action(async (options) => {
    try {
      let text;

      if (options.file) {
        text = readFileSync(options.file, 'utf8');
      } else if (options.text) {
        text = options.text;
      } else {
        text = 'This is a sample text for embedding generation testing.';
        console.log(chalk.blue('📝 Using sample text (use -t or -f option to specify text)\n'));
      }

      // Configure embeddings dengan provider
      const embeddingGenerator = new embeddings.constructor({
        provider: options.provider
      });

      console.log(chalk.blue(`🔄 Generating embedding using ${options.provider} provider...\n`));

      const embedding = await embeddingGenerator.generateEmbedding(text);

      const result = {
        text: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
        provider: options.provider,
        dimensions: embedding.length,
        embedding: options.output ? embedding : embedding.slice(0, 10).concat(['...']),
        statistics: embeddingGenerator.getStatistics()
      };

      if (options.output) {
        writeFileSync(options.output, JSON.stringify({ text, embedding }, null, 2));
        console.log(chalk.green(`💾 Embedding saved to: ${options.output}\n`));
      }

      printResult('Embedding Generation', result);

    } catch (error) {
      printResult('Embedding Generation Failed', { error: error.message }, false);
    }
  });

// Command: Similarity Test
program
  .command('similarity')
  .description('Test similarity between two texts')
  .requiredOption('-1, --text1 <text1>', 'First text')
  .requiredOption('-2, --text2 <text2>', 'Second text')
  .option('-p, --provider <provider>', 'Embedding provider', 'mock')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`🔄 Generating embeddings and calculating similarity...\n`));

      const embeddingGenerator = new embeddings.constructor({
        provider: options.provider
      });

      const [embedding1, embedding2] = await Promise.all([
        embeddingGenerator.generateEmbedding(options.text1),
        embeddingGenerator.generateEmbedding(options.text2)
      ]);

      const cosineSim = embeddingGenerator.cosineSimilarity(embedding1, embedding2);
      const euclideanDist = embeddingGenerator.euclideanDistance(embedding1, embedding2);

      printResult('Similarity Analysis', {
        text1: options.text1.substring(0, 100) + (options.text1.length > 100 ? '...' : ''),
        text2: options.text2.substring(0, 100) + (options.text2.length > 100 ? '...' : ''),
        provider: options.provider,
        similarity: {
          cosine: cosineSim,
          euclideanDistance: euclideanDist,
          interpretation: cosineSim > 0.8 ? 'Very Similar' : 
                         cosineSim > 0.6 ? 'Similar' : 
                         cosineSim > 0.4 ? 'Somewhat Similar' : 'Different'
        }
      });

    } catch (error) {
      printResult('Similarity Test Failed', { error: error.message }, false);
    }
  });

// Command: Performance Test
program
  .command('perf-test')
  .description('Run performance test on note processing')
  .option('-c, --count <count>', 'Number of notes to process', '50')
  .option('--embedding-provider <provider>', 'Embedding provider for test', 'mock')
  .action(async (options) => {
    const count = parseInt(options.count);
    console.log(chalk.blue(`🚀 Running performance test with ${count} notes...\n`));

    try {
      // Generate test notes
      const testNotes = Array.from({ length: count }, (_, i) => ({
        userId: 'perf-test-user',
        title: `Performance Test Note ${i + 1}`,
        content: `This is the content for performance test note number ${i + 1}. It contains multiple sentences to test the processing pipeline. The content is designed to trigger summarization, tag generation, and embedding creation. This helps us measure the performance of the note processing library under load.`,
        tags: [`test${i}`, 'performance'],
        metadata: { testIndex: i }
      }));

      // Configure processor dengan fast settings
      const processor = new noteProcessor.constructor({
        autoEmbeddings: true,
        embeddingProvider: options.embeddingProvider
      });

      const startTime = Date.now();
      
      // Test single processing
      console.time('Single Note Processing');
      await processor.processNote(testNotes[0]);
      console.timeEnd('Single Note Processing');

      // Test batch processing
      console.time('Batch Processing');
      const batchResult = await processor.batchProcess(testNotes, {
        concurrency: 5,
        continueOnError: true
      });
      console.timeEnd('Batch Processing');

      const totalTime = Date.now() - startTime;

      printResult('Performance Test Results', {
        totalNotes: count,
        successful: batchResult.successful.length,
        failed: batchResult.failed.length,
        totalTime: `${totalTime}ms`,
        averageTimePerNote: `${Math.round(totalTime / count)}ms`,
        notesPerSecond: Math.round((count / totalTime) * 1000),
        embeddingProvider: options.embeddingProvider,
        processorStats: processor.getStatistics()
      });

    } catch (error) {
      printResult('Performance Test Failed', { error: error.message }, false);
    }
  });

// Command: Statistics
program
  .command('stats')
  .description('Show processor statistics')
  .action(() => {
    try {
      const processorStats = noteProcessor.getStatistics();
      const validatorRules = validator.getValidationRules();
      const embeddingStats = embeddings.getStatistics();

      printResult('Note Processor Statistics', {
        processor: processorStats,
        validator: validatorRules,
        embeddings: embeddingStats
      });

    } catch (error) {
      printResult('Statistics Failed', { error: error.message }, false);
    }
  });

// Command: Interactive Mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(() => {
    console.log(chalk.blue('📝 Note Processor Interactive Mode'));
    console.log(chalk.gray('Available commands: validate, process, embed, similarity, stats, exit'));
    console.log('');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    function prompt() {
      rl.question(chalk.cyan('note-processor> '), async (input) => {
        const args = input.trim().split(' ');
        const command = args[0];

        try {
          switch (command) {
            case 'validate':
              const sampleNote = createSampleNote();
              const validation = await validator.validateNote(sampleNote);
              console.log(validation.valid ? chalk.green('Valid') : chalk.red('Invalid'));
              if (!validation.valid) {
                console.log(chalk.red('Errors:'), validation.errors.join(', '));
              }
              break;

            case 'process':
              const note = createSampleNote();
              const result = await noteProcessor.processNote(note);
              console.log(result.success ? chalk.green('Processed') : chalk.red('Failed'));
              if (result.success) {
                console.log(chalk.green('Summary:'), result.note.summary?.substring(0, 100) + '...');
                console.log(chalk.green('Tags:'), result.note.tags.join(', '));
                console.log(chalk.green('Category:'), result.note.category);
              }
              break;

            case 'embed':
              const text = args.slice(1).join(' ') || 'Sample text for embedding';
              const embedding = await embeddings.generateEmbedding(text);
              console.log(chalk.green('Embedding generated:'), `${embedding.length} dimensions`);
              console.log(chalk.green('First 5 values:'), embedding.slice(0, 5).map(v => v.toFixed(4)));
              break;

            case 'similarity':
              if (args.length < 3) {
                console.log(chalk.red('Usage: similarity <text1> <text2>'));
                break;
              }
              const text1 = args[1];
              const text2 = args[2];
              const emb1 = await embeddings.generateEmbedding(text1);
              const emb2 = await embeddings.generateEmbedding(text2);
              const similarity = embeddings.cosineSimilarity(emb1, emb2);
              console.log(chalk.green('Similarity:'), similarity.toFixed(4));
              break;

            case 'stats':
              const stats = noteProcessor.getStatistics();
              console.log(JSON.stringify(stats, null, 2));
              break;

            case 'exit':
              rl.close();
              return;

            default:
              console.log(chalk.yellow('Unknown command. Available: validate, process, embed, similarity, stats, exit'));
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
  .name('note-processor-cli')
  .description('CLI for testing MCP Server Note Processor Library')
  .version('1.0.0');

// Handle unknown commands
program.on('command:*', function (operands) {
  console.error(chalk.red(`❌ Unknown command: ${operands[0]}`));
  console.log(chalk.yellow('💡 Run "note-processor-cli --help" to see available commands'));
  process.exit(1);
});

// Parse arguments
if (process.argv.length === 2) {
  program.help();
} else {
  program.parse();
}

export default program;