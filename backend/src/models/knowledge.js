import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';

/**
 * Knowledge Model
 * Aggregated understanding dari multiple notes
 */
export class Knowledge {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.domain = data.domain;
    this.title = data.title;
    this.summary = data.summary;
    this.note_ids = data.note_ids || [];
    this.patterns = data.patterns || [];
    this.confidence_score = data.confidence_score || 0.0;
    this.last_updated = data.last_updated || new Date();
    this.version = data.version || 1;
    this.status = data.status || 'draft'; // draft, review, published, archived
    this.created_at = data.created_at || new Date();
  }

  /**
   * Validation schema untuk Knowledge entity
   */
  static getValidationSchema() {
    return Joi.object({
      id: Joi.string().uuid().optional(),
      domain: Joi.string().required().max(50).min(1)
        .messages({
          'any.required': 'domain wajib diisi',
          'string.max': 'domain maksimal 50 karakter'
        }),
      title: Joi.string().required().min(5).max(200)
        .messages({
          'any.required': 'title wajib diisi',
          'string.min': 'title minimal 5 karakter'
        }),
      summary: Joi.string().required().min(10)
        .messages({
          'any.required': 'summary wajib diisi',
          'string.min': 'summary minimal 10 karakter'
        }),
      note_ids: Joi.array().items(Joi.string().uuid()).min(2)
        .messages({
          'array.min': 'Minimal 2 notes diperlukan untuk membuat knowledge'
        }),
      patterns: Joi.array().items(
        Joi.object({
          pattern: Joi.string().required(),
          frequency: Joi.number().integer().min(1).required(),
          confidence: Joi.number().min(0.0).max(1.0).required()
        })
      ).default([]),
      confidence_score: Joi.number().min(0.0).max(1.0).default(0.0)
        .messages({
          'number.min': 'confidence_score harus antara 0.0 - 1.0',
          'number.max': 'confidence_score harus antara 0.0 - 1.0'
        }),
      last_updated: Joi.date().optional(),
      version: Joi.number().integer().min(1).default(1),
      status: Joi.string().valid('draft', 'review', 'published', 'archived').default('draft'),
      created_at: Joi.date().optional()
    });
  }

  /**
   * Validasi data Knowledge
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
   * Membuat Knowledge baru dengan validasi
   */
  static async create(knowledgeData, { redis, scylla, elasticsearch }) {
    // Validasi data
    const { error, value } = this.validate(knowledgeData);
    if (error) {
      throw new Error(`Validasi gagal: ${error.details.map(d => d.message).join(', ')}`);
    }

    const knowledge = new Knowledge(value);
    
    try {
      // Verifikasi bahwa semua note_ids ada
      await this._verifyNoteIds(knowledge.note_ids, { scylla });

      // Generate initial patterns dari notes
      const patterns = await this._generatePatterns(knowledge.note_ids, { scylla });
      knowledge.patterns = patterns;
      knowledge.confidence_score = this._calculateConfidenceScore(patterns, knowledge.note_ids.length);

      // 1. Simpan ke ScyllaDB
      const insertQuery = `
        INSERT INTO knowledge (
          id, domain, title, summary, note_ids, patterns, 
          confidence_score, last_updated, version, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await scylla.execute(insertQuery, [
        knowledge.id,
        knowledge.domain,
        knowledge.title,
        knowledge.summary,
        knowledge.note_ids,
        JSON.stringify(knowledge.patterns),
        knowledge.confidence_score,
        knowledge.last_updated,
        knowledge.version,
        knowledge.status,
        knowledge.created_at
      ]);

      // 2. Cache ke Redis
      const cacheKey = `knowledge:${knowledge.id}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(knowledge)); // 1 jam

      // Cache by domain
      const domainCacheKey = `knowledge:domain:${knowledge.domain}`;
      await redis.sadd(domainCacheKey, knowledge.id);
      await redis.expire(domainCacheKey, 1800); // 30 menit

      // 3. Index ke Elasticsearch
      await elasticsearch.index({
        index: 'knowledge',
        id: knowledge.id,
        body: {
          ...knowledge,
          searchable_text: `${knowledge.title} ${knowledge.summary} ${knowledge.patterns.map(p => p.pattern).join(' ')}`
        }
      });

      return knowledge;
    } catch (err) {
      throw new Error(`Gagal menyimpan knowledge: ${err.message}`);
    }
  }

  /**
   * Verifikasi bahwa note IDs yang diberikan valid
   */
  static async _verifyNoteIds(noteIds, { scylla }) {
    const placeholders = noteIds.map(() => '?').join(',');
    const query = `SELECT id FROM notes WHERE id IN (${placeholders})`;
    const result = await scylla.execute(query, noteIds);
    
    if (result.rows.length !== noteIds.length) {
      const foundIds = result.rows.map(row => row.id);
      const missingIds = noteIds.filter(id => !foundIds.includes(id));
      throw new Error(`Note IDs tidak ditemukan: ${missingIds.join(', ')}`);
    }
  }

  /**
   * Generate patterns dari notes
   */
  static async _generatePatterns(noteIds, { scylla }) {
    const placeholders = noteIds.map(() => '?').join(',');
    const query = `
      SELECT content, type, context FROM notes 
      WHERE id IN (${placeholders})
    `;
    const result = await scylla.execute(query, noteIds);
    
    const patterns = new Map();
    const typeFrequency = new Map();
    
    result.rows.forEach(row => {
      const content = JSON.parse(row.content);
      const context = JSON.parse(row.context);
      const type = row.type;
      
      // Pattern dari type
      typeFrequency.set(type, (typeFrequency.get(type) || 0) + 1);
      
      // Pattern dari errors yang umum
      if (content.errors && content.errors.length > 0) {
        content.errors.forEach(error => {
          const errorPattern = this._extractErrorPattern(error);
          if (errorPattern) {
            patterns.set(errorPattern, (patterns.get(errorPattern) || 0) + 1);
          }
        });
      }
      
      // Pattern dari tags
      if (context.tags && context.tags.length > 0) {
        context.tags.forEach(tag => {
          const tagPattern = `tag:${tag}`;
          patterns.set(tagPattern, (patterns.get(tagPattern) || 0) + 1);
        });
      }
    });
    
    // Convert ke array dan hitung confidence
    const allPatterns = [];
    const totalNotes = noteIds.length;
    
    // Add type patterns
    typeFrequency.forEach((frequency, type) => {
      allPatterns.push({
        pattern: `type:${type}`,
        frequency,
        confidence: frequency / totalNotes
      });
    });
    
    // Add other patterns
    patterns.forEach((frequency, pattern) => {
      allPatterns.push({
        pattern,
        frequency,
        confidence: frequency / totalNotes
      });
    });
    
    // Sort by confidence and take top 10
    return allPatterns
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  }

  /**
   * Extract error pattern dari error message
   */
  static _extractErrorPattern(errorMessage) {
    // Simple pattern extraction - bisa diperbaiki dengan NLP
    const commonPatterns = [
      /connection.*failed/i,
      /timeout/i,
      /permission.*denied/i,
      /file.*not.*found/i,
      /syntax.*error/i,
      /memory.*error/i,
      /network.*error/i
    ];
    
    for (const pattern of commonPatterns) {
      if (pattern.test(errorMessage)) {
        return pattern.source.replace(/\.\*/g, ' ').replace(/[()]/g, '');
      }
    }
    
    return null;
  }

  /**
   * Hitung confidence score berdasarkan patterns dan jumlah notes
   */
  static _calculateConfidenceScore(patterns, noteCount) {
    if (patterns.length === 0 || noteCount < 2) return 0.0;
    
    // Base confidence dari jumlah notes
    let baseScore = Math.min(noteCount / 10, 1.0); // Max di 10 notes
    
    // Boost dari pattern strength
    const avgPatternConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    
    // Final score adalah kombinasi dari base dan pattern confidence
    return Math.min((baseScore * 0.6) + (avgPatternConfidence * 0.4), 1.0);
  }

  /**
   * Mencari Knowledge berdasarkan ID
   */
  static async findById(id, { redis, scylla }) {
    try {
      // Cek cache terlebih dahulu
      const cacheKey = `knowledge:${id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return new Knowledge(JSON.parse(cached));
      }

      // Query dari ScyllaDB
      const selectQuery = 'SELECT * FROM knowledge WHERE id = ?';
      const result = await scylla.execute(selectQuery, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const knowledge = new Knowledge({
        id: row.id,
        domain: row.domain,
        title: row.title,
        summary: row.summary,
        note_ids: row.note_ids,
        patterns: JSON.parse(row.patterns),
        confidence_score: row.confidence_score,
        last_updated: row.last_updated,
        version: row.version,
        status: row.status,
        created_at: row.created_at
      });

      // Cache untuk akses berikutnya
      await redis.setex(cacheKey, 3600, JSON.stringify(knowledge));

      return knowledge;
    } catch (err) {
      throw new Error(`Gagal mengambil knowledge: ${err.message}`);
    }
  }

  /**
   * Mencari Knowledge berdasarkan domain
   */
  static async findByDomain(domain, { redis, scylla }) {
    try {
      const cacheKey = `knowledge:domain:${domain}`;
      
      // Cek cache untuk knowledge IDs
      const cachedIds = await redis.smembers(cacheKey);
      if (cachedIds.length > 0) {
        const knowledgePromises = cachedIds.map(id => this.findById(id, { redis, scylla }));
        const knowledge = await Promise.all(knowledgePromises);
        return knowledge.filter(k => k !== null);
      }

      // Query dari database
      const selectQuery = `
        SELECT * FROM knowledge 
        WHERE domain = ? AND status IN ('published', 'review')
        ORDER BY confidence_score DESC
      `;
      
      const result = await scylla.execute(selectQuery, [domain]);
      
      const knowledge = result.rows.map(row => new Knowledge({
        id: row.id,
        domain: row.domain,
        title: row.title,
        summary: row.summary,
        note_ids: row.note_ids,
        patterns: JSON.parse(row.patterns),
        confidence_score: row.confidence_score,
        last_updated: row.last_updated,
        version: row.version,
        status: row.status,
        created_at: row.created_at
      }));

      // Cache IDs untuk domain
      if (knowledge.length > 0) {
        const ids = knowledge.map(k => k.id);
        await redis.sadd(cacheKey, ...ids);
        await redis.expire(cacheKey, 1800);
      }

      return knowledge;
    } catch (err) {
      throw new Error(`Gagal mengambil knowledge berdasarkan domain: ${err.message}`);
    }
  }

  /**
   * Search knowledge berdasarkan query
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
                  fields: ['title^3', 'summary^2', 'searchable_text', 'domain']
                }
              }
            ]
          }
        },
        size: filters.limit || 10,
        from: filters.offset || 0
      };

      // Add filters
      if (filters.domain) {
        searchBody.query.bool.must.push({
          term: { domain: filters.domain }
        });
      }

      if (filters.status) {
        searchBody.query.bool.must.push({
          term: { status: filters.status }
        });
      }

      if (filters.minConfidence) {
        searchBody.query.bool.must.push({
          range: {
            confidence_score: {
              gte: filters.minConfidence
            }
          }
        });
      }

      // Sort by relevance and confidence
      searchBody.sort = [
        { _score: { order: 'desc' } },
        { confidence_score: { order: 'desc' } }
      ];

      const response = await elasticsearch.search({
        index: 'knowledge',
        body: searchBody
      });

      return {
        total: response.body.hits.total.value,
        knowledge: response.body.hits.hits.map(hit => ({
          ...hit._source,
          relevance_score: hit._score
        }))
      };
    } catch (err) {
      throw new Error(`Gagal melakukan search knowledge: ${err.message}`);
    }
  }

  /**
   * Update Knowledge dengan notes baru
   */
  async addNotes(noteIds, { redis, scylla, elasticsearch }) {
    try {
      // Verifikasi note IDs
      await Knowledge._verifyNoteIds(noteIds, { scylla });

      // Tambah ke existing note_ids (avoid duplicates)
      const newNoteIds = [...new Set([...this.note_ids, ...noteIds])];
      
      if (newNoteIds.length === this.note_ids.length) {
        throw new Error('Semua note IDs sudah ada dalam knowledge ini');
      }

      // Re-generate patterns dengan notes yang baru
      const patterns = await Knowledge._generatePatterns(newNoteIds, { scylla });
      
      // Update properties
      this.note_ids = newNoteIds;
      this.patterns = patterns;
      this.confidence_score = Knowledge._calculateConfidenceScore(patterns, newNoteIds.length);
      this.last_updated = new Date();
      this.version += 1;

      // Update di database
      const updateQuery = `
        UPDATE knowledge 
        SET note_ids = ?, patterns = ?, confidence_score = ?, 
            last_updated = ?, version = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        this.note_ids,
        JSON.stringify(this.patterns),
        this.confidence_score,
        this.last_updated,
        this.version,
        this.id
      ]);

      // Update cache
      const cacheKey = `knowledge:${this.id}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(this));

      // Update index
      await elasticsearch.update({
        index: 'knowledge',
        id: this.id,
        body: {
          doc: {
            note_ids: this.note_ids,
            patterns: this.patterns,
            confidence_score: this.confidence_score,
            last_updated: this.last_updated,
            version: this.version,
            searchable_text: `${this.title} ${this.summary} ${this.patterns.map(p => p.pattern).join(' ')}`
          }
        }
      });

      return this;
    } catch (err) {
      throw new Error(`Gagal menambah notes ke knowledge: ${err.message}`);
    }
  }

  /**
   * Update status knowledge (state transition)
   */
  async updateStatus(newStatus, { redis, scylla, elasticsearch }) {
    const validTransitions = {
      draft: ['review', 'archived'],
      review: ['published', 'draft', 'archived'],
      published: ['archived'],
      archived: ['draft'] // allow unarchive
    };

    if (!validTransitions[this.status].includes(newStatus)) {
      throw new Error(`Transisi status dari ${this.status} ke ${newStatus} tidak diperbolehkan`);
    }

    try {
      this.status = newStatus;
      this.last_updated = new Date();
      
      // Jika dipublish, increment version
      if (newStatus === 'published') {
        this.version += 1;
      }

      // Update di database
      const updateQuery = `
        UPDATE knowledge 
        SET status = ?, last_updated = ?, version = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        this.status,
        this.last_updated,
        this.version,
        this.id
      ]);

      // Update cache
      const cacheKey = `knowledge:${this.id}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(this));

      // Update index
      await elasticsearch.update({
        index: 'knowledge',
        id: this.id,
        body: {
          doc: {
            status: this.status,
            last_updated: this.last_updated,
            version: this.version
          }
        }
      });

      return this;
    } catch (err) {
      throw new Error(`Gagal mengupdate status knowledge: ${err.message}`);
    }
  }

  /**
   * Get knowledge statistics
   */
  static async getStats({ scylla }) {
    try {
      const statsQuery = `
        SELECT domain, status, COUNT(*) as count, AVG(confidence_score) as avg_confidence
        FROM knowledge 
        GROUP BY domain, status
      `;
      
      const result = await scylla.execute(statsQuery, []);
      
      const stats = {
        total: 0,
        by_domain: {},
        by_status: {},
        avg_confidence: 0
      };

      let totalConfidence = 0;
      let totalCount = 0;
      
      result.rows.forEach(row => {
        const count = parseInt(row.count);
        const domain = row.domain;
        const status = row.status;
        const avgConf = row.avg_confidence;
        
        totalCount += count;
        totalConfidence += avgConf * count;
        
        if (!stats.by_domain[domain]) {
          stats.by_domain[domain] = {};
        }
        stats.by_domain[domain][status] = count;
        
        stats.by_status[status] = (stats.by_status[status] || 0) + count;
      });

      stats.total = totalCount;
      stats.avg_confidence = totalCount > 0 ? totalConfidence / totalCount : 0;

      return stats;
    } catch (err) {
      throw new Error(`Gagal mengambil statistik knowledge: ${err.message}`);
    }
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      id: this.id,
      domain: this.domain,
      title: this.title,
      summary: this.summary,
      note_ids: this.note_ids,
      patterns: this.patterns,
      confidence_score: this.confidence_score,
      last_updated: this.last_updated,
      version: this.version,
      status: this.status,
      created_at: this.created_at
    };
  }
}

export default Knowledge;