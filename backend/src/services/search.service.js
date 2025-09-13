/**
 * Search Service
 * 
 * Service untuk mengelola semua operasi pencarian
 * Menggunakan search-lib untuk semantic search dan pattern matching
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { SearchManager } from '../lib/search-lib/index.js';

/**
 * SearchService Class
 * Mengelola operasi pencarian untuk notes, knowledge, dan experiences
 */
export class SearchService {
  constructor(storageService, config = {}) {
    this.storage = storageService;
    this.searchManager = new SearchManager({
      defaultResultLimit: 10,
      maxResultLimit: 100,
      enableCache: true,
      cacheSize: 1000,
      cacheTTL: 300000, // 5 minutes
      enableAnalytics: true,
      ...config
    });

    // Search performance metrics
    this.metrics = {
      totalSearches: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Search notes dengan berbagai method
   * @param {Object} searchParams - Parameter pencarian
   * @returns {Object} Search results
   */
  async searchNotes(searchParams) {
    const startTime = Date.now();
    
    try {
      const {
        query,
        agent_id,
        limit = 10,
        min_relevance = 0.5,
        search_type = 'auto'
      } = searchParams;

      // Validasi parameters
      if (!query || !agent_id) {
        throw new Error('Query and agent_id are required');
      }

      let searchResults;

      // Determine search method berdasarkan search_type
      switch (search_type) {
        case 'semantic':
          searchResults = await this.executeSemanticSearch(query, agent_id, { limit, min_relevance });
          break;
        case 'fulltext':
          searchResults = await this.executeFullTextSearch(query, agent_id, { limit, min_relevance });
          break;
        case 'hybrid':
          searchResults = await this.executeHybridSearch(query, agent_id, { limit, min_relevance });
          break;
        case 'auto':
        default:
          searchResults = await this.executeAutoSearch(query, agent_id, { limit, min_relevance });
          break;
      }

      // Format results sesuai OpenAPI schema
      const formattedResults = searchResults.results.map(result => ({
        note: result.note || result,
        relevance_score: result.relevance_score || result.score || 0
      }));

      const response = {
        results: formattedResults,
        query_time_ms: Date.now() - startTime
      };

      // Update metrics
      this.updateMetrics(Date.now() - startTime);

      return response;
    } catch (error) {
      throw new Error(`Search notes failed: ${error.message}`);
    }
  }

  /**
   * Get relevant notes untuk task tertentu
   * @param {Object} params - Task parameters
   * @returns {Object} Relevant notes response
   */
  async getRelevantNotes(params) {
    const startTime = Date.now();
    
    try {
      const {
        task_description,
        agent_id,
        max_results = 20
      } = params;

      // Validasi parameters
      if (!task_description || !agent_id) {
        throw new Error('Task description and agent_id are required');
      }

      // Cek cache terlebih dahulu
      const cacheKey = this.generateCacheKey('relevant', { task_description, agent_id, max_results });
      const cachedResult = await this.getCachedResult(cacheKey);
      
      if (cachedResult) {
        return {
          ...cachedResult,
          cache_hit: true
        };
      }

      // Execute multiple search strategies
      const searchStrategies = [
        // Strategy 1: Semantic search untuk understanding
        this.executeSemanticSearch(task_description, agent_id, { 
          limit: Math.floor(max_results * 0.6),
          min_relevance: 0.7 
        }),
        
        // Strategy 2: Keyword extraction dan search
        this.executeKeywordBasedSearch(task_description, agent_id, { 
          limit: Math.floor(max_results * 0.3),
          min_relevance: 0.6 
        }),
        
        // Strategy 3: Pattern matching untuk similar tasks
        this.executePatternSearch(task_description, agent_id, { 
          limit: Math.floor(max_results * 0.1),
          min_relevance: 0.5 
        })
      ];

      const searchResults = await Promise.allSettled(searchStrategies);
      
      // Merge dan deduplicate results
      const mergedResults = this.mergeSearchResults(searchResults, max_results);
      
      // Detect patterns dalam results
      const patterns = this.detectTaskPatterns(mergedResults, task_description);
      
      const response = {
        notes: mergedResults.map(r => r.note || r),
        patterns_detected: patterns,
        cache_hit: false
      };

      // Cache results
      await this.setCachedResult(cacheKey, response, 600); // 10 minutes

      // Update metrics
      this.updateMetrics(Date.now() - startTime);

      return response;
    } catch (error) {
      throw new Error(`Get relevant notes failed: ${error.message}`);
    }
  }

  /**
   * Execute semantic search menggunakan embeddings
   */
  async executeSemanticSearch(query, agentId, options = {}) {
    try {
      // Gunakan Elasticsearch vector search jika available
      const searchQuery = {
        type: 'semantic',
        text: query,
        filters: {
          agent_id: agentId
        }
      };

      return await this.searchManager.semanticSearch(query, {
        ...options,
        filters: { agent_id: agentId }
      });
    } catch (error) {
      console.warn('⚠️ Semantic search failed, falling back to full-text:', error.message);
      return await this.executeFullTextSearch(query, agentId, options);
    }
  }

  /**
   * Execute full-text search menggunakan Elasticsearch
   */
  async executeFullTextSearch(query, agentId, options = {}) {
    const searchClient = await this.storage.search();
    
    const searchQuery = {
      bool: {
        must: [
          {
            match: {
              agent_id: agentId
            }
          },
          {
            multi_match: {
              query,
              fields: [
                'content.action^3',
                'content.result^2',
                'content.learning^2',
                'context.task^1.5',
                'searchable_content'
              ],
              type: 'best_fields',
              minimum_should_match: '70%'
            }
          }
        ]
      }
    };

    const result = await searchClient.search({
      index: 'notes',
      body: {
        query: searchQuery,
        size: options.limit || 10,
        min_score: options.min_relevance || 0.5,
        sort: [
          { _score: { order: 'desc' } },
          { timestamp: { order: 'desc' } }
        ],
        highlight: {
          fields: {
            'content.action': {},
            'content.result': {},
            'content.learning': {},
            'searchable_content': {}
          }
        }
      }
    });

    return {
      results: result.body.hits.hits.map(hit => ({
        note: this.mapNoteFromSearch(hit._source),
        relevance_score: hit._score,
        highlight: hit.highlight
      })),
      total: result.body.hits.total.value,
      searchType: 'fulltext'
    };
  }

  /**
   * Execute hybrid search combining multiple methods
   */
  async executeHybridSearch(query, agentId, options = {}) {
    const queries = [
      { type: 'semantic', text: query },
      { type: 'fulltext', text: query },
      { type: 'pattern', pattern: this.extractPatterns(query) }
    ];

    return await this.searchManager.hybridSearch(queries, {
      ...options,
      filters: { agent_id: agentId },
      weights: [0.5, 0.3, 0.2] // Prioritize semantic search
    });
  }

  /**
   * Auto-select best search method berdasarkan query
   */
  async executeAutoSearch(query, agentId, options = {}) {
    // Determine best search method berdasarkan query characteristics
    const queryLength = query.length;
    const hasSpecificTerms = /\b(error|bug|fix|implement|create|update|delete)\b/i.test(query);
    const hasQuestionWords = /\b(how|what|why|when|where|which)\b/i.test(query);

    if (queryLength > 50 || hasQuestionWords) {
      // Use semantic search for longer queries atau questions
      return await this.executeSemanticSearch(query, agentId, options);
    } else if (hasSpecificTerms) {
      // Use hybrid search for specific technical terms
      return await this.executeHybridSearch(query, agentId, options);
    } else {
      // Use full-text search for general queries
      return await this.executeFullTextSearch(query, agentId, options);
    }
  }

  /**
   * Execute keyword-based search
   */
  async executeKeywordBasedSearch(text, agentId, options = {}) {
    const keywords = this.extractKeywords(text);
    const keywordQuery = keywords.join(' ');
    
    return await this.executeFullTextSearch(keywordQuery, agentId, options);
  }

  /**
   * Execute pattern search
   */
  async executePatternSearch(text, agentId, options = {}) {
    const patterns = this.extractPatterns(text);
    
    return await this.searchManager.patternSearch(patterns, {
      ...options,
      filters: { agent_id: agentId }
    });
  }

  /**
   * Merge search results dari multiple strategies
   */
  mergeSearchResults(searchResults, maxResults) {
    const resultMap = new Map();

    searchResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.results) {
        const weight = [0.6, 0.3, 0.1][index] || 0.1; // Weights for different strategies
        
        result.value.results.forEach(item => {
          const note = item.note || item;
          const id = note.id;
          
          if (resultMap.has(id)) {
            // Update existing dengan higher score
            const existing = resultMap.get(id);
            const newScore = (item.relevance_score || item.score || 0) * weight;
            if (newScore > existing.relevance_score) {
              existing.relevance_score = newScore;
            }
          } else {
            // Add new result
            resultMap.set(id, {
              note,
              relevance_score: (item.relevance_score || item.score || 0) * weight
            });
          }
        });
      }
    });

    // Convert ke array, sort, dan limit
    return Array.from(resultMap.values())
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, maxResults);
  }

  /**
   * Detect patterns dalam search results untuk task
   */
  detectTaskPatterns(results, taskDescription) {
    const patterns = [];
    
    // Analyze note types
    const noteTypes = results.map(r => r.note.type);
    const typeFrequency = noteTypes.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    // Pattern 1: Common task types
    Object.entries(typeFrequency).forEach(([type, count]) => {
      if (count > 1) {
        patterns.push(`Common ${type} pattern detected (${count} similar tasks)`);
      }
    });

    // Pattern 2: Recurring keywords
    const allContent = results.map(r => 
      `${r.note.content.action || ''} ${r.note.content.result || ''}`
    ).join(' ').toLowerCase();
    
    const keywords = this.extractKeywords(taskDescription.toLowerCase());
    const recurringKeywords = keywords.filter(keyword => 
      (allContent.match(new RegExp(keyword, 'g')) || []).length > 1
    );

    if (recurringKeywords.length > 0) {
      patterns.push(`Recurring keywords: ${recurringKeywords.join(', ')}`);
    }

    // Pattern 3: Error patterns
    const errorNotes = results.filter(r => 
      r.note.content.errors && r.note.content.errors.length > 0
    );
    
    if (errorNotes.length > 0) {
      patterns.push(`Similar error patterns found in ${errorNotes.length} previous tasks`);
    }

    return patterns;
  }

  /**
   * Extract keywords dari text
   */
  extractKeywords(text) {
    // Remove common stop words dan extract meaningful terms
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
      'in', 'with', 'to', 'for', 'of', 'as', 'by', 'that', 'this'
    ]);

    return text.toLowerCase()
      .split(/\W+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 10); // Limit to top 10 keywords
  }

  /**
   * Extract patterns dari text untuk pattern search
   */
  extractPatterns(text) {
    // Extract common patterns like "create X", "fix Y", "implement Z"
    const patterns = [];
    
    // Action patterns
    const actionRegex = /(create|build|implement|fix|update|delete|add|remove)\s+(\w+)/gi;
    let match;
    while ((match = actionRegex.exec(text)) !== null) {
      patterns.push(`${match[1]}_${match[2]}`);
    }

    // Technology patterns
    const techRegex = /\b(react|node|express|database|api|service|component|function)\b/gi;
    const techMatches = text.match(techRegex);
    if (techMatches) {
      patterns.push(...techMatches.map(tech => `tech_${tech.toLowerCase()}`));
    }

    return patterns;
  }

  /**
   * Cache management
   */
  generateCacheKey(type, params) {
    const key = `search:${type}:${JSON.stringify(params)}`;
    return Buffer.from(key).toString('base64').substring(0, 32);
  }

  async getCachedResult(cacheKey) {
    return await this.storage.cacheGet(`search:${cacheKey}`);
  }

  async setCachedResult(cacheKey, result, ttlSeconds = 300) {
    return await this.storage.cacheSet(`search:${cacheKey}`, result, ttlSeconds);
  }

  /**
   * Map note dari search result
   */
  mapNoteFromSearch(doc) {
    return {
      id: doc.id,
      agent_id: doc.agent_id,
      session_id: doc.session_id,
      timestamp: doc.timestamp,
      type: doc.type,
      context: doc.context,
      content: doc.content,
      metadata: doc.metadata,
      created_at: doc.created_at
    };
  }

  /**
   * Update search metrics
   */
  updateMetrics(responseTime) {
    this.metrics.totalSearches++;
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.totalSearches - 1) + responseTime) / 
      this.metrics.totalSearches;
  }

  /**
   * Get search statistics
   */
  async getStatistics() {
    const searchManagerStats = this.searchManager.getStatistics();
    
    return {
      service: this.metrics,
      manager: searchManagerStats,
      storage: await this.storage.getStatistics()
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalSearches: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Clear search cache
   */
  async clearCache() {
    this.searchManager.clearCache();
    
    // Clear storage cache untuk search results
    const cache = await this.storage.cache();
    const keys = await cache.keys('search:*');
    if (keys.length > 0) {
      await cache.del(keys);
    }
  }
}

export default SearchService;