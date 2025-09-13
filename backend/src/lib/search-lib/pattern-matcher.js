/**
 * Pattern Matcher - Advanced Pattern-Based Search
 * 
 * Menyediakan pattern-based search menggunakan regex, fuzzy matching,
 * structural queries, dan advanced text processing
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

/**
 * Pattern Matcher Class
 */
export default class PatternMatcher {
  constructor(config = {}) {
    this.config = {
      enableFuzzyMatching: config.enableFuzzyMatching !== false,
      fuzzyThreshold: config.fuzzyThreshold || 0.8,
      maxEditDistance: config.maxEditDistance || 2,
      enableWildcards: config.enableWildcards !== false,
      caseSensitive: config.caseSensitive || false,
      enableRegexCache: config.enableRegexCache !== false,
      regexCacheSize: config.regexCacheSize || 100,
      ...config
    };

    this.regexCache = new Map();
    this.statistics = {
      totalSearches: 0,
      patternTypes: {},
      averageSearchTime: 0,
      cacheHits: 0,
      startTime: Date.now()
    };

    // Pattern definitions untuk structured queries
    this.predefinedPatterns = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      url: /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g,
      phone: /(\+\d{1,3}[- ]?)?\d{10}/g,
      date: /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
      time: /\b\d{1,2}:\d{2}(\s?(AM|PM|am|pm))?\b/g,
      hashtag: /#[\w\d_]+/g,
      mention: /@[\w\d_]+/g,
      number: /\b\d+(\.\d+)?\b/g,
      word: /\b\w+\b/g
    };
  }

  /**
   * Main pattern search method
   * @param {Object} query - Pattern query
   * @param {Object} options - Search options
   * @returns {Object} Search results
   */
  async search(query, options = {}) {
    const startTime = Date.now();
    
    try {
      const patternType = this.determinePatternType(query);
      const searchResults = await this.executePatternSearch(query, options, patternType);
      
      // Post-process results
      const processedResults = this.postProcessPatternResults(searchResults, query, options);
      
      // Update statistics
      const searchTime = Date.now() - startTime;
      this.updateStatistics(patternType, searchTime);

      return {
        results: processedResults,
        total: processedResults.length,
        searchType: 'pattern',
        patternType,
        metadata: {
          searchTime,
          patternMatched: query.pattern || query.regex,
          caseSensitive: this.config.caseSensitive,
          fuzzyEnabled: this.config.enableFuzzyMatching
        }
      };

    } catch (error) {
      throw new Error(`Pattern search failed: ${error.message}`);
    }
  }

  /**
   * Determine pattern type dari query
   */
  determinePatternType(query) {
    if (query.regex) return 'regex';
    if (query.pattern && typeof query.pattern === 'string') {
      if (this.predefinedPatterns[query.pattern]) return 'predefined';
      if (query.pattern.includes('*') || query.pattern.includes('?')) return 'wildcard';
      return 'literal';
    }
    if (query.fuzzy) return 'fuzzy';
    if (query.structural) return 'structural';
    return 'text';
  }

  /**
   * Execute pattern search berdasarkan type
   */
  async executePatternSearch(query, options, patternType) {
    switch (patternType) {
      case 'regex':
        return await this.regexSearch(query, options);
      case 'predefined':
        return await this.predefinedPatternSearch(query, options);
      case 'wildcard':
        return await this.wildcardSearch(query, options);
      case 'fuzzy':
        return await this.fuzzySearch(query, options);
      case 'structural':
        return await this.structuralSearch(query, options);
      case 'literal':
      case 'text':
      default:
        return await this.literalSearch(query, options);
    }
  }

  /**
   * Regex-based search
   */
  async regexSearch(query, options) {
    const { regex, flags = 'gi' } = query;
    const regexObj = this.getCompiledRegex(regex, flags);
    const results = [];

    // Mock implementation - dalam implementasi nyata, ini akan search database
    const mockDocuments = this.getMockDocuments(options);
    
    mockDocuments.forEach(doc => {
      const matches = this.findRegexMatches(doc, regexObj);
      if (matches.length > 0) {
        results.push({
          ...doc,
          matches,
          score: this.calculateRegexScore(matches, doc)
        });
      }
    });

    return results;
  }

  /**
   * Predefined pattern search
   */
  async predefinedPatternSearch(query, options) {
    const { pattern } = query;
    const regexPattern = this.predefinedPatterns[pattern];
    
    if (!regexPattern) {
      throw new Error(`Unknown predefined pattern: ${pattern}`);
    }

    return await this.regexSearch({ regex: regexPattern.source, flags: 'gi' }, options);
  }

  /**
   * Wildcard search
   */
  async wildcardSearch(query, options) {
    const { pattern } = query;
    const regexPattern = this.wildcardToRegex(pattern);
    
    return await this.regexSearch({ regex: regexPattern, flags: 'gi' }, options);
  }

  /**
   * Fuzzy search menggunakan edit distance
   */
  async fuzzySearch(query, options) {
    const { text, threshold = this.config.fuzzyThreshold } = query;
    const results = [];
    
    const mockDocuments = this.getMockDocuments(options);
    
    mockDocuments.forEach(doc => {
      const fuzzyMatches = this.findFuzzyMatches(doc, text, threshold);
      if (fuzzyMatches.length > 0) {
        results.push({
          ...doc,
          matches: fuzzyMatches,
          score: this.calculateFuzzyScore(fuzzyMatches, doc)
        });
      }
    });

    return results;
  }

  /**
   * Structural search untuk JSON-like patterns
   */
  async structuralSearch(query, options) {
    const { structure } = query;
    const results = [];
    
    const mockDocuments = this.getMockDocuments(options);
    
    mockDocuments.forEach(doc => {
      if (this.matchesStructure(doc, structure)) {
        results.push({
          ...doc,
          score: this.calculateStructuralScore(doc, structure)
        });
      }
    });

    return results;
  }

  /**
   * Literal text search
   */
  async literalSearch(query, options) {
    const { pattern, text } = query;
    const searchText = pattern || text;
    const results = [];
    
    const mockDocuments = this.getMockDocuments(options);
    const flags = this.config.caseSensitive ? 'g' : 'gi';
    
    mockDocuments.forEach(doc => {
      const matches = this.findLiteralMatches(doc, searchText, flags);
      if (matches.length > 0) {
        results.push({
          ...doc,
          matches,
          score: this.calculateLiteralScore(matches, doc, searchText)
        });
      }
    });

    return results;
  }

  /**
   * Get compiled regex dengan caching
   */
  getCompiledRegex(pattern, flags) {
    const cacheKey = `${pattern}::${flags}`;
    
    if (this.config.enableRegexCache && this.regexCache.has(cacheKey)) {
      this.statistics.cacheHits++;
      return this.regexCache.get(cacheKey);
    }

    try {
      const regex = new RegExp(pattern, flags);
      
      if (this.config.enableRegexCache) {
        // Limit cache size
        if (this.regexCache.size >= this.config.regexCacheSize) {
          const firstKey = this.regexCache.keys().next().value;
          this.regexCache.delete(firstKey);
        }
        this.regexCache.set(cacheKey, regex);
      }
      
      return regex;
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${pattern} - ${error.message}`);
    }
  }

  /**
   * Find regex matches dalam document
   */
  findRegexMatches(doc, regex) {
    const matches = [];
    const searchableText = this.getSearchableText(doc);
    
    let match;
    const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    
    while ((match = globalRegex.exec(searchableText)) !== null) {
      matches.push({
        text: match[0],
        index: match.index,
        groups: match.groups || [],
        field: this.determineMatchField(doc, match.index)
      });
      
      // Prevent infinite loops
      if (!regex.flags.includes('g')) break;
    }

    return matches;
  }

  /**
   * Find fuzzy matches menggunakan Levenshtein distance
   */
  findFuzzyMatches(doc, searchText, threshold) {
    const matches = [];
    const words = this.getSearchableText(doc).split(/\s+/);
    
    words.forEach((word, index) => {
      const similarity = this.calculateStringSimilarity(word, searchText);
      if (similarity >= threshold) {
        matches.push({
          text: word,
          similarity,
          editDistance: this.levenshteinDistance(word, searchText),
          wordIndex: index
        });
      }
    });

    return matches;
  }

  /**
   * Find literal matches
   */
  findLiteralMatches(doc, searchText, flags) {
    const matches = [];
    const searchableText = this.getSearchableText(doc);
    const regex = new RegExp(this.escapeRegex(searchText), flags);
    
    let match;
    while ((match = regex.exec(searchableText)) !== null) {
      matches.push({
        text: match[0],
        index: match.index,
        field: this.determineMatchField(doc, match.index)
      });
    }

    return matches;
  }

  /**
   * Check jika document matches structural pattern
   */
  matchesStructure(doc, structure) {
    try {
      return this.deepStructureMatch(doc, structure);
    } catch (error) {
      return false;
    }
  }

  /**
   * Deep structure matching
   */
  deepStructureMatch(obj, pattern) {
    if (typeof pattern !== 'object' || pattern === null) {
      return obj === pattern;
    }

    for (const key in pattern) {
      if (!(key in obj)) return false;
      
      if (!this.deepStructureMatch(obj[key], pattern[key])) {
        return false;
      }
    }

    return true;
  }

  /**
   * Convert wildcard pattern ke regex
   */
  wildcardToRegex(pattern) {
    return pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex chars
      .replace(/\*/g, '.*') // * matches any characters
      .replace(/\?/g, '.'); // ? matches single character
  }

  /**
   * Calculate string similarity menggunakan Jaro-Winkler
   */
  calculateStringSimilarity(str1, str2) {
    const jaroSimilarity = this.jaroSimilarity(str1, str2);
    const prefixLength = this.getCommonPrefixLength(str1, str2, 4);
    
    return jaroSimilarity + (0.1 * prefixLength * (1 - jaroSimilarity));
  }

  /**
   * Jaro similarity calculation
   */
  jaroSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    const matchWindow = Math.floor(Math.max(str1.length, str2.length) / 2) - 1;
    if (matchWindow < 0) return 0.0;

    const str1Matches = new Array(str1.length).fill(false);
    const str2Matches = new Array(str2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    // Find matches
    for (let i = 0; i < str1.length; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, str2.length);

      for (let j = start; j < end; j++) {
        if (str2Matches[j] || str1[i] !== str2[j]) continue;
        str1Matches[i] = str2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    // Find transpositions
    let k = 0;
    for (let i = 0; i < str1.length; i++) {
      if (!str1Matches[i]) continue;
      while (!str2Matches[k]) k++;
      if (str1[i] !== str2[k]) transpositions++;
      k++;
    }

    return (matches / str1.length + matches / str2.length + (matches - transpositions / 2) / matches) / 3;
  }

  /**
   * Get common prefix length
   */
  getCommonPrefixLength(str1, str2, maxLength) {
    const length = Math.min(str1.length, str2.length, maxLength);
    let prefixLength = 0;

    for (let i = 0; i < length; i++) {
      if (str1[i] === str2[i]) {
        prefixLength++;
      } else {
        break;
      }
    }

    return prefixLength;
  }

  /**
   * Levenshtein distance calculation
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Get searchable text dari document
   */
  getSearchableText(doc) {
    const textParts = [];
    
    if (doc.title) textParts.push(doc.title);
    if (doc.content) textParts.push(doc.content);
    if (doc.summary) textParts.push(doc.summary);
    if (doc.tags && Array.isArray(doc.tags)) {
      textParts.push(doc.tags.join(' '));
    }

    return textParts.join(' ');
  }

  /**
   * Determine which field contains the match
   */
  determineMatchField(doc, matchIndex) {
    let currentIndex = 0;
    
    if (doc.title) {
      if (matchIndex < currentIndex + doc.title.length) {
        return 'title';
      }
      currentIndex += doc.title.length + 1;
    }

    if (doc.content) {
      if (matchIndex < currentIndex + doc.content.length) {
        return 'content';
      }
      currentIndex += doc.content.length + 1;
    }

    return 'other';
  }

  /**
   * Calculate various scoring functions
   */
  calculateRegexScore(matches, doc) {
    const baseScore = matches.length / 10; // Normalize by match count
    const fieldBoost = matches.some(m => m.field === 'title') ? 0.2 : 0;
    return Math.min(baseScore + fieldBoost, 1.0);
  }

  calculateFuzzyScore(matches, doc) {
    const avgSimilarity = matches.reduce((sum, m) => sum + m.similarity, 0) / matches.length;
    return avgSimilarity;
  }

  calculateStructuralScore(doc, structure) {
    // Simple scoring berdasarkan structure complexity
    const structureKeys = Object.keys(structure).length;
    return Math.min(structureKeys / 10, 1.0);
  }

  calculateLiteralScore(matches, doc, searchText) {
    const matchCount = matches.length;
    const searchableText = this.getSearchableText(doc);
    const density = matchCount / (searchableText.length / searchText.length);
    
    return Math.min(density, 1.0);
  }

  /**
   * Post-process pattern results
   */
  postProcessPatternResults(results, query, options) {
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit || 10)
      .map(result => ({
        id: result.id,
        title: result.title,
        content: result.content,
        score: result.score,
        matches: result.matches,
        patternInfo: {
          matchCount: result.matches ? result.matches.length : 0,
          matchedFields: result.matches ? 
            [...new Set(result.matches.map(m => m.field))] : []
        }
      }));
  }

  /**
   * Get mock documents untuk testing
   */
  getMockDocuments(options) {
    // Mock implementation - dalam production akan dari database
    return [
      {
        id: 'doc1',
        title: 'Sample Document 1',
        content: 'This is a sample document for testing pattern matching.',
        tags: ['sample', 'test']
      },
      {
        id: 'doc2',
        title: 'Email Example',
        content: 'Contact us at support@example.com for help.',
        tags: ['email', 'contact']
      },
      {
        id: 'doc3',
        title: 'Phone Numbers',
        content: 'Call us at +1-555-123-4567 or visit our website.',
        tags: ['phone', 'contact']
      }
    ];
  }

  /**
   * Escape regex special characters
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Update statistics
   */
  updateStatistics(patternType, searchTime) {
    this.statistics.totalSearches++;
    this.statistics.patternTypes[patternType] = (this.statistics.patternTypes[patternType] || 0) + 1;
    
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
      searchesPerMinute: this.statistics.totalSearches / (uptime / 1000 / 60),
      cacheHitRate: this.statistics.cacheHits / Math.max(this.statistics.totalSearches, 1),
      regexCacheSize: this.regexCache.size,
      config: this.config
    };
  }

  /**
   * Clear regex cache
   */
  clearCache() {
    this.regexCache.clear();
    this.statistics.cacheHits = 0;
  }
}