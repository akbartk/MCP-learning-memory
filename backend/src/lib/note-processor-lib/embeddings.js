/**
 * Embeddings Generator - Vector Embeddings for Semantic Search
 * 
 * Menyediakan functionality untuk generate vector embeddings
 * Mendukung berbagai embedding providers dan local models
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

/**
 * Embeddings Class untuk generate vector embeddings
 */
export class EmbeddingsGenerator {
  constructor(config = {}) {
    this.config = {
      provider: config.provider || process.env.EMBEDDING_PROVIDER || 'openai',
      model: config.model || process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      dimensions: config.dimensions || 1536,
      maxTokens: config.maxTokens || 8191,
      batchSize: config.batchSize || 10,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000,
      cache: config.cache !== false,
      ...config
    };

    this.embeddingCache = new Map();
    this.statistics = {
      totalEmbeddings: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      totalTokens: 0,
      startTime: Date.now()
    };

    // Initialize provider
    this.initializeProvider();
  }

  /**
   * Initialize embedding provider
   */
  initializeProvider() {
    switch (this.config.provider) {
      case 'openai':
        this.generateEmbedding = this.generateOpenAIEmbedding.bind(this);
        break;
      case 'local':
        this.generateEmbedding = this.generateLocalEmbedding.bind(this);
        break;
      case 'mock':
        this.generateEmbedding = this.generateMockEmbedding.bind(this);
        break;
      default:
        throw new Error(`Unsupported embedding provider: ${this.config.provider}`);
    }
  }

  /**
   * Generate embedding untuk single text
   * @param {string} text - Text untuk di-embed
   * @param {Object} options - Options
   * @returns {Array} Vector embedding
   */
  async generateEmbedding(text, options = {}) {
    // Akan di-override oleh provider-specific method
    throw new Error('generateEmbedding method should be overridden by provider');
  }

  /**
   * Generate embeddings untuk multiple texts (batch)
   * @param {Array} texts - Array of texts
   * @param {Object} options - Options
   * @returns {Array} Array of embeddings
   */
  async generateBatchEmbeddings(texts, options = {}) {
    const results = [];
    const errors = [];

    // Split into chunks berdasarkan batch size
    const chunks = this.chunkArray(texts, this.config.batchSize);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      
      try {
        const chunkResults = await Promise.all(
          chunk.map(async (text, index) => {
            try {
              const embedding = await this.generateEmbedding(text, options);
              return {
                index: chunkIndex * this.config.batchSize + index,
                text,
                embedding,
                success: true
              };
            } catch (error) {
              this.statistics.errors++;
              return {
                index: chunkIndex * this.config.batchSize + index,
                text,
                embedding: null,
                success: false,
                error: error.message
              };
            }
          })
        );

        results.push(...chunkResults);
      } catch (error) {
        // Chunk-level error
        chunk.forEach((text, index) => {
          errors.push({
            index: chunkIndex * this.config.batchSize + index,
            text,
            error: error.message
          });
        });
      }
    }

    return {
      results,
      successful: results.filter(r => r.success),
      failed: results.filter(r => !r.success),
      totalProcessed: texts.length,
      successRate: results.filter(r => r.success).length / texts.length
    };
  }

  /**
   * OpenAI embedding implementation
   */
  async generateOpenAIEmbedding(text, options = {}) {
    try {
      const processedText = this.preprocessText(text);
      
      // Check cache first
      if (this.config.cache) {
        const cached = this.getCachedEmbedding(processedText);
        if (cached) {
          this.statistics.cacheHits++;
          return cached;
        }
        this.statistics.cacheMisses++;
      }

      // Validate API key
      if (!this.config.apiKey) {
        throw new Error('OpenAI API key is required');
      }

      // Estimate tokens dan truncate jika perlu
      const estimatedTokens = this.estimateTokens(processedText);
      let finalText = processedText;
      
      if (estimatedTokens > this.config.maxTokens) {
        finalText = this.truncateText(processedText, this.config.maxTokens);
        console.warn(`⚠️ Text truncated from ${estimatedTokens} to ${this.config.maxTokens} tokens`);
      }

      const response = await this.makeOpenAIRequest(finalText, options);
      const embedding = response.data[0].embedding;

      // Validate embedding
      if (!Array.isArray(embedding) || embedding.length !== this.config.dimensions) {
        throw new Error(`Invalid embedding dimensions: expected ${this.config.dimensions}, got ${embedding.length}`);
      }

      // Cache the result
      if (this.config.cache) {
        this.setCachedEmbedding(processedText, embedding);
      }

      // Update statistics
      this.statistics.totalEmbeddings++;
      this.statistics.totalTokens += response.usage.total_tokens;

      return embedding;
    } catch (error) {
      this.statistics.errors++;
      throw new Error(`OpenAI embedding failed: ${error.message}`);
    }
  }

  /**
   * Local embedding implementation (placeholder untuk future local models)
   */
  async generateLocalEmbedding(text, options = {}) {
    try {
      // Placeholder implementation
      // Dalam implementasi nyata, ini akan menggunakan local model seperti:
      // - sentence-transformers
      // - Universal Sentence Encoder
      // - atau model lainnya

      const processedText = this.preprocessText(text);
      
      // Check cache
      if (this.config.cache) {
        const cached = this.getCachedEmbedding(processedText);
        if (cached) {
          this.statistics.cacheHits++;
          return cached;
        }
        this.statistics.cacheMisses++;
      }

      // Generate pseudo-embedding berdasarkan text features
      const embedding = this.generatePseudoEmbedding(processedText);

      // Cache the result
      if (this.config.cache) {
        this.setCachedEmbedding(processedText, embedding);
      }

      this.statistics.totalEmbeddings++;
      return embedding;
    } catch (error) {
      this.statistics.errors++;
      throw new Error(`Local embedding failed: ${error.message}`);
    }
  }

  /**
   * Mock embedding untuk testing
   */
  async generateMockEmbedding(text, options = {}) {
    try {
      const processedText = this.preprocessText(text);
      
      // Generate deterministic mock embedding berdasarkan text hash
      const hash = this.simpleHash(processedText);
      const embedding = Array.from({ length: this.config.dimensions }, (_, i) => {
        return Math.sin((hash + i) * 0.001) * Math.cos((hash - i) * 0.002);
      });

      // Normalize vector
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      const normalizedEmbedding = embedding.map(val => val / magnitude);

      this.statistics.totalEmbeddings++;
      return normalizedEmbedding;
    } catch (error) {
      this.statistics.errors++;
      throw new Error(`Mock embedding failed: ${error.message}`);
    }
  }

  /**
   * Make request ke OpenAI API dengan retry logic
   */
  async makeOpenAIRequest(text, options = {}, attempt = 1) {
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: text,
          model: this.config.model,
          ...options
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt < this.config.retryAttempts) {
        console.warn(`⚠️ OpenAI request failed (attempt ${attempt}), retrying...`);
        await this.sleep(this.config.retryDelay * attempt);
        return this.makeOpenAIRequest(text, options, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Preprocess text sebelum embedding
   */
  preprocessText(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid text input for embedding');
    }

    return text
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s\.\,\!\?\-]/g, '') // Remove special chars except basic punctuation
      .substring(0, 10000); // Limit length
  }

  /**
   * Estimate token count (rough approximation)
   */
  estimateTokens(text) {
    // OpenAI menggunakan BPE tokenization
    // Estimasi kasar: 1 token ≈ 4 characters untuk English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Truncate text untuk fit dalam token limit
   */
  truncateText(text, maxTokens) {
    const estimatedMaxChars = maxTokens * 4;
    if (text.length <= estimatedMaxChars) return text;

    // Truncate dan coba preserve word boundaries
    let truncated = text.substring(0, estimatedMaxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > estimatedMaxChars * 0.8) {
      truncated = truncated.substring(0, lastSpace);
    }

    return truncated;
  }

  /**
   * Generate pseudo-embedding untuk local/testing
   */
  generatePseudoEmbedding(text) {
    const features = this.extractTextFeatures(text);
    const embedding = new Array(this.config.dimensions).fill(0);

    // Generate embedding berdasarkan text features
    features.forEach((value, index) => {
      const targetIndex = index % this.config.dimensions;
      embedding[targetIndex] += value * 0.1;
    });

    // Add some randomness berdasarkan text hash
    const hash = this.simpleHash(text);
    for (let i = 0; i < this.config.dimensions; i++) {
      embedding[i] += Math.sin((hash + i) * 0.001) * 0.01;
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / (magnitude || 1));
  }

  /**
   * Extract basic text features
   */
  extractTextFeatures(text) {
    const features = [];
    
    // Length features
    features.push(text.length / 1000);
    features.push(text.split(' ').length / 100);
    features.push(text.split('.').length / 10);
    
    // Character frequency features
    const charCounts = {};
    for (const char of text.toLowerCase()) {
      charCounts[char] = (charCounts[char] || 0) + 1;
    }
    
    // Add top character frequencies
    const sortedChars = Object.entries(charCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 50);
    
    sortedChars.forEach(([char, count]) => {
      features.push(count / text.length);
    });

    return features;
  }

  /**
   * Simple hash function
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Cache methods
   */
  getCachedEmbedding(text) {
    const key = this.getCacheKey(text);
    return this.embeddingCache.get(key);
  }

  setCachedEmbedding(text, embedding) {
    const key = this.getCacheKey(text);
    
    // Limit cache size
    if (this.embeddingCache.size > 1000) {
      const firstKey = this.embeddingCache.keys().next().value;
      this.embeddingCache.delete(firstKey);
    }
    
    this.embeddingCache.set(key, embedding);
  }

  getCacheKey(text) {
    return this.simpleHash(text).toString();
  }

  /**
   * Similarity calculations
   */
  cosineSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  euclideanDistance(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let sum = 0;
    for (let i = 0; i < embedding1.length; i++) {
      const diff = embedding1[i] - embedding2[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }

  /**
   * Utility methods
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get statistics
   */
  getStatistics() {
    const uptime = Date.now() - this.statistics.startTime;
    
    return {
      ...this.statistics,
      uptime,
      averageEmbeddingsPerMinute: this.statistics.totalEmbeddings / (uptime / 1000 / 60),
      cacheHitRate: this.statistics.cacheHits / (this.statistics.cacheHits + this.statistics.cacheMisses),
      errorRate: this.statistics.errors / Math.max(this.statistics.totalEmbeddings + this.statistics.errors, 1),
      cacheSize: this.embeddingCache.size,
      config: this.config
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.embeddingCache.clear();
  }

  /**
   * Reset statistics
   */
  resetStatistics() {
    this.statistics = {
      totalEmbeddings: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      totalTokens: 0,
      startTime: Date.now()
    };
  }
}

/**
 * Default embeddings instance
 */
const embeddings = new EmbeddingsGenerator();

export default embeddings;