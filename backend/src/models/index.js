/**
 * Models Index
 * Export semua model untuk MCP Server Learning-AI + Memory
 * 
 * Models disusun berdasarkan dependency order:
 * 1. User - Base entity untuk authentication
 * 2. Session - Tracking AI Agent sessions
 * 3. Note - Core learning data
 * 4. Knowledge - Aggregated insights dari notes
 * 5. Experience - Journey tracking dari multiple notes
 */

// Import individual models
import { User } from './user.js';
import { Session } from './session.js';
import { Note } from './note.js';
import { Knowledge } from './knowledge.js';
import { Experience } from './experience.js';

// Export individual models
export { User, Session, Note, Knowledge, Experience };

// Export sebagai default object untuk convenience
export default {
  User,
  Session,
  Note,
  Knowledge,
  Experience
};

/**
 * Model validation schemas untuk external usage
 */
export const ValidationSchemas = {
  User: User.getValidationSchema(),
  Session: Session.getValidationSchema(),
  Note: Note.getValidationSchema(),
  Knowledge: Knowledge.getValidationSchema(),
  Experience: Experience.getValidationSchema()
};

/**
 * Model utilities dan helper functions
 */
export class ModelUtils {
  /**
   * Validate data untuk model tertentu
   * @param {string} modelName - Nama model (User, Session, Note, etc.)
   * @param {Object} data - Data yang akan divalidasi
   * @returns {Object} - Result dari validasi
   */
  static validate(modelName, data) {
    const models = { User, Session, Note, Knowledge, Experience };
    const Model = models[modelName];
    
    if (!Model) {
      throw new Error(`Model ${modelName} tidak ditemukan`);
    }
    
    return Model.validate(data);
  }

  /**
   * Get model instance berdasarkan nama
   * @param {string} modelName - Nama model
   * @returns {Class} - Model class
   */
  static getModel(modelName) {
    const models = { User, Session, Note, Knowledge, Experience };
    return models[modelName];
  }

  /**
   * Bulk validation untuk multiple models
   * @param {Array} validations - Array of {model, data} objects
   * @returns {Array} - Array of validation results
   */
  static bulkValidate(validations) {
    return validations.map(({ model, data }) => {
      try {
        const result = this.validate(model, data);
        return {
          model,
          success: !result.error,
          data: result.value,
          error: result.error
        };
      } catch (err) {
        return {
          model,
          success: false,
          data: null,
          error: err
        };
      }
    });
  }

  /**
   * Get all model names
   * @returns {Array} - Array of model names
   */
  static getModelNames() {
    return ['User', 'Session', 'Note', 'Knowledge', 'Experience'];
  }

  /**
   * Check if model exists
   * @param {string} modelName - Nama model
   * @returns {boolean}
   */
  static hasModel(modelName) {
    return this.getModelNames().includes(modelName);
  }
}

/**
 * Database connection helper
 * Shared database connections untuk semua models
 */
export class DatabaseConnector {
  constructor() {
    this.redis = null;
    this.scylla = null;
    this.elasticsearch = null;
  }

  /**
   * Initialize database connections
   * @param {Object} connections - Database connections
   */
  initialize(connections) {
    this.redis = connections.redis;
    this.scylla = connections.scylla;
    this.elasticsearch = connections.elasticsearch;
  }

  /**
   * Get database connections untuk model operations
   * @returns {Object} - Database connections
   */
  getConnections() {
    if (!this.redis || !this.scylla || !this.elasticsearch) {
      throw new Error('Database connections belum diinisialisasi');
    }
    
    return {
      redis: this.redis,
      scylla: this.scylla,
      elasticsearch: this.elasticsearch
    };
  }

  /**
   * Health check untuk semua database connections
   * @returns {Object} - Health status
   */
  async healthCheck() {
    const health = {
      redis: false,
      scylla: false,
      elasticsearch: false,
      overall: false
    };

    try {
      // Redis health check
      if (this.redis) {
        await this.redis.ping();
        health.redis = true;
      }
    } catch (err) {
      console.error('Redis health check failed:', err);
    }

    try {
      // ScyllaDB health check
      if (this.scylla) {
        await this.scylla.execute('SELECT now() FROM system.local');
        health.scylla = true;
      }
    } catch (err) {
      console.error('ScyllaDB health check failed:', err);
    }

    try {
      // Elasticsearch health check
      if (this.elasticsearch) {
        await this.elasticsearch.ping();
        health.elasticsearch = true;
      }
    } catch (err) {
      console.error('Elasticsearch health check failed:', err);
    }

    health.overall = health.redis && health.scylla && health.elasticsearch;
    return health;
  }

  /**
   * Close semua database connections
   */
  async close() {
    const promises = [];

    if (this.redis) {
      promises.push(this.redis.quit().catch(err => 
        console.error('Error closing Redis connection:', err)
      ));
    }

    if (this.scylla) {
      promises.push(this.scylla.shutdown().catch(err => 
        console.error('Error closing ScyllaDB connection:', err)
      ));
    }

    // Elasticsearch client tidak perlu explicit close

    await Promise.all(promises);
  }
}

/**
 * Model factory untuk creation dengan database connections
 */
export class ModelFactory {
  constructor(dbConnector) {
    this.db = dbConnector;
  }

  /**
   * Create User instance
   * @param {Object} userData - User data
   * @returns {Promise<User>} - Created user
   */
  async createUser(userData) {
    return await User.create(userData, this.db.getConnections());
  }

  /**
   * Create Session instance
   * @param {Object} sessionData - Session data
   * @returns {Promise<Session>} - Created session
   */
  async createSession(sessionData) {
    return await Session.create(sessionData, this.db.getConnections());
  }

  /**
   * Create Note instance
   * @param {Object} noteData - Note data
   * @returns {Promise<Note>} - Created note
   */
  async createNote(noteData) {
    return await Note.create(noteData, this.db.getConnections());
  }

  /**
   * Create Knowledge instance
   * @param {Object} knowledgeData - Knowledge data
   * @returns {Promise<Knowledge>} - Created knowledge
   */
  async createKnowledge(knowledgeData) {
    return await Knowledge.create(knowledgeData, this.db.getConnections());
  }

  /**
   * Create Experience instance
   * @param {Object} experienceData - Experience data
   * @returns {Promise<Experience>} - Created experience
   */
  async createExperience(experienceData) {
    return await Experience.create(experienceData, this.db.getConnections());
  }

  /**
   * Find model by ID
   * @param {string} modelName - Model name
   * @param {string} id - Entity ID
   * @returns {Promise<Object>} - Found entity
   */
  async findById(modelName, id) {
    const Model = ModelUtils.getModel(modelName);
    if (!Model) {
      throw new Error(`Model ${modelName} tidak ditemukan`);
    }
    
    return await Model.findById(id, this.db.getConnections());
  }

  /**
   * Bulk operations untuk multiple entities
   * @param {Array} operations - Array of operation objects
   * @returns {Promise<Array>} - Results array
   */
  async bulkOperations(operations) {
    const promises = operations.map(async (op) => {
      try {
        switch (op.operation) {
          case 'create':
            return await this[`create${op.model}`](op.data);
          case 'findById':
            return await this.findById(op.model, op.id);
          default:
            throw new Error(`Operation ${op.operation} tidak didukung`);
        }
      } catch (err) {
        return {
          operation: op.operation,
          model: op.model,
          success: false,
          error: err.message
        };
      }
    });

    return await Promise.all(promises);
  }
}

/**
 * Model statistics dan monitoring
 */
export class ModelStats {
  constructor(dbConnector) {
    this.db = dbConnector;
  }

  /**
   * Get comprehensive statistics untuk semua models
   * @returns {Promise<Object>} - Statistics object
   */
  async getAllStats() {
    const { scylla } = this.db.getConnections();
    
    const stats = {};
    
    // Get stats dari setiap model
    const statPromises = [
      User.getStats({ scylla }).then(s => ({ model: 'User', stats: s })),
      Note.getAgentStats('all', { scylla }).then(s => ({ model: 'Note', stats: s })),
      Knowledge.getStats({ scylla }).then(s => ({ model: 'Knowledge', stats: s })),
      Experience.getStats({ scylla }).then(s => ({ model: 'Experience', stats: s })),
      Session.getAnalytics({}, { scylla }).then(s => ({ model: 'Session', stats: s }))
    ];

    try {
      const results = await Promise.allSettled(statPromises);
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          stats[result.value.model] = result.value.stats;
        } else {
          const modelNames = ['User', 'Note', 'Knowledge', 'Experience', 'Session'];
          stats[modelNames[index]] = { error: result.reason.message };
        }
      });

      // Add overall statistics
      stats.overall = {
        timestamp: new Date(),
        models_healthy: Object.keys(stats).filter(key => 
          key !== 'overall' && !stats[key].error
        ).length,
        total_models: 5
      };

    } catch (err) {
      stats.error = err.message;
    }

    return stats;
  }

  /**
   * Monitor model performance
   * @param {string} modelName - Model to monitor
   * @param {number} duration - Duration in minutes
   * @returns {Promise<Object>} - Performance metrics
   */
  async monitorPerformance(modelName, duration = 60) {
    // Implementasi monitoring bisa ditambahkan sesuai kebutuhan
    // Misalnya tracking query performance, cache hit rates, etc.
    
    return {
      model: modelName,
      duration_minutes: duration,
      metrics: {
        queries_per_minute: 0,
        avg_response_time_ms: 0,
        cache_hit_rate: 0,
        error_rate: 0
      },
      timestamp: new Date()
    };
  }
}

// Singleton instances untuk global usage
export const dbConnector = new DatabaseConnector();
export const modelFactory = new ModelFactory(dbConnector);
export const modelStats = new ModelStats(dbConnector);

/**
 * Initialize semua models dengan database connections
 * @param {Object} connections - Database connections
 * @returns {Object} - Initialized model utilities
 */
export function initializeModels(connections) {
  dbConnector.initialize(connections);
  
  return {
    models: { User, Session, Note, Knowledge, Experience },
    utils: ModelUtils,
    factory: modelFactory,
    stats: modelStats,
    connector: dbConnector
  };
}