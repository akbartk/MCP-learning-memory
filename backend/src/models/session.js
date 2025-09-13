import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';

/**
 * Session Model
 * AI Agent work session tracking
 */
export class Session {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.agent_id = data.agent_id;
    this.user_id = data.user_id;
    this.started_at = data.started_at || new Date();
    this.ended_at = data.ended_at || null;
    this.status = data.status || 'active'; // active, completed, timeout
    this.statistics = data.statistics || {
      notes_created: 0,
      notes_accessed: 0,
      queries_made: 0,
      cache_hits: 0,
      response_time_avg_ms: 0
    };
    this.accessed_notes = data.accessed_notes || [];
    this.created_notes = data.created_notes || [];
    this.metadata = data.metadata || {};
  }

  /**
   * Validation schema untuk Session entity
   */
  static getValidationSchema() {
    return Joi.object({
      id: Joi.string().uuid().optional(),
      agent_id: Joi.string().required().min(1).max(100)
        .messages({
          'any.required': 'agent_id wajib diisi'
        }),
      user_id: Joi.string().uuid().required()
        .messages({
          'any.required': 'user_id wajib diisi'
        }),
      started_at: Joi.date().optional(),
      ended_at: Joi.date().when('status', {
        is: Joi.string().valid('completed', 'timeout'),
        then: Joi.required(),
        otherwise: Joi.allow(null)
      }).messages({
        'any.required': 'ended_at wajib diisi untuk session yang sudah selesai'
      }),
      status: Joi.string().valid('active', 'completed', 'timeout').default('active'),
      statistics: Joi.object({
        notes_created: Joi.number().integer().min(0).default(0),
        notes_accessed: Joi.number().integer().min(0).default(0),
        queries_made: Joi.number().integer().min(0).default(0),
        cache_hits: Joi.number().integer().min(0).default(0),
        response_time_avg_ms: Joi.number().min(0).default(0)
      }).default({}),
      accessed_notes: Joi.array().items(
        Joi.object({
          note_id: Joi.string().uuid().required(),
          accessed_at: Joi.date().required(),
          relevance_score: Joi.number().min(0).max(1).required()
        })
      ).default([]),
      created_notes: Joi.array().items(Joi.string().uuid()).default([]),
      metadata: Joi.object().default({})
    });
  }

  /**
   * Validasi data Session
   */
  static validate(data) {
    const schema = this.getValidationSchema();
    return schema.validate(data, { 
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });
  }

  /**
   * Membuat Session baru dengan validasi
   */
  static async create(sessionData, { redis, scylla, elasticsearch }) {
    // Validasi data
    const { error, value } = this.validate(sessionData);
    if (error) {
      throw new Error(`Validasi gagal: ${error.details.map(d => d.message).join(', ')}`);
    }

    const session = new Session(value);
    
    try {
      // Verifikasi bahwa user_id valid dan agent_id belongs to user
      await this._verifyUserAndAgent(session.user_id, session.agent_id, { scylla });

      // Cek apakah ada session aktif untuk agent ini
      const activeSession = await this.findActiveByAgent(session.agent_id, { redis, scylla });
      if (activeSession) {
        throw new Error(`Agent ${session.agent_id} sudah memiliki session aktif: ${activeSession.id}`);
      }

      // 1. Simpan ke ScyllaDB
      const insertQuery = `
        INSERT INTO sessions (
          id, agent_id, user_id, started_at, ended_at, status,
          statistics, accessed_notes, created_notes, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await scylla.execute(insertQuery, [
        session.id,
        session.agent_id,
        session.user_id,
        session.started_at,
        session.ended_at,
        session.status,
        JSON.stringify(session.statistics),
        JSON.stringify(session.accessed_notes),
        session.created_notes,
        JSON.stringify(session.metadata)
      ]);

      // 2. Cache ke Redis
      const cacheKey = `session:${session.id}`;
      await redis.setex(cacheKey, 86400, JSON.stringify(session)); // 24 jam

      // Cache active session mapping
      const activeCacheKey = `session:active:${session.agent_id}`;
      await redis.setex(activeCacheKey, 86400, session.id);

      // 3. Index ke Elasticsearch
      await elasticsearch.index({
        index: 'sessions',
        id: session.id,
        body: {
          ...session,
          duration_minutes: null, // Will be calculated when session ends
          searchable_agent: session.agent_id,
          user_organization: null // Will be populated with user data
        }
      });

      return session;
    } catch (err) {
      throw new Error(`Gagal menyimpan session: ${err.message}`);
    }
  }

  /**
   * Verifikasi bahwa user_id valid dan agent_id belongs to user
   */
  static async _verifyUserAndAgent(userId, agentId, { scylla }) {
    // Cek user exists
    const userQuery = 'SELECT id, subscription FROM users WHERE id = ?';
    const userResult = await scylla.execute(userQuery, [userId]);
    
    if (userResult.rows.length === 0) {
      throw new Error('User tidak ditemukan');
    }

    const subscription = JSON.parse(userResult.rows[0].subscription);
    if (subscription.status !== 'active') {
      throw new Error('User subscription tidak aktif');
    }

    // Untuk sementara, kita asumsikan agent_id format: userId_agentName
    // Implementasi sebenarnya mungkin perlu tabel agents terpisah
    if (!agentId.startsWith(userId)) {
      throw new Error('Agent ID tidak belong ke user ini');
    }
  }

  /**
   * Mencari Session berdasarkan ID
   */
  static async findById(id, { redis, scylla }) {
    try {
      // Cek cache terlebih dahulu
      const cacheKey = `session:${id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return new Session(JSON.parse(cached));
      }

      // Query dari ScyllaDB
      const selectQuery = 'SELECT * FROM sessions WHERE id = ?';
      const result = await scylla.execute(selectQuery, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const session = new Session({
        id: row.id,
        agent_id: row.agent_id,
        user_id: row.user_id,
        started_at: row.started_at,
        ended_at: row.ended_at,
        status: row.status,
        statistics: JSON.parse(row.statistics),
        accessed_notes: JSON.parse(row.accessed_notes),
        created_notes: row.created_notes,
        metadata: JSON.parse(row.metadata)
      });

      // Cache untuk akses berikutnya
      await redis.setex(cacheKey, 86400, JSON.stringify(session));

      return session;
    } catch (err) {
      throw new Error(`Gagal mengambil session: ${err.message}`);
    }
  }

  /**
   * Mencari session aktif berdasarkan agent_id
   */
  static async findActiveByAgent(agentId, { redis, scylla }) {
    try {
      // Cek cache untuk active session
      const activeCacheKey = `session:active:${agentId}`;
      const cachedSessionId = await redis.get(activeCacheKey);
      if (cachedSessionId) {
        const session = await this.findById(cachedSessionId, { redis, scylla });
        if (session && session.status === 'active') {
          return session;
        }
        // Jika session tidak aktif lagi, hapus dari cache
        await redis.del(activeCacheKey);
      }

      // Query dari database
      const selectQuery = `
        SELECT * FROM sessions 
        WHERE agent_id = ? AND status = 'active'
        LIMIT 1
      `;
      
      const result = await scylla.execute(selectQuery, [agentId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const session = new Session({
        id: row.id,
        agent_id: row.agent_id,
        user_id: row.user_id,
        started_at: row.started_at,
        ended_at: row.ended_at,
        status: row.status,
        statistics: JSON.parse(row.statistics),
        accessed_notes: JSON.parse(row.accessed_notes),
        created_notes: row.created_notes,
        metadata: JSON.parse(row.metadata)
      });

      // Cache active session
      await redis.setex(activeCacheKey, 86400, session.id);

      return session;
    } catch (err) {
      throw new Error(`Gagal mengambil active session: ${err.message}`);
    }
  }

  /**
   * Mencari sessions berdasarkan user_id
   */
  static async findByUser(userId, limit = 10, { redis, scylla }) {
    try {
      const cacheKey = `sessions:user:${userId}`;
      
      // Cek cache (simplified - dalam production mungkin perlu pagination)
      const cached = await redis.get(cacheKey);
      if (cached) {
        const sessionIds = JSON.parse(cached);
        const sessionPromises = sessionIds.slice(0, limit).map(id => this.findById(id, { redis, scylla }));
        const sessions = await Promise.all(sessionPromises);
        return sessions.filter(s => s !== null);
      }

      // Query dari database
      const selectQuery = `
        SELECT * FROM sessions 
        WHERE user_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `;
      
      const result = await scylla.execute(selectQuery, [userId, limit]);
      
      const sessions = result.rows.map(row => new Session({
        id: row.id,
        agent_id: row.agent_id,
        user_id: row.user_id,
        started_at: row.started_at,
        ended_at: row.ended_at,
        status: row.status,
        statistics: JSON.parse(row.statistics),
        accessed_notes: JSON.parse(row.accessed_notes),
        created_notes: row.created_notes,
        metadata: JSON.parse(row.metadata)
      }));

      // Cache session IDs
      if (sessions.length > 0) {
        const sessionIds = sessions.map(s => s.id);
        await redis.setex(cacheKey, 1800, JSON.stringify(sessionIds)); // 30 menit
      }

      return sessions;
    } catch (err) {
      throw new Error(`Gagal mengambil sessions berdasarkan user: ${err.message}`);
    }
  }

  /**
   * Update statistics session
   */
  async updateStatistics(statsUpdate, { redis, scylla, elasticsearch }) {
    try {
      const validStats = ['notes_created', 'notes_accessed', 'queries_made', 'cache_hits'];
      
      // Update statistics
      Object.keys(statsUpdate).forEach(key => {
        if (validStats.includes(key)) {
          this.statistics[key] = (this.statistics[key] || 0) + (statsUpdate[key] || 0);
        }
      });

      // Update response time average jika disediakan
      if (statsUpdate.response_time_ms) {
        const currentAvg = this.statistics.response_time_avg_ms || 0;
        const totalQueries = this.statistics.queries_made || 1;
        
        // Weighted average
        this.statistics.response_time_avg_ms = 
          ((currentAvg * (totalQueries - 1)) + statsUpdate.response_time_ms) / totalQueries;
      }

      // Update di database
      const updateQuery = `
        UPDATE sessions SET statistics = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        JSON.stringify(this.statistics),
        this.id
      ]);

      // Update cache
      const cacheKey = `session:${this.id}`;
      await redis.setex(cacheKey, 86400, JSON.stringify(this));

      // Update index (async untuk performa)
      elasticsearch.update({
        index: 'sessions',
        id: this.id,
        body: {
          doc: {
            statistics: this.statistics
          }
        }
      }).catch(err => console.error('Error updating session index:', err));

      return this;
    } catch (err) {
      throw new Error(`Gagal update statistics: ${err.message}`);
    }
  }

  /**
   * Record note access
   */
  async recordNoteAccess(noteId, relevanceScore, { redis, scylla }) {
    try {
      // Cek apakah note sudah pernah diakses dalam session ini
      const existingAccess = this.accessed_notes.find(access => access.note_id === noteId);
      
      if (existingAccess) {
        // Update relevance score jika lebih tinggi
        if (relevanceScore > existingAccess.relevance_score) {
          existingAccess.relevance_score = relevanceScore;
          existingAccess.accessed_at = new Date();
        }
      } else {
        // Tambah akses baru
        this.accessed_notes.push({
          note_id: noteId,
          accessed_at: new Date(),
          relevance_score: relevanceScore
        });

        // Increment statistics
        this.statistics.notes_accessed = (this.statistics.notes_accessed || 0) + 1;
      }

      // Limit accessed_notes untuk performa (keep top 100 by relevance)
      if (this.accessed_notes.length > 100) {
        this.accessed_notes = this.accessed_notes
          .sort((a, b) => b.relevance_score - a.relevance_score)
          .slice(0, 100);
      }

      // Update di database
      const updateQuery = `
        UPDATE sessions SET accessed_notes = ?, statistics = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        JSON.stringify(this.accessed_notes),
        JSON.stringify(this.statistics),
        this.id
      ]);

      // Update cache
      const cacheKey = `session:${this.id}`;
      await redis.setex(cacheKey, 86400, JSON.stringify(this));

      return this;
    } catch (err) {
      throw new Error(`Gagal record note access: ${err.message}`);
    }
  }

  /**
   * Record note creation
   */
  async recordNoteCreation(noteId, { redis, scylla }) {
    try {
      // Tambah ke created_notes jika belum ada
      if (!this.created_notes.includes(noteId)) {
        this.created_notes.push(noteId);
        this.statistics.notes_created = (this.statistics.notes_created || 0) + 1;

        // Update di database
        const updateQuery = `
          UPDATE sessions SET created_notes = ?, statistics = ?
          WHERE id = ?
        `;
        
        await scylla.execute(updateQuery, [
          this.created_notes,
          JSON.stringify(this.statistics),
          this.id
        ]);

        // Update cache
        const cacheKey = `session:${this.id}`;
        await redis.setex(cacheKey, 86400, JSON.stringify(this));
      }

      return this;
    } catch (err) {
      throw new Error(`Gagal record note creation: ${err.message}`);
    }
  }

  /**
   * End session
   */
  async end(endReason = 'completed', { redis, scylla, elasticsearch }) {
    try {
      if (this.status !== 'active') {
        throw new Error('Session sudah tidak aktif');
      }

      this.ended_at = new Date();
      this.status = endReason === 'timeout' ? 'timeout' : 'completed';

      // Calculate session duration
      const durationMs = this.ended_at - this.started_at;
      const durationMinutes = Math.round(durationMs / (1000 * 60));

      // Update di database
      const updateQuery = `
        UPDATE sessions SET ended_at = ?, status = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        this.ended_at,
        this.status,
        this.id
      ]);

      // Update cache
      const cacheKey = `session:${this.id}`;
      await redis.setex(cacheKey, 86400, JSON.stringify(this));

      // Hapus dari active session cache
      const activeCacheKey = `session:active:${this.agent_id}`;
      await redis.del(activeCacheKey);

      // Update index dengan duration
      await elasticsearch.update({
        index: 'sessions',
        id: this.id,
        body: {
          doc: {
            ended_at: this.ended_at,
            status: this.status,
            duration_minutes: durationMinutes
          }
        }
      });

      return this;
    } catch (err) {
      throw new Error(`Gagal end session: ${err.message}`);
    }
  }

  /**
   * Auto-timeout expired sessions (scheduled job)
   */
  static async timeoutExpiredSessions({ redis, scylla, elasticsearch }) {
    try {
      // Sessions yang aktif lebih dari 24 jam dianggap timeout
      const timeoutThreshold = new Date();
      timeoutThreshold.setHours(timeoutThreshold.getHours() - 24);

      const selectQuery = `
        SELECT id FROM sessions 
        WHERE status = 'active' AND started_at < ?
      `;
      
      const result = await scylla.execute(selectQuery, [timeoutThreshold]);
      
      const timeoutPromises = result.rows.map(async (row) => {
        try {
          const session = await this.findById(row.id, { redis, scylla });
          if (session && session.status === 'active') {
            await session.end('timeout', { redis, scylla, elasticsearch });
            return row.id;
          }
        } catch (err) {
          console.error(`Error timing out session ${row.id}:`, err);
        }
        return null;
      });

      const timedOutSessions = await Promise.all(timeoutPromises);
      const successCount = timedOutSessions.filter(id => id !== null).length;

      return {
        processed: result.rows.length,
        timed_out: successCount
      };
    } catch (err) {
      throw new Error(`Gagal timeout expired sessions: ${err.message}`);
    }
  }

  /**
   * Get session analytics
   */
  static async getAnalytics(filters = {}, { scylla }) {
    try {
      let whereClause = '';
      const params = [];

      if (filters.user_id) {
        whereClause += ' WHERE user_id = ?';
        params.push(filters.user_id);
      }

      if (filters.date_from) {
        whereClause += whereClause ? ' AND' : ' WHERE';
        whereClause += ' started_at >= ?';
        params.push(filters.date_from);
      }

      if (filters.date_to) {
        whereClause += whereClause ? ' AND' : ' WHERE';
        whereClause += ' started_at <= ?';
        params.push(filters.date_to);
      }

      const analyticsQuery = `
        SELECT 
          status,
          COUNT(*) as session_count,
          AVG(statistics.queries_made) as avg_queries,
          AVG(statistics.notes_created) as avg_notes_created,
          AVG(statistics.response_time_avg_ms) as avg_response_time
        FROM sessions 
        ${whereClause}
        GROUP BY status
      `;
      
      const result = await scylla.execute(analyticsQuery, params);
      
      const analytics = {
        total_sessions: 0,
        by_status: {},
        overall_avg: {
          queries_per_session: 0,
          notes_per_session: 0,
          response_time_ms: 0
        }
      };

      let totalQueries = 0;
      let totalNotes = 0;
      let totalResponseTime = 0;
      let totalSessions = 0;

      result.rows.forEach(row => {
        const count = parseInt(row.session_count);
        const status = row.status;
        
        analytics.total_sessions += count;
        analytics.by_status[status] = {
          count: count,
          avg_queries: row.avg_queries || 0,
          avg_notes_created: row.avg_notes_created || 0,
          avg_response_time: row.avg_response_time || 0
        };

        totalQueries += (row.avg_queries || 0) * count;
        totalNotes += (row.avg_notes_created || 0) * count;
        totalResponseTime += (row.avg_response_time || 0) * count;
        totalSessions += count;
      });

      if (totalSessions > 0) {
        analytics.overall_avg = {
          queries_per_session: totalQueries / totalSessions,
          notes_per_session: totalNotes / totalSessions,
          response_time_ms: totalResponseTime / totalSessions
        };
      }

      return analytics;
    } catch (err) {
      throw new Error(`Gagal mengambil analytics: ${err.message}`);
    }
  }

  /**
   * Search sessions
   */
  static async search(query, filters = {}, { elasticsearch }) {
    try {
      const searchBody = {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: query,
                  fields: ['searchable_agent', 'user_organization']
                }
              }
            ]
          }
        },
        size: filters.limit || 20,
        from: filters.offset || 0
      };

      // Add filters
      if (filters.user_id) {
        searchBody.query.bool.must.push({
          term: { user_id: filters.user_id }
        });
      }

      if (filters.status) {
        searchBody.query.bool.must.push({
          term: { status: filters.status }
        });
      }

      if (filters.agent_id) {
        searchBody.query.bool.must.push({
          term: { agent_id: filters.agent_id }
        });
      }

      if (filters.date_from || filters.date_to) {
        const dateRange = {};
        if (filters.date_from) dateRange.gte = filters.date_from;
        if (filters.date_to) dateRange.lte = filters.date_to;
        
        searchBody.query.bool.must.push({
          range: { started_at: dateRange }
        });
      }

      // Sort by start time
      searchBody.sort = [
        { started_at: { order: 'desc' } }
      ];

      const response = await elasticsearch.search({
        index: 'sessions',
        body: searchBody
      });

      return {
        total: response.body.hits.total.value,
        sessions: response.body.hits.hits.map(hit => hit._source)
      };
    } catch (err) {
      throw new Error(`Gagal melakukan search sessions: ${err.message}`);
    }
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      id: this.id,
      agent_id: this.agent_id,
      user_id: this.user_id,
      started_at: this.started_at,
      ended_at: this.ended_at,
      status: this.status,
      statistics: this.statistics,
      accessed_notes: this.accessed_notes,
      created_notes: this.created_notes,
      metadata: this.metadata
    };
  }

  /**
   * Get session summary
   */
  getSummary() {
    const duration = this.ended_at 
      ? Math.round((this.ended_at - this.started_at) / (1000 * 60))
      : Math.round((new Date() - this.started_at) / (1000 * 60));

    return {
      id: this.id,
      agent_id: this.agent_id,
      status: this.status,
      duration_minutes: duration,
      notes_created: this.statistics.notes_created || 0,
      notes_accessed: this.statistics.notes_accessed || 0,
      queries_made: this.statistics.queries_made || 0,
      avg_response_time_ms: this.statistics.response_time_avg_ms || 0,
      started_at: this.started_at,
      ended_at: this.ended_at
    };
  }
}

export default Session;