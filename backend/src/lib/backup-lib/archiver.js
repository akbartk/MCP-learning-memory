/**
 * Archiver - Data Archival and Compression
 * 
 * Menyediakan functionality untuk create archives dengan compression,
 * encryption, dan metadata management
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { createWriteStream, createReadStream, statSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { createGzip, createDeflate } from 'zlib';
import { createCipheriv, randomBytes } from 'crypto';

/**
 * Archiver Class untuk create compressed archives
 */
export class Archiver {
  constructor(config = {}) {
    this.config = {
      defaultCompression: config.defaultCompression || 6,
      compressionMethod: config.compressionMethod || 'gzip', // gzip, deflate, none
      encryptionAlgorithm: config.encryptionAlgorithm || 'aes-256-gcm',
      chunkSize: config.chunkSize || 64 * 1024, // 64KB chunks
      enableIntegrityCheck: config.enableIntegrityCheck !== false,
      enableProgress: config.enableProgress !== false,
      ...config
    };

    this.statistics = {
      totalArchives: 0,
      totalBytesProcessed: 0,
      totalCompressionRatio: 0,
      averageCompressionTime: 0,
      startTime: Date.now()
    };
  }

  /**
   * Create archive dari data sources
   * @param {Object} dataSources - Object berisi data sources
   * @param {string} outputPath - Path untuk output archive
   * @param {Object} options - Archive options
   * @returns {Object} Archive result
   */
  async createArchive(dataSources, outputPath, options = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`📦 Creating archive: ${outputPath}`);

      // Validate inputs
      this.validateInputs(dataSources, outputPath);

      // Prepare archive options
      const archiveOptions = this.prepareArchiveOptions(options);

      // Create archive structure
      const archiveData = await this.collectArchiveData(dataSources, archiveOptions);

      // Create compressed archive
      const compressionResult = await this.createCompressedArchive(
        archiveData, 
        outputPath, 
        archiveOptions
      );

      // Add encryption jika enabled
      let finalPath = outputPath;
      if (archiveOptions.encryption) {
        finalPath = await this.encryptArchive(outputPath, archiveOptions.encryption);
      }

      // Generate metadata
      const metadata = await this.generateArchiveMetadata(
        archiveData, 
        finalPath, 
        archiveOptions
      );

      // Update statistics
      const processingTime = Date.now() - startTime;
      this.updateStatistics(archiveData.totalSize, compressionResult.compressedSize, processingTime);

      console.log(`✅ Archive created: ${finalPath} (${processingTime}ms)`);

      return {
        success: true,
        path: finalPath,
        originalSize: archiveData.totalSize,
        compressedSize: compressionResult.compressedSize,
        compressionRatio: compressionResult.compressionRatio,
        metadata,
        processingTime
      };

    } catch (error) {
      console.error(`❌ Archive creation failed: ${outputPath}`, error);
      throw new Error(`Archive creation failed: ${error.message}`);
    }
  }

  /**
   * Collect dan prepare data untuk archiving
   */
  async collectArchiveData(dataSources, options) {
    const archiveData = {
      entries: [],
      totalSize: 0,
      fileCount: 0
    };

    for (const [sourceName, sourceConfig] of Object.entries(dataSources)) {
      console.log(`📂 Processing data source: ${sourceName}`);
      
      try {
        const sourceData = await this.processDataSource(sourceName, sourceConfig, options);
        archiveData.entries.push(...sourceData.entries);
        archiveData.totalSize += sourceData.size;
        archiveData.fileCount += sourceData.fileCount;
      } catch (error) {
        console.warn(`⚠️ Failed to process source ${sourceName}:`, error.message);
        
        if (!options.continueOnError) {
          throw error;
        }
      }
    }

    return archiveData;
  }

  /**
   * Process individual data source
   */
  async processDataSource(sourceName, sourceConfig, options) {
    switch (sourceConfig.type) {
      case 'database':
        return await this.processDatabaseSource(sourceName, sourceConfig, options);
      case 'files':
        return await this.processFileSource(sourceName, sourceConfig, options);
      case 'elasticsearch':
        return await this.processElasticsearchSource(sourceName, sourceConfig, options);
      case 'redis':
        return await this.processRedisSource(sourceName, sourceConfig, options);
      default:
        throw new Error(`Unknown data source type: ${sourceConfig.type}`);
    }
  }

  /**
   * Process database data source
   */
  async processDatabaseSource(sourceName, sourceConfig, options) {
    // Mock implementation - dalam production akan export dari database
    const mockData = {
      table: sourceConfig.table,
      query: sourceConfig.where || 'SELECT * FROM ' + sourceConfig.table,
      timestamp: new Date().toISOString(),
      recordCount: Math.floor(Math.random() * 1000),
      data: [
        { id: 1, name: 'Sample record 1' },
        { id: 2, name: 'Sample record 2' }
      ]
    };

    const jsonString = JSON.stringify(mockData, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    return {
      entries: [{
        name: `${sourceName}.json`,
        path: `database/${sourceName}.json`,
        type: 'database',
        size: buffer.length,
        data: buffer,
        metadata: {
          table: sourceConfig.table,
          recordCount: mockData.recordCount
        }
      }],
      size: buffer.length,
      fileCount: 1
    };
  }

  /**
   * Process file data source
   */
  async processFileSource(sourceName, sourceConfig, options) {
    const entries = [];
    let totalSize = 0;
    let fileCount = 0;

    // Mock implementation - dalam production akan scan filesystem
    const mockFiles = [
      { name: 'config.json', size: 1024 },
      { name: 'settings.yaml', size: 512 },
      { name: 'uploads/image1.jpg', size: 2048 }
    ];

    for (const file of mockFiles) {
      const mockData = Buffer.from(`Mock file content for ${file.name}`, 'utf8');
      
      entries.push({
        name: file.name,
        path: `files/${sourceName}/${file.name}`,
        type: 'file',
        size: mockData.length,
        data: mockData,
        metadata: {
          originalPath: join(sourceConfig.path || '.', file.name),
          mimeType: this.detectMimeType(file.name)
        }
      });

      totalSize += mockData.length;
      fileCount++;
    }

    return { entries, size: totalSize, fileCount };
  }

  /**
   * Process Elasticsearch data source
   */
  async processElasticsearchSource(sourceName, sourceConfig, options) {
    // Mock implementation - dalam production akan export dari Elasticsearch
    const mockData = {
      index: sourceConfig.index,
      query: sourceConfig.query || { match_all: {} },
      timestamp: new Date().toISOString(),
      hits: [
        { _id: '1', _source: { message: 'Log entry 1', level: 'info' } },
        { _id: '2', _source: { message: 'Log entry 2', level: 'error' } }
      ]
    };

    const jsonString = JSON.stringify(mockData, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    return {
      entries: [{
        name: `${sourceName}.json`,
        path: `elasticsearch/${sourceName}.json`,
        type: 'elasticsearch',
        size: buffer.length,
        data: buffer,
        metadata: {
          index: sourceConfig.index,
          hitCount: mockData.hits.length
        }
      }],
      size: buffer.length,
      fileCount: 1
    };
  }

  /**
   * Process Redis data source
   */
  async processRedisSource(sourceName, sourceConfig, options) {
    // Mock implementation - dalam production akan export dari Redis
    const mockData = {
      database: sourceConfig.database || 0,
      keys: {
        'user:1': { name: 'John Doe', email: 'john@example.com' },
        'session:abc123': { userId: 1, expires: '2024-12-31T23:59:59Z' }
      },
      timestamp: new Date().toISOString()
    };

    const jsonString = JSON.stringify(mockData, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    return {
      entries: [{
        name: `${sourceName}.json`,
        path: `redis/${sourceName}.json`,
        type: 'redis',
        size: buffer.length,
        data: buffer,
        metadata: {
          database: sourceConfig.database,
          keyCount: Object.keys(mockData.keys).length
        }
      }],
      size: buffer.length,
      fileCount: 1
    };
  }

  /**
   * Create compressed archive
   */
  async createCompressedArchive(archiveData, outputPath, options) {
    return new Promise((resolve, reject) => {
      try {
        const outputStream = createWriteStream(outputPath);
        let compressionStream;

        // Setup compression
        switch (this.config.compressionMethod) {
          case 'gzip':
            compressionStream = createGzip({ 
              level: options.compression || this.config.defaultCompression 
            });
            break;
          case 'deflate':
            compressionStream = createDeflate({ 
              level: options.compression || this.config.defaultCompression 
            });
            break;
          case 'none':
            compressionStream = null;
            break;
          default:
            throw new Error(`Unknown compression method: ${this.config.compressionMethod}`);
        }

        // Create archive format (simplified ZIP-like structure)
        const archiveBuffer = this.createArchiveBuffer(archiveData);
        let compressedSize = 0;

        const finalStream = compressionStream || outputStream;
        
        if (compressionStream) {
          compressionStream.pipe(outputStream);
          
          compressionStream.on('data', (chunk) => {
            compressedSize += chunk.length;
          });
        }

        finalStream.on('error', reject);
        outputStream.on('error', reject);
        
        outputStream.on('finish', () => {
          const finalSize = compressionStream ? compressedSize : archiveBuffer.length;
          const compressionRatio = archiveData.totalSize > 0 
            ? finalSize / archiveData.totalSize 
            : 1;

          resolve({
            compressedSize: finalSize,
            compressionRatio,
            compressionMethod: this.config.compressionMethod
          });
        });

        // Write archive data
        if (compressionStream) {
          compressionStream.write(archiveBuffer);
          compressionStream.end();
        } else {
          outputStream.write(archiveBuffer);
          outputStream.end();
        }

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create archive buffer dalam simplified format
   */
  createArchiveBuffer(archiveData) {
    const buffers = [];
    
    // Archive header
    const header = {
      version: '1.0',
      created: new Date().toISOString(),
      entryCount: archiveData.entries.length,
      totalSize: archiveData.totalSize
    };
    
    const headerBuffer = Buffer.from(JSON.stringify(header), 'utf8');
    const headerLengthBuffer = Buffer.alloc(4);
    headerLengthBuffer.writeUInt32BE(headerBuffer.length, 0);
    
    buffers.push(headerLengthBuffer);
    buffers.push(headerBuffer);

    // Archive entries
    for (const entry of archiveData.entries) {
      // Entry metadata
      const entryMeta = {
        name: entry.name,
        path: entry.path,
        type: entry.type,
        size: entry.size,
        metadata: entry.metadata
      };
      
      const entryMetaBuffer = Buffer.from(JSON.stringify(entryMeta), 'utf8');
      const entryMetaLengthBuffer = Buffer.alloc(4);
      entryMetaLengthBuffer.writeUInt32BE(entryMetaBuffer.length, 0);
      
      buffers.push(entryMetaLengthBuffer);
      buffers.push(entryMetaBuffer);

      // Entry data
      const entryDataLengthBuffer = Buffer.alloc(4);
      entryDataLengthBuffer.writeUInt32BE(entry.data.length, 0);
      
      buffers.push(entryDataLengthBuffer);
      buffers.push(entry.data);
    }

    return Buffer.concat(buffers);
  }

  /**
   * Encrypt archive jika encryption enabled
   */
  async encryptArchive(archivePath, encryptionKey) {
    if (!encryptionKey) {
      throw new Error('Encryption key required for encryption');
    }

    return new Promise((resolve, reject) => {
      try {
        const encryptedPath = archivePath + '.enc';
        const iv = randomBytes(16);
        const cipher = createCipheriv(this.config.encryptionAlgorithm, encryptionKey, iv);
        
        const inputStream = createReadStream(archivePath);
        const outputStream = createWriteStream(encryptedPath);

        // Write IV first
        outputStream.write(iv);

        inputStream.pipe(cipher).pipe(outputStream);

        outputStream.on('finish', () => {
          // Delete original unencrypted file
          unlinkSync(archivePath);
          resolve(encryptedPath);
        });

        outputStream.on('error', reject);
        inputStream.on('error', reject);
        cipher.on('error', reject);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate archive metadata
   */
  async generateArchiveMetadata(archiveData, archivePath, options) {
    const stats = statSync(archivePath);
    
    const metadata = {
      ...options.metadata,
      archive: {
        version: '1.0',
        created: new Date().toISOString(),
        path: archivePath,
        size: stats.size,
        originalSize: archiveData.totalSize,
        entryCount: archiveData.entries.length,
        fileCount: archiveData.fileCount,
        compression: {
          method: this.config.compressionMethod,
          level: options.compression || this.config.defaultCompression,
          ratio: stats.size / archiveData.totalSize
        },
        encryption: {
          enabled: !!options.encryption,
          algorithm: options.encryption ? this.config.encryptionAlgorithm : null
        }
      },
      entries: archiveData.entries.map(entry => ({
        name: entry.name,
        path: entry.path,
        type: entry.type,
        size: entry.size,
        metadata: entry.metadata
      }))
    };

    // Write metadata file
    const metadataPath = archivePath + '.meta.json';
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return metadata;
  }

  /**
   * Validate inputs
   */
  validateInputs(dataSources, outputPath) {
    if (!dataSources || Object.keys(dataSources).length === 0) {
      throw new Error('Data sources cannot be empty');
    }

    if (!outputPath) {
      throw new Error('Output path is required');
    }

    // Check output directory exists
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      throw new Error(`Output directory does not exist: ${outputDir}`);
    }
  }

  /**
   * Prepare archive options
   */
  prepareArchiveOptions(options) {
    return {
      compression: options.compression !== false ? 
        (options.compression || this.config.defaultCompression) : false,
      encryption: options.encryption || null,
      continueOnError: options.continueOnError !== false,
      metadata: options.metadata || {},
      ...options
    };
  }

  /**
   * Detect MIME type berdasarkan file extension
   */
  detectMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
      json: 'application/json',
      yaml: 'application/x-yaml',
      yml: 'application/x-yaml',
      txt: 'text/plain',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      pdf: 'application/pdf'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Update statistics
   */
  updateStatistics(originalSize, compressedSize, processingTime) {
    this.statistics.totalArchives++;
    this.statistics.totalBytesProcessed += originalSize;
    
    const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;
    this.statistics.totalCompressionRatio = 
      (this.statistics.totalCompressionRatio * (this.statistics.totalArchives - 1) + compressionRatio) / 
      this.statistics.totalArchives;

    this.statistics.averageCompressionTime = 
      (this.statistics.averageCompressionTime * (this.statistics.totalArchives - 1) + processingTime) / 
      this.statistics.totalArchives;
  }

  /**
   * Get statistics
   */
  getStatistics() {
    const uptime = Date.now() - this.statistics.startTime;
    
    return {
      ...this.statistics,
      uptime,
      averageCompressionRatio: this.statistics.totalCompressionRatio,
      bytesPerSecond: uptime > 0 ? this.statistics.totalBytesProcessed / (uptime / 1000) : 0,
      config: this.config
    };
  }
}

/**
 * Default archiver instance
 */
const archiver = new Archiver();

export default archiver;