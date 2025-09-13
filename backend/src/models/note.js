import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';

/**
 * Note Model
 * Primary entity untuk menyimpan setiap langkah dan pembelajaran AI Agent
 */
export class Note {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.agent_id = data.agent_id;
    this.session_id = data.session_id;
    this.timestamp = data.timestamp || new Date();
    this.type = data.type;
    this.context = data.context || {};
    this.content = data.content || {};
    this.embeddings = data.embeddings || [];
    this.metadata = data.metadata || {};
    this.created_at = data.created_at || new Date();
    this.updated_at = data.updated_at || new Date();
  }

  /**
   * Validation schema untuk Note entity
   */
  static getValidationSchema() {
    return Joi.object({
      id: Joi.string().uuid().optional(),
      agent_id: Joi.string().required().min(1).max(100)
        .messages({
          'any.required': 'agent_id wajib diisi',
          'string.empty': 'agent_id tidak boleh kosong'
        }),
      session_id: Joi.string().uuid().required()
        .messages({
          'any.required': 'session_id wajib diisi'
        }),
      timestamp: Joi.date().optional(),
      type: Joi.string().valid('build', 'development', 'bugfix', 'improvement').required()
        .messages({
          'any.required': 'type wajib diisi',
          'any.only': 'type harus salah satu dari: build, development, bugfix, improvement'
        }),
      context: Joi.object({
        task: Joi.string().required().min(1)
          .messages({
            'any.required': 'context.task wajib diisi'
          }),
        project: Joi.string().required().min(1)
          .messages({
            'any.required': 'context.project wajib diisi'
          }),
        tags: Joi.array().items(Joi.string()).default([])
      }).required(),
      content: Joi.object({
        action: Joi.string().required().min(10)
          .messages({
            'any.required': 'content.action wajib diisi',
            'string.min': 'content.action minimal 10 karakter'
          }),
        result: Joi.string().required().min(1)
          .messages({
            'any.required': 'content.result wajib diisi'
          }),
        learning: Joi.string().required().min(1)
          .messages({
            'any.required': 'content.learning wajib diisi'
          }),
        errors: Joi.array().items(Joi.string()).default([]),
        solution: Joi.string().allow('').default('')
      }).required(),
      embeddings: Joi.array().items(Joi.number()).length(768)
        .messages({
          'array.length': 'embeddings harus memiliki 768 dimensi (BERT-based model)'
        }),
      metadata: Joi.object({
        tokens_used: Joi.number().integer().min(0).default(0),
        duration_ms: Joi.number().integer().min(0).default(0),
        success: Joi.boolean().required()
          .messages({
            'any.required': 'metadata.success wajib diisi'
          })
      }).required(),
      created_at: Joi.date().optional(),
      updated_at: Joi.date().optional()
    });
  }

  /**
   * Validasi data Note
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
   * Membuat Note baru dengan validasi
   */
  static async create(noteData, { redis, scylla, elasticsearch }) {
    // Validasi data
    const { error, value } = this.validate(noteData);
    if (error) {
      throw new Error(`Validasi gagal: ${error.details.map(d => d.message).join(', ')}`);
    }

    const note = new Note(value);
    
    try {
      // 1. Simpan ke ScyllaDB (primary storage)
      const insertQuery = `
        INSERT INTO notes (
          id, agent_id, session_id, timestamp, type, 
          context, content, embeddings, metadata, 
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await scylla.execute(insertQuery, [
        note.id,
        note.agent_id,
        note.session_id,
        note.timestamp,
        note.type,
        JSON.stringify(note.context),
        JSON.stringify(note.content),
        note.embeddings,
        JSON.stringify(note.metadata),
        note.created_at,
        note.updated_at
      ]);

      // 2. Cache ke Redis (hot data)
      const cacheKey = `note:${note.id}`;
      await redis.setex(cacheKey, 86400, JSON.stringify(note)); // 24 jam

      // 3. Index ke Elasticsearch (searchable)
      await elasticsearch.index({
        index: 'notes',
        id: note.id,
        body: {
          ...note,
          content_text: `${note.content.action} ${note.content.result} ${note.content.learning}`,
          tags: note.context.tags
        }
      });

      return note;
    } catch (err) {
      throw new Error(`Gagal menyimpan note: ${err.message}`);
    }
  }

  /**
   * Mencari Note berdasarkan ID
   */
  static async findById(id, { redis, scylla, elasticsearch }) {
    try {
      // 1. Cek di Redis cache terlebih dahulu
      const cacheKey = `note:${id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return new Note(JSON.parse(cached));
      }

      // 2. Query dari ScyllaDB
      const selectQuery = 'SELECT * FROM notes WHERE id = ?';
      const result = await scylla.execute(selectQuery, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const note = new Note({
        id: row.id,
        agent_id: row.agent_id,
        session_id: row.session_id,
        timestamp: row.timestamp,
        type: row.type,
        context: JSON.parse(row.context),
        content: JSON.parse(row.content),
        embeddings: row.embeddings,
        metadata: JSON.parse(row.metadata),
        created_at: row.created_at,
        updated_at: row.updated_at
      });

      // 3. Cache untuk akses berikutnya
      await redis.setex(cacheKey, 86400, JSON.stringify(note));

      return note;
    } catch (err) {
      throw new Error(`Gagal mengambil note: ${err.message}`);
    }
  }

  /**
   * Mencari Notes berdasarkan agent_id dan tanggal
   */
  static async findByAgentAndDate(agentId, date, { redis, scylla }) {
    try {
      const dateStr = date.toISOString().split('T')[0];
      const cacheKey = `notes:agent:${agentId}:${dateStr}`;
      
      // Cek cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached).map(data => new Note(data));
      }

      // Query dari database
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const selectQuery = `
        SELECT * FROM notes 
        WHERE agent_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp DESC
      `;
      
      const result = await scylla.execute(selectQuery, [agentId, startDate, endDate]);
      
      const notes = result.rows.map(row => new Note({
        id: row.id,
        agent_id: row.agent_id,
        session_id: row.session_id,
        timestamp: row.timestamp,
        type: row.type,
        context: JSON.parse(row.context),
        content: JSON.parse(row.content),
        embeddings: row.embeddings,
        metadata: JSON.parse(row.metadata),
        created_at: row.created_at,
        updated_at: row.updated_at
      }));

      // Cache untuk 1 jam
      await redis.setex(cacheKey, 3600, JSON.stringify(notes));

      return notes;
    } catch (err) {
      throw new Error(`Gagal mengambil notes: ${err.message}`);
    }
  }

  /**
   * Semantic search menggunakan embeddings
   */
  static async searchSimilar(embeddings, agentId, limit = 10, { elasticsearch }) {
    try {
      const searchBody = {
        query: {
          bool: {
            must: [
              {
                term: { agent_id: agentId }
              }
            ],
            should: [
              {
                script_score: {
                  query: { match_all: {} },
                  script: {
                    source: "cosineSimilarity(params.query_vector, 'embeddings') + 1.0",
                    params: {
                      query_vector: embeddings
                    }
                  }
                }
              }
            ]
          }
        },
        size: limit,
        _source: ['id', 'agent_id', 'type', 'context', 'content', 'timestamp']
      };

      const response = await elasticsearch.search({
        index: 'notes',
        body: searchBody
      });

      return response.body.hits.hits.map(hit => ({
        ...hit._source,
        similarity_score: hit._score
      }));
    } catch (err) {
      throw new Error(`Gagal melakukan semantic search: ${err.message}`);
    }
  }

  /**
   * Full-text search
   */
  static async searchText(query, agentId, filters = {}, { elasticsearch }) {
    try {
      const searchBody = {
        query: {
          bool: {
            must: [
              {
                term: { agent_id: agentId }
              },
              {
                multi_match: {
                  query: query,
                  fields: ['content_text', 'context.task', 'context.project']
                }
              }
            ]
          }
        },
        size: filters.limit || 20,
        from: filters.offset || 0
      };

      // Tambah filter jika ada
      if (filters.type) {
        searchBody.query.bool.must.push({
          term: { type: filters.type }
        });
      }

      if (filters.tags && filters.tags.length > 0) {
        searchBody.query.bool.must.push({
          terms: { tags: filters.tags }
        });
      }

      if (filters.dateFrom || filters.dateTo) {
        const dateRange = {};
        if (filters.dateFrom) dateRange.gte = filters.dateFrom;
        if (filters.dateTo) dateRange.lte = filters.dateTo;
        
        searchBody.query.bool.must.push({
          range: { timestamp: dateRange }
        });
      }

      const response = await elasticsearch.search({
        index: 'notes',
        body: searchBody
      });

      return {
        total: response.body.hits.total.value,
        notes: response.body.hits.hits.map(hit => hit._source)
      };
    } catch (err) {
      throw new Error(`Gagal melakukan text search: ${err.message}`);
    }
  }

  /**
   * Update Note
   */
  async update(updateData, { redis, scylla, elasticsearch }) {
    // Validasi data update
    const allowedFields = ['context', 'content', 'metadata'];
    const filteredData = {};
    
    allowedFields.forEach(field => {
      if (updateData[field]) {
        filteredData[field] = updateData[field];
      }
    });

    if (Object.keys(filteredData).length === 0) {
      throw new Error('Tidak ada field yang valid untuk diupdate');
    }

    // Validasi data yang akan diupdate
    const { error } = Note.validate({ ...this, ...filteredData });
    if (error) {
      throw new Error(`Validasi gagal: ${error.details.map(d => d.message).join(', ')}`);
    }

    try {
      // Update fields
      Object.assign(this, filteredData);
      this.updated_at = new Date();

      // 1. Update di ScyllaDB
      const updateQuery = `
        UPDATE notes SET context = ?, content = ?, metadata = ?, updated_at = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        JSON.stringify(this.context),
        JSON.stringify(this.content),
        JSON.stringify(this.metadata),
        this.updated_at,
        this.id
      ]);

      // 2. Update cache
      const cacheKey = `note:${this.id}`;
      await redis.setex(cacheKey, 86400, JSON.stringify(this));

      // 3. Update index
      await elasticsearch.update({
        index: 'notes',
        id: this.id,
        body: {
          doc: {
            context: this.context,
            content: this.content,
            metadata: this.metadata,
            updated_at: this.updated_at,
            content_text: `${this.content.action} ${this.content.result} ${this.content.learning}`,
            tags: this.context.tags
          }
        }
      });

      return this;
    } catch (err) {
      throw new Error(`Gagal mengupdate note: ${err.message}`);
    }
  }

  /**
   * Archive Note (soft delete)
   */
  async archive({ redis, scylla, elasticsearch }) {
    try {
      // 1. Update status di ScyllaDB
      const updateQuery = `
        UPDATE notes SET metadata = ?, updated_at = ?
        WHERE id = ?
      `;
      
      this.metadata.archived = true;
      this.metadata.archived_at = new Date();
      this.updated_at = new Date();

      await scylla.execute(updateQuery, [
        JSON.stringify(this.metadata),
        this.updated_at,
        this.id
      ]);

      // 2. Hapus dari cache
      const cacheKey = `note:${this.id}`;
      await redis.del(cacheKey);

      // 3. Update index dengan status archived
      await elasticsearch.update({
        index: 'notes',
        id: this.id,
        body: {
          doc: {
            metadata: this.metadata,
            updated_at: this.updated_at
          }
        }
      });

      return this;
    } catch (err) {
      throw new Error(`Gagal mengarsip note: ${err.message}`);
    }
  }

  /**
   * Mengambil statistics Note untuk agent
   */
  static async getAgentStats(agentId, { scylla }) {
    try {
      const statsQuery = `
        SELECT type, COUNT(*) as count, AVG(metadata.tokens_used) as avg_tokens
        FROM notes 
        WHERE agent_id = ? AND metadata.archived IS NULL
        GROUP BY type
      `;
      
      const result = await scylla.execute(statsQuery, [agentId]);
      
      const stats = {
        total_notes: 0,
        by_type: {},
        avg_tokens: 0
      };

      let totalTokens = 0;
      
      result.rows.forEach(row => {
        const count = parseInt(row.count);
        stats.total_notes += count;
        stats.by_type[row.type] = count;
        totalTokens += row.avg_tokens * count;
      });

      stats.avg_tokens = stats.total_notes > 0 ? totalTokens / stats.total_notes : 0;

      return stats;
    } catch (err) {
      throw new Error(`Gagal mengambil statistik: ${err.message}`);
    }
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      id: this.id,
      agent_id: this.agent_id,
      session_id: this.session_id,
      timestamp: this.timestamp,
      type: this.type,
      context: this.context,
      content: this.content,
      embeddings: this.embeddings,
      metadata: this.metadata,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

export default Note;