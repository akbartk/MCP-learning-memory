import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';

/**
 * Experience Model
 * Journey tracking untuk complete tasks/projects
 */
export class Experience {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.project_id = data.project_id;
    this.title = data.title;
    this.description = data.description;
    this.journey = data.journey || [];
    this.outcomes = data.outcomes || {};
    this.lessons_learned = data.lessons_learned || [];
    this.applicable_domains = data.applicable_domains || [];
    this.status = data.status || 'active'; // active, completed, abandoned
    this.created_at = data.created_at || new Date();
    this.completed_at = data.completed_at || null;
    this.updated_at = data.updated_at || new Date();
  }

  /**
   * Validation schema untuk Experience entity
   */
  static getValidationSchema() {
    return Joi.object({
      id: Joi.string().uuid().optional(),
      project_id: Joi.string().required().min(1)
        .messages({
          'any.required': 'project_id wajib diisi'
        }),
      title: Joi.string().required().min(5).max(200)
        .messages({
          'any.required': 'title wajib diisi',
          'string.min': 'title minimal 5 karakter'
        }),
      description: Joi.string().required().min(10)
        .messages({
          'any.required': 'description wajib diisi',
          'string.min': 'description minimal 10 karakter'
        }),
      journey: Joi.array().items(
        Joi.object({
          sequence: Joi.number().integer().min(1).required(),
          note_id: Joi.string().uuid().required(),
          timestamp: Joi.date().required(),
          milestone: Joi.string().required().min(1)
        })
      ).min(5)
        .messages({
          'array.min': 'Journey minimal memerlukan 5 notes untuk experience yang valid'
        }),
      outcomes: Joi.object({
        success: Joi.boolean().when('$isCompleted', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        metrics: Joi.object().default({}),
        duration_hours: Joi.number().min(0).optional(),
        iterations: Joi.number().integer().min(1).optional()
      }).default({}),
      lessons_learned: Joi.array().items(Joi.string().min(5)).when('$isCompleted', {
        is: true,
        then: Joi.array().min(1),
        otherwise: Joi.array().min(0)
      }).messages({
        'array.min': 'Experience yang selesai harus memiliki minimal 1 lesson learned'
      }),
      applicable_domains: Joi.array().items(Joi.string()).default([]),
      status: Joi.string().valid('active', 'completed', 'abandoned').default('active'),
      created_at: Joi.date().optional(),
      completed_at: Joi.date().when('status', {
        is: 'completed',
        then: Joi.required(),
        otherwise: Joi.allow(null)
      }),
      updated_at: Joi.date().optional()
    });
  }

  /**
   * Validasi data Experience
   */
  static validate(data, isCompleted = false) {
    const schema = this.getValidationSchema();
    return schema.validate(data, { 
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
      context: { isCompleted }
    });
  }

  /**
   * Membuat Experience baru dengan validasi
   */
  static async create(experienceData, { redis, scylla, elasticsearch }) {
    // Validasi data
    const { error, value } = this.validate(experienceData);
    if (error) {
      throw new Error(`Validasi gagal: ${error.details.map(d => d.message).join(', ')}`);
    }

    const experience = new Experience(value);
    
    try {
      // Verifikasi bahwa semua note_ids dalam journey ada
      await this._verifyJourneyNotes(experience.journey, { scylla });

      // Sort journey berdasarkan sequence dan timestamp
      experience.journey = this._sortJourney(experience.journey);

      // 1. Simpan ke ScyllaDB
      const insertQuery = `
        INSERT INTO experiences (
          id, project_id, title, description, journey, outcomes,
          lessons_learned, applicable_domains, status, created_at, 
          completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await scylla.execute(insertQuery, [
        experience.id,
        experience.project_id,
        experience.title,
        experience.description,
        JSON.stringify(experience.journey),
        JSON.stringify(experience.outcomes),
        experience.lessons_learned,
        experience.applicable_domains,
        experience.status,
        experience.created_at,
        experience.completed_at,
        experience.updated_at
      ]);

      // 2. Cache ke Redis
      const cacheKey = `experience:${experience.id}`;
      await redis.setex(cacheKey, 7200, JSON.stringify(experience)); // 2 jam

      // Cache by project_id
      const projectCacheKey = `experiences:project:${experience.project_id}`;
      await redis.sadd(projectCacheKey, experience.id);
      await redis.expire(projectCacheKey, 3600);

      // 3. Index ke Elasticsearch
      await elasticsearch.index({
        index: 'experiences',
        id: experience.id,
        body: {
          ...experience,
          searchable_text: `${experience.title} ${experience.description} ${experience.lessons_learned.join(' ')}`,
          journey_count: experience.journey.length,
          domains_text: experience.applicable_domains.join(' ')
        }
      });

      return experience;
    } catch (err) {
      throw new Error(`Gagal menyimpan experience: ${err.message}`);
    }
  }

  /**
   * Verifikasi bahwa note IDs dalam journey valid
   */
  static async _verifyJourneyNotes(journey, { scylla }) {
    const noteIds = journey.map(j => j.note_id);
    const uniqueIds = [...new Set(noteIds)];
    
    if (uniqueIds.length !== noteIds.length) {
      throw new Error('Journey tidak boleh memiliki note_id yang duplikat');
    }

    const placeholders = uniqueIds.map(() => '?').join(',');
    const query = `SELECT id FROM notes WHERE id IN (${placeholders})`;
    const result = await scylla.execute(query, uniqueIds);
    
    if (result.rows.length !== uniqueIds.length) {
      const foundIds = result.rows.map(row => row.id);
      const missingIds = uniqueIds.filter(id => !foundIds.includes(id));
      throw new Error(`Note IDs tidak ditemukan: ${missingIds.join(', ')}`);
    }
  }

  /**
   * Sort journey berdasarkan sequence dan timestamp
   */
  static _sortJourney(journey) {
    return journey.sort((a, b) => {
      if (a.sequence !== b.sequence) {
        return a.sequence - b.sequence;
      }
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
  }

  /**
   * Mencari Experience berdasarkan ID
   */
  static async findById(id, { redis, scylla }) {
    try {
      // Cek cache terlebih dahulu
      const cacheKey = `experience:${id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return new Experience(JSON.parse(cached));
      }

      // Query dari ScyllaDB
      const selectQuery = 'SELECT * FROM experiences WHERE id = ?';
      const result = await scylla.execute(selectQuery, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const experience = new Experience({
        id: row.id,
        project_id: row.project_id,
        title: row.title,
        description: row.description,
        journey: JSON.parse(row.journey),
        outcomes: JSON.parse(row.outcomes),
        lessons_learned: row.lessons_learned,
        applicable_domains: row.applicable_domains,
        status: row.status,
        created_at: row.created_at,
        completed_at: row.completed_at,
        updated_at: row.updated_at
      });

      // Cache untuk akses berikutnya
      await redis.setex(cacheKey, 7200, JSON.stringify(experience));

      return experience;
    } catch (err) {
      throw new Error(`Gagal mengambil experience: ${err.message}`);
    }
  }

  /**
   * Mencari Experience berdasarkan project_id
   */
  static async findByProject(projectId, { redis, scylla }) {
    try {
      const cacheKey = `experiences:project:${projectId}`;
      
      // Cek cache untuk experience IDs
      const cachedIds = await redis.smembers(cacheKey);
      if (cachedIds.length > 0) {
        const experiencePromises = cachedIds.map(id => this.findById(id, { redis, scylla }));
        const experiences = await Promise.all(experiencePromises);
        return experiences.filter(e => e !== null);
      }

      // Query dari database
      const selectQuery = `
        SELECT * FROM experiences 
        WHERE project_id = ?
        ORDER BY created_at DESC
      `;
      
      const result = await scylla.execute(selectQuery, [projectId]);
      
      const experiences = result.rows.map(row => new Experience({
        id: row.id,
        project_id: row.project_id,
        title: row.title,
        description: row.description,
        journey: JSON.parse(row.journey),
        outcomes: JSON.parse(row.outcomes),
        lessons_learned: row.lessons_learned,
        applicable_domains: row.applicable_domains,
        status: row.status,
        created_at: row.created_at,
        completed_at: row.completed_at,
        updated_at: row.updated_at
      }));

      // Cache IDs untuk project
      if (experiences.length > 0) {
        const ids = experiences.map(e => e.id);
        await redis.sadd(cacheKey, ...ids);
        await redis.expire(cacheKey, 3600);
      }

      return experiences;
    } catch (err) {
      throw new Error(`Gagal mengambil experiences berdasarkan project: ${err.message}`);
    }
  }

  /**
   * Search experiences
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
                  fields: ['title^3', 'description^2', 'searchable_text', 'domains_text']
                }
              }
            ]
          }
        },
        size: filters.limit || 10,
        from: filters.offset || 0
      };

      // Add filters
      if (filters.project_id) {
        searchBody.query.bool.must.push({
          term: { project_id: filters.project_id }
        });
      }

      if (filters.status) {
        searchBody.query.bool.must.push({
          term: { status: filters.status }
        });
      }

      if (filters.domain) {
        searchBody.query.bool.must.push({
          term: { applicable_domains: filters.domain }
        });
      }

      if (filters.minJourneyLength) {
        searchBody.query.bool.must.push({
          range: {
            journey_count: {
              gte: filters.minJourneyLength
            }
          }
        });
      }

      // Sort by relevance and completion date
      searchBody.sort = [
        { _score: { order: 'desc' } },
        { completed_at: { order: 'desc', unmapped_type: 'date' } },
        { created_at: { order: 'desc' } }
      ];

      const response = await elasticsearch.search({
        index: 'experiences',
        body: searchBody
      });

      return {
        total: response.body.hits.total.value,
        experiences: response.body.hits.hits.map(hit => ({
          ...hit._source,
          relevance_score: hit._score
        }))
      };
    } catch (err) {
      throw new Error(`Gagal melakukan search experiences: ${err.message}`);
    }
  }

  /**
   * Tambah milestone baru ke journey
   */
  async addMilestone(noteId, milestone, { redis, scylla, elasticsearch }) {
    try {
      if (this.status === 'completed') {
        throw new Error('Tidak dapat menambah milestone ke experience yang sudah selesai');
      }

      // Verifikasi note_id exists
      await Experience._verifyJourneyNotes([{ note_id: noteId }], { scylla });

      // Cek apakah note_id sudah ada dalam journey
      if (this.journey.some(j => j.note_id === noteId)) {
        throw new Error('Note ID sudah ada dalam journey');
      }

      // Tentukan sequence number berikutnya
      const maxSequence = this.journey.length > 0 
        ? Math.max(...this.journey.map(j => j.sequence))
        : 0;

      const newJourney = {
        sequence: maxSequence + 1,
        note_id: noteId,
        timestamp: new Date(),
        milestone: milestone
      };

      this.journey.push(newJourney);
      this.updated_at = new Date();

      // Update di database
      const updateQuery = `
        UPDATE experiences 
        SET journey = ?, updated_at = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        JSON.stringify(this.journey),
        this.updated_at,
        this.id
      ]);

      // Update cache
      const cacheKey = `experience:${this.id}`;
      await redis.setex(cacheKey, 7200, JSON.stringify(this));

      // Update index
      await elasticsearch.update({
        index: 'experiences',
        id: this.id,
        body: {
          doc: {
            journey: this.journey,
            updated_at: this.updated_at,
            journey_count: this.journey.length
          }
        }
      });

      return this;
    } catch (err) {
      throw new Error(`Gagal menambah milestone: ${err.message}`);
    }
  }

  /**
   * Complete experience dengan outcomes dan lessons learned
   */
  async complete(completionData, { redis, scylla, elasticsearch }) {
    try {
      if (this.status === 'completed') {
        throw new Error('Experience sudah dalam status completed');
      }

      // Validasi completion data
      const completionSchema = Joi.object({
        success: Joi.boolean().required(),
        metrics: Joi.object().default({}),
        duration_hours: Joi.number().min(0).optional(),
        iterations: Joi.number().integer().min(1).optional(),
        lessons_learned: Joi.array().items(Joi.string().min(5)).min(1).required()
          .messages({
            'array.min': 'Minimal 1 lesson learned diperlukan untuk menyelesaikan experience'
          })
      });

      const { error, value } = completionSchema.validate(completionData);
      if (error) {
        throw new Error(`Validasi completion data gagal: ${error.details.map(d => d.message).join(', ')}`);
      }

      // Calculate duration jika tidak disediakan
      if (!value.duration_hours && this.journey.length > 0) {
        const startTime = new Date(this.journey[0].timestamp);
        const endTime = new Date();
        value.duration_hours = (endTime - startTime) / (1000 * 60 * 60); // ms to hours
      }

      // Calculate iterations jika tidak disediakan
      if (!value.iterations) {
        value.iterations = this.journey.length;
      }

      // Update properties
      this.outcomes = {
        success: value.success,
        metrics: value.metrics,
        duration_hours: value.duration_hours,
        iterations: value.iterations
      };
      this.lessons_learned = value.lessons_learned;
      this.status = 'completed';
      this.completed_at = new Date();
      this.updated_at = new Date();

      // Extract applicable domains dari journey notes
      if (this.applicable_domains.length === 0) {
        this.applicable_domains = await this._extractDomains({ scylla });
      }

      // Update di database
      const updateQuery = `
        UPDATE experiences 
        SET outcomes = ?, lessons_learned = ?, applicable_domains = ?,
            status = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        JSON.stringify(this.outcomes),
        this.lessons_learned,
        this.applicable_domains,
        this.status,
        this.completed_at,
        this.updated_at,
        this.id
      ]);

      // Update cache
      const cacheKey = `experience:${this.id}`;
      await redis.setex(cacheKey, 7200, JSON.stringify(this));

      // Update index
      await elasticsearch.update({
        index: 'experiences',
        id: this.id,
        body: {
          doc: {
            outcomes: this.outcomes,
            lessons_learned: this.lessons_learned,
            applicable_domains: this.applicable_domains,
            status: this.status,
            completed_at: this.completed_at,
            updated_at: this.updated_at,
            searchable_text: `${this.title} ${this.description} ${this.lessons_learned.join(' ')}`,
            domains_text: this.applicable_domains.join(' ')
          }
        }
      });

      return this;
    } catch (err) {
      throw new Error(`Gagal menyelesaikan experience: ${err.message}`);
    }
  }

  /**
   * Extract domains dari notes dalam journey
   */
  async _extractDomains({ scylla }) {
    try {
      const noteIds = this.journey.map(j => j.note_id);
      const placeholders = noteIds.map(() => '?').join(',');
      
      const query = `
        SELECT context, type FROM notes 
        WHERE id IN (${placeholders})
      `;
      const result = await scylla.execute(query, noteIds);
      
      const domains = new Set();
      
      result.rows.forEach(row => {
        const context = JSON.parse(row.context);
        
        // Add domains dari tags
        if (context.tags) {
          context.tags.forEach(tag => domains.add(tag));
        }
        
        // Add domain dari project name
        if (context.project) {
          const projectWords = context.project.toLowerCase().split(/[\s\-_]/);
          projectWords.forEach(word => {
            if (word.length > 3) domains.add(word);
          });
        }
        
        // Add domain dari type
        domains.add(row.type);
      });
      
      return Array.from(domains).slice(0, 10); // Limit to 10 domains
    } catch (err) {
      console.error('Error extracting domains:', err);
      return [];
    }
  }

  /**
   * Abandon experience
   */
  async abandon(reason, { redis, scylla, elasticsearch }) {
    try {
      if (this.status === 'completed') {
        throw new Error('Tidak dapat abandon experience yang sudah completed');
      }

      this.status = 'abandoned';
      this.outcomes.success = false;
      this.outcomes.abandon_reason = reason;
      this.updated_at = new Date();

      // Update di database
      const updateQuery = `
        UPDATE experiences 
        SET status = ?, outcomes = ?, updated_at = ?
        WHERE id = ?
      `;
      
      await scylla.execute(updateQuery, [
        this.status,
        JSON.stringify(this.outcomes),
        this.updated_at,
        this.id
      ]);

      // Update cache
      const cacheKey = `experience:${this.id}`;
      await redis.setex(cacheKey, 7200, JSON.stringify(this));

      // Update index
      await elasticsearch.update({
        index: 'experiences',
        id: this.id,
        body: {
          doc: {
            status: this.status,
            outcomes: this.outcomes,
            updated_at: this.updated_at
          }
        }
      });

      return this;
    } catch (err) {
      throw new Error(`Gagal abandon experience: ${err.message}`);
    }
  }

  /**
   * Get experience statistics
   */
  static async getStats({ scylla }) {
    try {
      const statsQuery = `
        SELECT status, COUNT(*) as count, 
               AVG(CAST(journey_count AS int)) as avg_journey_length,
               AVG(outcomes.duration_hours) as avg_duration
        FROM (
          SELECT status, json_array_length(journey) as journey_count, outcomes
          FROM experiences
        ) 
        GROUP BY status
      `;
      
      const result = await scylla.execute(statsQuery, []);
      
      const stats = {
        total: 0,
        by_status: {},
        avg_journey_length: 0,
        avg_duration_hours: 0,
        success_rate: 0
      };

      let totalJourneyLength = 0;
      let totalDuration = 0;
      let completedCount = 0;
      let successfulCount = 0;
      
      result.rows.forEach(row => {
        const count = parseInt(row.count);
        const status = row.status;
        
        stats.total += count;
        stats.by_status[status] = count;
        
        totalJourneyLength += row.avg_journey_length * count;
        
        if (row.avg_duration && !isNaN(row.avg_duration)) {
          totalDuration += row.avg_duration * count;
        }
        
        if (status === 'completed') {
          completedCount += count;
          // Hitung success rate dari outcomes - ini perlu query tambahan
        }
      });

      stats.avg_journey_length = stats.total > 0 ? totalJourneyLength / stats.total : 0;
      stats.avg_duration_hours = stats.total > 0 ? totalDuration / stats.total : 0;

      // Query untuk success rate
      if (completedCount > 0) {
        const successQuery = `
          SELECT COUNT(*) as successful_count 
          FROM experiences 
          WHERE status = 'completed' AND JSON_EXTRACT(outcomes, '$.success') = true
        `;
        const successResult = await scylla.execute(successQuery, []);
        if (successResult.rows.length > 0) {
          successfulCount = parseInt(successResult.rows[0].successful_count);
          stats.success_rate = successfulCount / completedCount;
        }
      }

      return stats;
    } catch (err) {
      throw new Error(`Gagal mengambil statistik experience: ${err.message}`);
    }
  }

  /**
   * Get related experiences berdasarkan applicable domains
   */
  async getRelatedExperiences({ elasticsearch }) {
    try {
      if (this.applicable_domains.length === 0) {
        return [];
      }

      const searchBody = {
        query: {
          bool: {
            must: [
              {
                terms: {
                  applicable_domains: this.applicable_domains
                }
              }
            ],
            must_not: [
              {
                term: { id: this.id }
              }
            ]
          }
        },
        size: 5,
        sort: [
          { _score: { order: 'desc' } },
          { completed_at: { order: 'desc', unmapped_type: 'date' } }
        ]
      };

      const response = await elasticsearch.search({
        index: 'experiences',
        body: searchBody
      });

      return response.body.hits.hits.map(hit => ({
        ...hit._source,
        similarity_score: hit._score
      }));
    } catch (err) {
      throw new Error(`Gagal mencari related experiences: ${err.message}`);
    }
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      id: this.id,
      project_id: this.project_id,
      title: this.title,
      description: this.description,
      journey: this.journey,
      outcomes: this.outcomes,
      lessons_learned: this.lessons_learned,
      applicable_domains: this.applicable_domains,
      status: this.status,
      created_at: this.created_at,
      completed_at: this.completed_at,
      updated_at: this.updated_at
    };
  }
}

export default Experience;