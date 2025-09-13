/**
 * Storage Service
 * 
 * Service untuk mengelola operasi database terpadu
 * Menggunakan storage-lib untuk koneksi ke Redis, ScyllaDB, dan Elasticsearch
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { StorageManager } from '../lib/storage-lib/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * StorageService Class
 * Mengelola operasi CRUD untuk semua entitas dalam sistem
 */
export class StorageService {
  constructor(config = {}) {
    this.storageManager = new StorageManager(config);
    this.isInitialized = false;
  }

  /**
   * Initialize storage connections
   */
  async initialize() {
    if (!this.isInitialized) {
      await this.storageManager.initialize();
      this.isInitialized = true;
    }
    return this.storageManager.healthStatus;
  }

  /**
   * Get health status dari semua database
   */
  async getHealthStatus() {
    return await this.storageManager.updateHealthStatus();
  }

  /**
   * Get storage statistics
   */
  async getStatistics() {
    return await this.storageManager.getStatistics();
  }

  /**
   * Close semua koneksi database
   */
  async close() {
    await this.storageManager.close();
    this.isInitialized = false;
  }

  // Cache operations (Redis)

  /**
   * Get cache client
   */
  async cache() {
    return await this.storageManager.cache();
  }

  /**
   * Set cache dengan TTL
   */
  async cacheSet(key, value, ttlSeconds = 3600) {
    const cache = await this.cache();
    return await cache.setex(key, ttlSeconds, JSON.stringify(value));
  }

  /**
   * Get dari cache
   */
  async cacheGet(key) {
    const cache = await this.cache();
    const result = await cache.get(key);
    return result ? JSON.parse(result) : null;
  }

  /**
   * Delete dari cache
   */
  async cacheDelete(key) {
    const cache = await this.cache();
    return await cache.del(key);
  }

  /**
   * Check apakah key ada di cache
   */
  async cacheExists(key) {
    const cache = await this.cache();
    return await cache.exists(key);
  }

  // Persistent storage operations (ScyllaDB)

  /**
   * Get persistence client
   */
  async persistence() {
    return await this.storageManager.persistence();
  }

  /**
   * Execute query dengan parameters
   */
  async executeQuery(query, params = []) {
    const persistence = await this.persistence();
    return await persistence.execute(query, params);
  }

  /**
   * Execute batch queries
   */
  async executeBatch(queries) {
    const persistence = await this.persistence();
    return await persistence.batch(queries);
  }

  // Search operations (Elasticsearch)

  /**
   * Get search client
   */
  async search() {
    return await this.storageManager.search();
  }

  /**
   * Index document untuk search
   */
  async indexDocument(index, id, document) {
    const search = await this.search();
    return await search.index({
      index,
      id,
      body: document
    });
  }

  /**
   * Search documents
   */
  async searchDocuments(index, query, options = {}) {
    const search = await this.search();
    return await search.search({
      index,
      body: {
        query,
        ...options
      }
    });
  }

  /**
   * Update document
   */
  async updateDocument(index, id, updates) {
    const search = await this.search();
    return await search.update({
      index,
      id,
      body: {
        doc: updates
      }
    });
  }

  /**
   * Delete document
   */
  async deleteDocument(index, id) {
    const search = await this.search();
    return await search.delete({
      index,
      id
    });
  }

  // Notes operations

  /**
   * Simpan note baru
   */
  async saveNote(noteData) {
    try {
      const noteId = uuidv4();
      const timestamp = new Date().toISOString();

      const note = {
        id: noteId,
        agent_id: noteData.agent_id,
        session_id: noteData.session_id || null,
        timestamp,
        type: noteData.type,
        context: noteData.context,
        content: noteData.content,
        metadata: noteData.metadata || {},
        created_at: timestamp
      };

      // Simpan ke ScyllaDB
      const query = `
        INSERT INTO notes (id, agent_id, session_id, timestamp, type, context, content, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        note.id,
        note.agent_id,
        note.session_id,
        note.timestamp,
        note.type,
        JSON.stringify(note.context),
        JSON.stringify(note.content),
        JSON.stringify(note.metadata),
        note.created_at
      ];

      await this.executeQuery(query, params);

      // Index untuk search
      await this.indexDocument('notes', noteId, {
        ...note,
        searchable_content: `${note.content.action || ''} ${note.content.result || ''} ${note.content.learning || ''}`
      });

      // Invalidate cache untuk agent
      await this.cacheDelete(`notes:agent:${note.agent_id}`);

      return note;
    } catch (error) {
      throw new Error(`Failed to save note: ${error.message}`);
    }
  }

  /**
   * Get notes berdasarkan agent dengan pagination
   */
  async getNotesByAgent(agentId, options = {}) {
    try {
      const {
        limit = 100,
        offset = 0,
        fromDate = null,
        toDate = null
      } = options;

      // Cek cache terlebih dahulu
      const cacheKey = `notes:agent:${agentId}:${limit}:${offset}:${fromDate}:${toDate}`;
      const cachedResult = await this.cacheGet(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }

      let query = 'SELECT * FROM notes WHERE agent_id = ?';
      const params = [agentId];

      // Add date filters
      if (fromDate) {
        query += ' AND timestamp >= ?';
        params.push(fromDate);
      }
      if (toDate) {
        query += ' AND timestamp <= ?';
        params.push(toDate);
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      if (offset > 0) {
        query += ' OFFSET ?';
        params.push(offset);
      }

      const result = await this.executeQuery(query, params);
      const notes = result.rows.map(this.mapNoteFromDb);

      // Get total count
      const countQuery = 'SELECT COUNT(*) as total FROM notes WHERE agent_id = ?';
      const countParams = [agentId];
      const countResult = await this.executeQuery(countQuery, countParams);
      const total = countResult.rows[0].total;

      const response = {
        notes,
        total,
        has_more: (offset + limit) < total
      };

      // Cache result selama 5 menit
      await this.cacheSet(cacheKey, response, 300);

      return response;
    } catch (error) {
      throw new Error(`Failed to get notes: ${error.message}`);
    }
  }

  /**
   * Search notes dengan semantic search
   */
  async searchNotes(searchQuery, agentId, options = {}) {
    try {
      const {
        limit = 10,
        minRelevance = 0.5
      } = options;

      const searchRequest = {
        bool: {
          must: [
            {
              match: {
                agent_id: agentId
              }
            },
            {
              multi_match: {
                query: searchQuery,
                fields: ['searchable_content^2', 'content.action', 'content.result', 'content.learning'],
                minimum_should_match: '70%'
              }
            }
          ]
        }
      };

      const result = await this.searchDocuments('notes', searchRequest, {
        size: limit,
        min_score: minRelevance
      });

      const notes = result.body.hits.hits.map(hit => ({
        note: this.mapNoteFromSearch(hit._source),
        relevance_score: hit._score
      }));

      return {
        results: notes,
        query_time_ms: result.body.took
      };
    } catch (error) {
      throw new Error(`Failed to search notes: ${error.message}`);
    }
  }

  /**
   * Get relevant notes untuk task tertentu
   */
  async getRelevantNotes(taskDescription, agentId, maxResults = 20) {
    try {
      // Cek cache berdasarkan task description hash
      const taskHash = Buffer.from(taskDescription).toString('base64').substring(0, 20);
      const cacheKey = `relevant:${agentId}:${taskHash}`;
      const cachedResult = await this.cacheGet(cacheKey);
      
      if (cachedResult) {
        return {
          ...cachedResult,
          cache_hit: true
        };
      }

      // Search menggunakan task description
      const searchResult = await this.searchNotes(taskDescription, agentId, {
        limit: maxResults,
        minRelevance: 0.6
      });

      // Detect patterns (simplified pattern detection)
      const patterns = this.detectPatterns(searchResult.results);

      const response = {
        notes: searchResult.results.map(r => r.note),
        patterns_detected: patterns,
        cache_hit: false
      };

      // Cache selama 10 menit
      await this.cacheSet(cacheKey, response, 600);

      return response;
    } catch (error) {
      throw new Error(`Failed to get relevant notes: ${error.message}`);
    }
  }

  // Session operations

  /**
   * Buat session baru
   */
  async createSession(sessionData) {
    try {
      const sessionId = uuidv4();
      const timestamp = new Date().toISOString();

      const session = {
        id: sessionId,
        agent_id: sessionData.agent_id,
        user_id: sessionData.user_id,
        started_at: timestamp,
        status: 'active',
        statistics: {}
      };

      const query = `
        INSERT INTO sessions (id, agent_id, user_id, started_at, status, statistics)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      const params = [
        session.id,
        session.agent_id,
        session.user_id,
        session.started_at,
        session.status,
        JSON.stringify(session.statistics)
      ];

      await this.executeQuery(query, params);

      return session;
    } catch (error) {
      throw new Error(`Failed to create session: ${error.message}`);
    }
  }

  /**
   * Update session
   */
  async updateSession(sessionId, updates) {
    try {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const query = `UPDATE sessions SET ${setClause} WHERE id = ?`;
      const values = [...Object.values(updates), sessionId];

      await this.executeQuery(query, values);

      // Get updated session
      const getQuery = 'SELECT * FROM sessions WHERE id = ? LIMIT 1';
      const result = await this.executeQuery(getQuery, [sessionId]);
      
      return result.rows.length > 0 ? this.mapSessionFromDb(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to update session: ${error.message}`);
    }
  }

  // Knowledge operations

  /**
   * Get aggregated knowledge berdasarkan domain
   */
  async getKnowledge(domain, minConfidence = 0.7) {
    try {
      const cacheKey = `knowledge:${domain}:${minConfidence}`;
      const cachedResult = await this.cacheGet(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }

      const query = `
        SELECT * FROM knowledge 
        WHERE domain = ? AND confidence_score >= ?
        ORDER BY confidence_score DESC
      `;
      const result = await this.executeQuery(query, [domain, minConfidence]);
      const knowledgeItems = result.rows.map(this.mapKnowledgeFromDb);

      const response = { knowledge_items: knowledgeItems };

      // Cache selama 30 menit
      await this.cacheSet(cacheKey, response, 1800);

      return response;
    } catch (error) {
      throw new Error(`Failed to get knowledge: ${error.message}`);
    }
  }

  // Experience operations

  /**
   * Get learning experiences
   */
  async getExperiences(filters = {}) {
    try {
      const { projectId = null, applicableDomain = null } = filters;
      
      let query = 'SELECT * FROM experiences WHERE 1=1';
      const params = [];

      if (projectId) {
        query += ' AND project_id = ?';
        params.push(projectId);
      }

      if (applicableDomain) {
        query += ' AND applicable_domain = ?';
        params.push(applicableDomain);
      }

      query += ' ORDER BY created_at DESC';

      const result = await this.executeQuery(query, params);
      const experiences = result.rows.map(this.mapExperienceFromDb);

      return { experiences };
    } catch (error) {
      throw new Error(`Failed to get experiences: ${error.message}`);
    }
  }

  // Helper methods

  /**
   * Map note dari database row
   */
  mapNoteFromDb(row) {
    return {
      id: row.id,
      agent_id: row.agent_id,
      session_id: row.session_id,
      timestamp: row.timestamp,
      type: row.type,
      context: typeof row.context === 'string' ? JSON.parse(row.context) : row.context,
      content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at
    };
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
   * Map session dari database row
   */
  mapSessionFromDb(row) {
    return {
      id: row.id,
      agent_id: row.agent_id,
      user_id: row.user_id,
      started_at: row.started_at,
      status: row.status,
      statistics: typeof row.statistics === 'string' ? JSON.parse(row.statistics) : row.statistics
    };
  }

  /**
   * Map knowledge dari database row
   */
  mapKnowledgeFromDb(row) {
    return {
      id: row.id,
      domain: row.domain,
      title: row.title,
      summary: row.summary,
      confidence_score: row.confidence_score,
      version: row.version
    };
  }

  /**
   * Map experience dari database row
   */
  mapExperienceFromDb(row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      outcomes: typeof row.outcomes === 'string' ? JSON.parse(row.outcomes) : row.outcomes,
      lessons_learned: typeof row.lessons_learned === 'string' ? JSON.parse(row.lessons_learned) : row.lessons_learned
    };
  }

  /**
   * Detect patterns dari search results (simplified)
   */
  detectPatterns(results) {
    const patterns = [];
    const types = results.map(r => r.note.type);
    const uniqueTypes = [...new Set(types)];
    
    uniqueTypes.forEach(type => {
      const count = types.filter(t => t === type).length;
      if (count > 1) {
        patterns.push(`Common ${type} pattern detected (${count} occurrences)`);
      }
    });

    return patterns;
  }

  /**
   * Transaction wrapper
   */
  async transaction(operations) {
    return await this.storageManager.transaction(operations);
  }

  /**
   * Batch operations
   */
  async batch(operations) {
    return await this.storageManager.batch(operations);
  }

  /**
   * Backup data
   */
  async backup(options = {}) {
    return await this.storageManager.backup(options);
  }
}

export default StorageService;