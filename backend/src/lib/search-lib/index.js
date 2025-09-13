/**
 * Search Library - Semantic Search Interface
 * 
 * Menyediakan unified search interface untuk berbagai jenis pencarian
 * Mendukung full-text search, semantic search, dan pattern matching
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import SemanticSearch from './semantic.js';
import PatternMatcher from './pattern-matcher.js';

/**
 * Search Manager Class
 * Mengelola berbagai jenis search dan menyediakan interface terpadu
 */
export class SearchManager {
  constructor(config = {}) {
    this.config = {
      defaultResultLimit: config.defaultResultLimit || 10,
      maxResultLimit: config.maxResultLimit || 100,
      enableCache: config.enableCache !== false,
      cacheSize: config.cacheSize || 1000,
      cacheTTL: config.cacheTTL || 300000, // 5 minutes
      enableAnalytics: config.enableAnalytics !== false,
      ...config
    };

    // Initialize search components
    this.semanticSearch = new SemanticSearch(config.semantic || {});
    this.patternMatcher = new PatternMatcher(config.pattern || {});

    // Search cache
    this.searchCache = new Map();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      total: 0
    };

    // Analytics
    this.analytics = {
      totalSearches: 0,
      searchTypes: {},
      averageResponseTime: 0,
      popularQueries: new Map(),
      startTime: Date.now()
    };
  }

  /**
   * Universal search method
   * @param {Object} query - Search query object
   * @param {Object} options - Search options
   * @returns {Object} Search results
   */
  async search(query, options = {}) {
    const startTime = Date.now();
    
    try {
      // Validate dan normalize query
      const normalizedQuery = this.normalizeQuery(query);
      const searchOptions = this.normalizeOptions(options);

      // Check cache first
      const cacheKey = this.getCacheKey(normalizedQuery, searchOptions);
      if (this.config.enableCache) {
        const cached = this.getCached(cacheKey);
        if (cached) {
          this.updateAnalytics('cache', normalizedQuery, Date.now() - startTime);
          return this.formatCachedResult(cached);
        }
      }

      // Determine search type dan execute
      const searchType = this.determineSearchType(normalizedQuery);
      let results;

      switch (searchType) {
        case 'semantic':
          results = await this.executeSemanticSearch(normalizedQuery, searchOptions);
          break;
        case 'pattern':
          results = await this.executePatternSearch(normalizedQuery, searchOptions);
          break;
        case 'hybrid':
          results = await this.executeHybridSearch(normalizedQuery, searchOptions);
          break;
        case 'fulltext':
        default:
          results = await this.executeFullTextSearch(normalizedQuery, searchOptions);
          break;
      }

      // Post-process results
      const processedResults = await this.postProcessResults(results, normalizedQuery, searchOptions);

      // Cache results
      if (this.config.enableCache) {
        this.setCached(cacheKey, processedResults);
      }

      // Update analytics
      const responseTime = Date.now() - startTime;
      this.updateAnalytics(searchType, normalizedQuery, responseTime);

      return {
        ...processedResults,
        metadata: {
          searchType,
          query: normalizedQuery,
          responseTime,
          cached: false,
          totalResults: processedResults.total || processedResults.results.length
        }
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.updateAnalytics('error', query, responseTime);
      
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  /**
   * Semantic search untuk content similarity
   */
  async semanticSearch(text, options = {}) {
    const query = {
      type: 'semantic',
      text,
      ...options
    };
    
    return await this.search(query, options);
  }

  /**
   * Full-text search untuk keyword matching
   */
  async fullTextSearch(text, options = {}) {
    const query = {
      type: 'fulltext',
      text,
      ...options
    };
    
    return await this.search(query, options);
  }

  /**
   * Pattern-based search untuk structured queries
   */
  async patternSearch(pattern, options = {}) {
    const query = {
      type: 'pattern',
      pattern,
      ...options
    };
    
    return await this.search(query, options);
  }

  /**
   * Hybrid search menggabungkan multiple search types
   */
  async hybridSearch(queries, options = {}) {
    const query = {
      type: 'hybrid',
      queries,
      ...options
    };
    
    return await this.search(query, options);
  }

  /**
   * Advanced search dengan multiple filters
   */
  async advancedSearch(criteria, options = {}) {
    const query = {
      type: 'advanced',
      criteria,
      ...options
    };
    
    return await this.search(query, options);
  }

  /**
   * Normalize search query
   */
  normalizeQuery(query) {
    if (typeof query === 'string') {
      return {
        type: 'fulltext',
        text: query
      };
    }

    const normalized = { ...query };

    // Normalize text field
    if (normalized.text) {
      normalized.text = normalized.text.trim();
    }

    // Set default type
    if (!normalized.type) {
      normalized.type = 'fulltext';
    }

    return normalized;
  }

  /**
   * Normalize search options
   */
  normalizeOptions(options) {
    return {
      limit: Math.min(options.limit || this.config.defaultResultLimit, this.config.maxResultLimit),
      offset: options.offset || 0,
      userId: options.userId,
      filters: options.filters || {},
      sort: options.sort || 'relevance',
      includeHighlight: options.includeHighlight !== false,
      includeMetadata: options.includeMetadata !== false,
      ...options
    };
  }

  /**
   * Determine search type berdasarkan query
   */
  determineSearchType(query) {
    if (query.type) {
      return query.type;
    }

    // Auto-detect berdasarkan query characteristics
    if (query.embedding || (query.text && query.text.length > 50)) {
      return 'semantic';
    }

    if (query.pattern || query.regex) {
      return 'pattern';
    }

    if (query.queries && Array.isArray(query.queries)) {
      return 'hybrid';
    }

    return 'fulltext';
  }

  /**
   * Execute semantic search
   */
  async executeSemanticSearch(query, options) {
    try {
      return await this.semanticSearch.search(query, options);
    } catch (error) {
      console.warn('⚠️ Semantic search failed, falling back to full-text:', error.message);
      return await this.executeFullTextSearch(query, options);
    }
  }

  /**
   * Execute pattern search
   */
  async executePatternSearch(query, options) {
    return await this.patternMatcher.search(query, options);
  }

  /**
   * Execute full-text search
   */
  async executeFullTextSearch(query, options) {
    // This would typically interface dengan Elasticsearch atau search engine lainnya
    // Untuk sekarang, kita implement basic text matching
    
    const results = await this.basicTextSearch(query, options);
    
    return {
      results,
      total: results.length,
      searchType: 'fulltext',
      query: query.text
    };
  }

  /**
   * Execute hybrid search menggabungkan multiple approaches
   */
  async executeHybridSearch(query, options) {
    const { queries, weights = {} } = query;
    const allResults = [];

    // Execute all search types
    const searchPromises = queries.map(async (subQuery, index) => {
      try {
        const subResults = await this.search(subQuery, {
          ...options,
          limit: options.limit * 2 // Get more results untuk reranking
        });
        
        return {
          type: subQuery.type || 'fulltext',
          results: subResults.results || [],
          weight: weights[index] || 1.0
        };
      } catch (error) {
        console.warn(`⚠️ Hybrid search sub-query failed:`, error.message);
        return { type: 'error', results: [], weight: 0 };
      }
    });

    const searchResults = await Promise.all(searchPromises);

    // Merge dan rerank results
    const mergedResults = this.mergeAndRerankResults(searchResults, options);

    return {
      results: mergedResults.slice(0, options.limit),
      total: mergedResults.length,
      searchType: 'hybrid',
      breakdown: searchResults.map(r => ({
        type: r.type,
        count: r.results.length,
        weight: r.weight
      }))
    };
  }

  /**
   * Basic text search implementation
   */
  async basicTextSearch(query, options) {
    // Placeholder implementation
    // Dalam implementasi nyata, ini akan terhubung ke Elasticsearch
    
    const searchTerms = query.text.toLowerCase().split(/\s+/);
    const mockResults = [];

    // Generate mock results for demonstration
    for (let i = 0; i < Math.min(options.limit, 5); i++) {
      mockResults.push({
        id: `result-${i}`,
        title: `Search Result ${i + 1} for "${query.text}"`,
        content: `This is a mock search result that matches your query: ${query.text}`,
        score: 1.0 - (i * 0.1),
        source: 'mock',
        highlight: {
          title: [`Search Result ${i + 1} for "<em>${query.text}</em>"`],
          content: [`This is a mock search result that matches your query: <em>${query.text}</em>`]
        }
      });
    }

    return mockResults;
  }

  /**
   * Merge dan rerank results dari multiple searches
   */
  mergeAndRerankResults(searchResults, options) {
    const resultMap = new Map();

    // Merge results dengan weighted scoring
    searchResults.forEach(({ results, weight, type }) => {
      results.forEach(result => {
        const id = result.id;
        
        if (resultMap.has(id)) {
          // Update existing result dengan combined score
          const existing = resultMap.get(id);
          existing.score = Math.max(existing.score, result.score * weight);
          existing.sources.push(type);
        } else {
          // Add new result
          resultMap.set(id, {
            ...result,
            score: result.score * weight,
            sources: [type]
          });
        }
      });
    });

    // Convert ke array dan sort berdasarkan score
    const mergedResults = Array.from(resultMap.values())
      .sort((a, b) => b.score - a.score);

    return mergedResults;
  }

  /**
   * Post-process search results
   */
  async postProcessResults(results, query, options) {
    const processed = { ...results };

    // Apply additional filters
    if (options.filters && Object.keys(options.filters).length > 0) {
      processed.results = this.applyFilters(processed.results, options.filters);
    }

    // Apply sorting
    if (options.sort && options.sort !== 'relevance') {
      processed.results = this.applySorting(processed.results, options.sort);
    }

    // Add metadata jika diminta
    if (options.includeMetadata) {
      processed.results = processed.results.map(result => ({
        ...result,
        metadata: this.generateResultMetadata(result, query)
      }));
    }

    // Pagination
    if (options.offset > 0) {
      processed.results = processed.results.slice(options.offset);
    }

    return processed;
  }

  /**
   * Apply filters ke results
   */
  applyFilters(results, filters) {
    return results.filter(result => {
      return Object.entries(filters).every(([key, value]) => {
        if (Array.isArray(value)) {
          return value.includes(result[key]);
        }
        if (typeof value === 'object' && value.min !== undefined || value.max !== undefined) {
          const resultValue = result[key];
          return (value.min === undefined || resultValue >= value.min) &&
                 (value.max === undefined || resultValue <= value.max);
        }
        return result[key] === value;
      });
    });
  }

  /**
   * Apply sorting ke results
   */
  applySorting(results, sort) {
    const [field, direction = 'desc'] = sort.split(':');
    
    return results.sort((a, b) => {
      let aVal = a[field];
      let bVal = b[field];

      if (field === 'date' || field === 'createdAt' || field === 'updatedAt') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }

      if (direction === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
  }

  /**
   * Generate metadata untuk result
   */
  generateResultMetadata(result, query) {
    return {
      relevanceScore: result.score,
      searchTerms: query.text?.split(/\s+/) || [],
      resultType: result.type || 'unknown',
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Cache management
   */
  getCacheKey(query, options) {
    const key = JSON.stringify({
      query,
      options: {
        limit: options.limit,
        offset: options.offset,
        filters: options.filters,
        sort: options.sort
      }
    });
    
    return this.hashString(key);
  }

  getCached(key) {
    const cached = this.searchCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
      this.cacheStats.hits++;
      return cached.data;
    }
    
    if (cached) {
      this.searchCache.delete(key);
    }
    
    this.cacheStats.misses++;
    return null;
  }

  setCached(key, data) {
    // Limit cache size
    if (this.searchCache.size >= this.config.cacheSize) {
      const firstKey = this.searchCache.keys().next().value;
      this.searchCache.delete(firstKey);
    }

    this.searchCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  formatCachedResult(cachedData) {
    return {
      ...cachedData,
      metadata: {
        ...cachedData.metadata,
        cached: true,
        cacheAge: Date.now() - cachedData.metadata.timestamp
      }
    };
  }

  /**
   * Analytics dan statistics
   */
  updateAnalytics(searchType, query, responseTime) {
    this.analytics.totalSearches++;
    this.analytics.searchTypes[searchType] = (this.analytics.searchTypes[searchType] || 0) + 1;
    
    // Update average response time
    this.analytics.averageResponseTime = 
      (this.analytics.averageResponseTime * (this.analytics.totalSearches - 1) + responseTime) / 
      this.analytics.totalSearches;

    // Track popular queries
    if (query.text) {
      const queryText = query.text.toLowerCase();
      this.analytics.popularQueries.set(
        queryText, 
        (this.analytics.popularQueries.get(queryText) || 0) + 1
      );
    }
  }

  /**
   * Get comprehensive statistics
   */
  getStatistics() {
    const uptime = Date.now() - this.analytics.startTime;
    
    return {
      analytics: {
        ...this.analytics,
        uptime,
        searchesPerMinute: this.analytics.totalSearches / (uptime / 1000 / 60),
        topQueries: Array.from(this.analytics.popularQueries.entries())
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
      },
      cache: {
        ...this.cacheStats,
        hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses),
        size: this.searchCache.size,
        maxSize: this.config.cacheSize
      },
      components: {
        semantic: this.semanticSearch.getStatistics(),
        pattern: this.patternMatcher.getStatistics()
      },
      config: this.config
    };
  }

  /**
   * Utility methods
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString();
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.searchCache.clear();
    this.cacheStats = { hits: 0, misses: 0, total: 0 };
  }

  /**
   * Reset analytics
   */
  resetAnalytics() {
    this.analytics = {
      totalSearches: 0,
      searchTypes: {},
      averageResponseTime: 0,
      popularQueries: new Map(),
      startTime: Date.now()
    };
  }
}

/**
 * Default search manager instance
 */
const searchManager = new SearchManager();

export default searchManager;

/**
 * Named exports
 */
export { SemanticSearch, PatternMatcher };