/**
 * Semantic Search - Vector-based Similarity Search
 * 
 * Menyediakan semantic search menggunakan vector embeddings
 * Mendukung cosine similarity, vector databases, dan semantic ranking
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

/**
 * Semantic Search Class
 */
export default class SemanticSearch {
  constructor(config = {}) {
    this.config = {
      embeddingDimensions: config.embeddingDimensions || 1536,
      similarityThreshold: config.similarityThreshold || 0.7,
      maxResults: config.maxResults || 50,
      enableReranking: config.enableReranking !== false,
      rerankingModel: config.rerankingModel || 'cosine',
      enableHybridSearch: config.enableHybridSearch !== false,
      hybridWeight: config.hybridWeight || 0.7, // Weight untuk semantic vs text search
      ...config
    };

    this.statistics = {
      totalSearches: 0,
      averageSearchTime: 0,
      totalSimilarityCalculations: 0,
      cacheHits: 0,
      startTime: Date.now()
    };

    // Vector index untuk efficient similarity search
    this.vectorIndex = new Map();
    this.documentVectors = new Map();
    
    // Initialize embedding generator jika tersedia
    this.embeddingGenerator = null;
    this.initializeEmbeddingGenerator();
  }

  /**
   * Initialize embedding generator
   */
  async initializeEmbeddingGenerator() {
    try {
      // Dynamic import untuk avoid circular dependencies
      const { EmbeddingsGenerator } = await import('../note-processor-lib/embeddings.js');
      this.embeddingGenerator = new EmbeddingsGenerator({
        provider: this.config.embeddingProvider || 'mock',
        model: this.config.embeddingModel || 'text-embedding-ada-002'
      });
    } catch (error) {
      console.warn('⚠️ Failed to initialize embedding generator:', error.message);
    }
  }

  /**
   * Main semantic search method
   * @param {Object} query - Search query
   * @param {Object} options - Search options
   * @returns {Object} Search results
   */
  async search(query, options = {}) {
    const startTime = Date.now();
    
    try {
      // Generate query embedding
      const queryEmbedding = await this.getQueryEmbedding(query);
      
      // Search dalam vector space
      const semanticResults = await this.vectorSimilaritySearch(
        queryEmbedding, 
        options
      );

      // Apply reranking jika enabled
      const rankedResults = this.config.enableReranking 
        ? await this.rerankResults(semanticResults, query, options)
        : semanticResults;

      // Post-process results
      const finalResults = this.postProcessSemanticResults(
        rankedResults, 
        query, 
        options
      );

      // Update statistics
      const searchTime = Date.now() - startTime;
      this.updateStatistics(searchTime, semanticResults.length);

      return {
        results: finalResults,
        total: finalResults.length,
        searchType: 'semantic',
        metadata: {
          queryEmbedding: queryEmbedding.slice(0, 5), // First 5 dims untuk preview
          averageSimilarity: this.calculateAverageSimilarity(rankedResults),
          searchTime,
          rerankingApplied: this.config.enableReranking
        }
      };

    } catch (error) {
      throw new Error(`Semantic search failed: ${error.message}`);
    }
  }

  /**
   * Get atau generate embedding untuk query
   */
  async getQueryEmbedding(query) {
    if (query.embedding && Array.isArray(query.embedding)) {
      return query.embedding;
    }

    if (query.text && this.embeddingGenerator) {
      return await this.embeddingGenerator.generateEmbedding(query.text);
    }

    throw new Error('No embedding available for query');
  }

  /**
   * Vector similarity search
   */
  async vectorSimilaritySearch(queryEmbedding, options = {}) {
    const {
      limit = this.config.maxResults,
      threshold = this.config.similarityThreshold,
      userId = null,
      filters = {}
    } = options;

    const results = [];

    // Search through all indexed documents
    for (const [docId, docData] of this.documentVectors.entries()) {
      // Apply user filter
      if (userId && docData.userId !== userId) {
        continue;
      }

      // Apply additional filters
      if (!this.passesFilters(docData, filters)) {
        continue;
      }

      // Calculate similarity
      const similarity = this.calculateCosineSimilarity(
        queryEmbedding, 
        docData.embedding
      );

      // Apply threshold
      if (similarity >= threshold) {
        results.push({
          ...docData,
          similarity,
          score: similarity
        });
      }

      this.statistics.totalSimilarityCalculations++;
    }

    // Sort by similarity dan limit results
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Rerank results menggunakan advanced scoring
   */
  async rerankResults(results, query, options) {
    const rerankingModel = options.rerankingModel || this.config.rerankingModel;

    switch (rerankingModel) {
      case 'cosine':
        return this.cosineReranking(results, query);
      case 'hybrid':
        return await this.hybridReranking(results, query, options);
      case 'learning_to_rank':
        return await this.learningToRankReranking(results, query, options);
      default:
        return results;
    }
  }

  /**
   * Cosine similarity reranking
   */
  cosineReranking(results, query) {
    // Results sudah sorted by similarity, tapi kita bisa add additional factors
    return results.map(result => ({
      ...result,
      score: this.calculateRerankingScore(result, query)
    })).sort((a, b) => b.score - a.score);
  }

  /**
   * Hybrid reranking menggabungkan semantic dan text features
   */
  async hybridReranking(results, query, options) {
    const textQuery = query.text || '';
    
    return results.map(result => {
      const semanticScore = result.similarity;
      const textScore = this.calculateTextScore(result, textQuery);
      
      // Weighted combination
      const hybridScore = (
        this.config.hybridWeight * semanticScore +
        (1 - this.config.hybridWeight) * textScore
      );

      return {
        ...result,
        score: hybridScore,
        scoreBreakdown: {
          semantic: semanticScore,
          text: textScore,
          hybrid: hybridScore
        }
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Learning-to-rank reranking (simplified version)
   */
  async learningToRankReranking(results, query, options) {
    return results.map(result => {
      const features = this.extractRankingFeatures(result, query);
      const score = this.calculateLearningToRankScore(features);
      
      return {
        ...result,
        score,
        rankingFeatures: features
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate reranking score dengan multiple factors
   */
  calculateRerankingScore(result, query) {
    let score = result.similarity;

    // Boost untuk exact title matches
    if (query.text && result.title) {
      const titleMatch = this.calculateTextMatch(query.text, result.title);
      score += titleMatch * 0.2;
    }

    // Boost untuk recent documents
    if (result.updatedAt) {
      const recencyBoost = this.calculateRecencyBoost(result.updatedAt);
      score += recencyBoost * 0.1;
    }

    // Boost untuk high priority documents
    if (result.priority && result.priority > 3) {
      score += 0.1;
    }

    return Math.min(score, 1.0); // Cap at 1.0
  }

  /**
   * Calculate text score untuk hybrid search
   */
  calculateTextScore(result, queryText) {
    if (!queryText) return 0;

    const text = (result.title + ' ' + result.content).toLowerCase();
    const queryWords = queryText.toLowerCase().split(/\s+/);
    
    let matches = 0;
    let totalWords = queryWords.length;

    queryWords.forEach(word => {
      if (text.includes(word)) {
        matches++;
      }
    });

    return totalWords > 0 ? matches / totalWords : 0;
  }

  /**
   * Extract features untuk learning-to-rank
   */
  extractRankingFeatures(result, query) {
    const features = [];

    // Similarity feature
    features.push(result.similarity);

    // Text matching features
    if (query.text) {
      features.push(this.calculateTextMatch(query.text, result.title || ''));
      features.push(this.calculateTextMatch(query.text, result.content || ''));
    }

    // Document features
    features.push(result.priority || 0);
    features.push(this.calculateRecencyBoost(result.updatedAt));
    features.push((result.content || '').length / 1000); // Content length
    features.push((result.tags || []).length); // Number of tags

    // Category features (one-hot encoding for common categories)
    const commonCategories = ['work', 'personal', 'learning', 'ideas'];
    commonCategories.forEach(cat => {
      features.push(result.category === cat ? 1 : 0);
    });

    return features;
  }

  /**
   * Calculate learning-to-rank score (simplified linear model)
   */
  calculateLearningToRankScore(features) {
    // Simplified weights (dalam implementasi nyata, ini akan di-train)
    const weights = [
      0.6,  // similarity
      0.2,  // title match
      0.1,  // content match
      0.05, // priority
      0.03, // recency
      0.01, // content length
      0.01, // tags count
      // Category weights
      0.02, 0.02, 0.02, 0.02
    ];

    let score = 0;
    for (let i = 0; i < Math.min(features.length, weights.length); i++) {
      score += features[i] * weights[i];
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate cosine similarity antara dua vectors
   */
  calculateCosineSimilarity(vector1, vector2) {
    if (vector1.length !== vector2.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (let i = 0; i < vector1.length; i++) {
      dotProduct += vector1[i] * vector2[i];
      magnitude1 += vector1[i] * vector1[i];
      magnitude2 += vector2[i] * vector2[i];
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Calculate text match score
   */
  calculateTextMatch(query, text) {
    if (!query || !text) return 0;

    const queryWords = query.toLowerCase().split(/\s+/);
    const textLower = text.toLowerCase();
    
    let matches = 0;
    queryWords.forEach(word => {
      if (textLower.includes(word)) {
        matches++;
      }
    });

    return queryWords.length > 0 ? matches / queryWords.length : 0;
  }

  /**
   * Calculate recency boost
   */
  calculateRecencyBoost(dateString) {
    if (!dateString) return 0;

    const date = new Date(dateString);
    const now = new Date();
    const daysDiff = (now - date) / (1000 * 60 * 60 * 24);

    // Exponential decay dengan half-life 30 days
    return Math.exp(-daysDiff / 30);
  }

  /**
   * Check jika document passes filters
   */
  passesFilters(document, filters) {
    return Object.entries(filters).every(([key, value]) => {
      const docValue = document[key];
      
      if (Array.isArray(value)) {
        return value.includes(docValue);
      }
      
      if (typeof value === 'object' && (value.min !== undefined || value.max !== undefined)) {
        return (value.min === undefined || docValue >= value.min) &&
               (value.max === undefined || docValue <= value.max);
      }
      
      return docValue === value;
    });
  }

  /**
   * Post-process semantic results
   */
  postProcessSemanticResults(results, query, options) {
    return results.map(result => ({
      id: result.id,
      title: result.title,
      content: result.content,
      summary: result.summary,
      tags: result.tags,
      category: result.category,
      score: result.score || result.similarity,
      similarity: result.similarity,
      userId: result.userId,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      // Add highlight jika diminta
      ...(options.includeHighlight && {
        highlight: this.generateSemanticHighlight(result, query)
      }),
      // Add ranking info
      rankingInfo: {
        semanticScore: result.similarity,
        finalScore: result.score || result.similarity,
        rerankingApplied: this.config.enableReranking
      }
    }));
  }

  /**
   * Generate highlight untuk semantic results
   */
  generateSemanticHighlight(result, query) {
    // Simple highlighting based on query terms
    if (!query.text) return null;

    const queryWords = query.text.toLowerCase().split(/\s+/);
    const highlight = {};

    // Highlight title
    if (result.title) {
      highlight.title = this.highlightText(result.title, queryWords);
    }

    // Highlight content (first few sentences)
    if (result.content) {
      const sentences = result.content.split(/[.!?]+/).slice(0, 3);
      const highlightedSentences = sentences.map(sentence => 
        this.highlightText(sentence.trim(), queryWords)
      );
      highlight.content = highlightedSentences.filter(s => s.includes('<em>'));
    }

    return highlight;
  }

  /**
   * Highlight text dengan query terms
   */
  highlightText(text, queryWords) {
    let highlighted = text;
    queryWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      highlighted = highlighted.replace(regex, `<em>$&</em>`);
    });
    return highlighted;
  }

  /**
   * Index document untuk semantic search
   */
  async indexDocument(document) {
    const { id, embedding, ...metadata } = document;
    
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Document must have a valid embedding');
    }

    if (embedding.length !== this.config.embeddingDimensions) {
      throw new Error(`Embedding must have ${this.config.embeddingDimensions} dimensions`);
    }

    this.documentVectors.set(id, {
      id,
      embedding,
      ...metadata
    });

    return true;
  }

  /**
   * Remove document dari index
   */
  removeDocument(documentId) {
    return this.documentVectors.delete(documentId);
  }

  /**
   * Update document dalam index
   */
  async updateDocument(documentId, updates) {
    const existing = this.documentVectors.get(documentId);
    if (!existing) {
      throw new Error(`Document ${documentId} not found in index`);
    }

    const updated = { ...existing, ...updates };
    this.documentVectors.set(documentId, updated);
    
    return true;
  }

  /**
   * Get document dari index
   */
  getDocument(documentId) {
    return this.documentVectors.get(documentId);
  }

  /**
   * Get semua documents dalam index
   */
  getAllDocuments() {
    return Array.from(this.documentVectors.values());
  }

  /**
   * Calculate average similarity dari results
   */
  calculateAverageSimilarity(results) {
    if (results.length === 0) return 0;
    
    const totalSimilarity = results.reduce((sum, result) => 
      sum + (result.similarity || 0), 0
    );
    
    return totalSimilarity / results.length;
  }

  /**
   * Update statistics
   */
  updateStatistics(searchTime, resultCount) {
    this.statistics.totalSearches++;
    
    // Update average search time
    this.statistics.averageSearchTime = 
      (this.statistics.averageSearchTime * (this.statistics.totalSearches - 1) + searchTime) / 
      this.statistics.totalSearches;
  }

  /**
   * Get statistics
   */
  getStatistics() {
    const uptime = Date.now() - this.statistics.startTime;
    
    return {
      ...this.statistics,
      uptime,
      documentsIndexed: this.documentVectors.size,
      searchesPerMinute: this.statistics.totalSearches / (uptime / 1000 / 60),
      similarityCalculationsPerSearch: this.statistics.totalSimilarityCalculations / Math.max(this.statistics.totalSearches, 1),
      config: this.config
    };
  }

  /**
   * Clear index
   */
  clearIndex() {
    this.documentVectors.clear();
    this.vectorIndex.clear();
  }

  /**
   * Get index size
   */
  getIndexSize() {
    return this.documentVectors.size;
  }
}