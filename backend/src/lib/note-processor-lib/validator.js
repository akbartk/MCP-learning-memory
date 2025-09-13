/**
 * Note Validator - Input Validation for Notes
 * 
 * Menyediakan validation dan sanitization untuk note data
 * Mendukung berbagai validation rules dan custom validators
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import Joi from 'joi';

/**
 * Default validation schemas
 */
const schemas = {
  // Basic note schema
  note: Joi.object({
    id: Joi.string().uuid().optional(),
    userId: Joi.string().uuid().required()
      .messages({
        'string.uuid': 'User ID must be a valid UUID',
        'any.required': 'User ID is required'
      }),
    title: Joi.string().min(1).max(200).required()
      .messages({
        'string.min': 'Title cannot be empty',
        'string.max': 'Title cannot exceed 200 characters',
        'any.required': 'Title is required'
      }),
    content: Joi.string().min(1).max(50000).required()
      .messages({
        'string.min': 'Content cannot be empty',
        'string.max': 'Content cannot exceed 50,000 characters',
        'any.required': 'Content is required'
      }),
    summary: Joi.string().max(500).optional().allow(''),
    tags: Joi.array().items(
      Joi.string().min(1).max(50).pattern(/^[a-zA-Z0-9\-_\s]+$/)
    ).max(20).optional().default([])
      .messages({
        'array.max': 'Cannot have more than 20 tags',
        'string.pattern.base': 'Tags can only contain letters, numbers, hyphens, underscores, and spaces'
      }),
    category: Joi.string().min(1).max(50).optional().default('general'),
    priority: Joi.number().integer().min(0).max(5).optional().default(0),
    embedding: Joi.array().items(Joi.number()).optional(),
    metadata: Joi.object().optional().default({}),
    createdAt: Joi.string().isoDate().optional(),
    updatedAt: Joi.string().isoDate().optional()
  }),

  // Note update schema (semua field optional kecuali id)
  noteUpdate: Joi.object({
    id: Joi.string().uuid().required(),
    userId: Joi.string().uuid().optional(),
    title: Joi.string().min(1).max(200).optional(),
    content: Joi.string().min(1).max(50000).optional(),
    summary: Joi.string().max(500).optional().allow(''),
    tags: Joi.array().items(
      Joi.string().min(1).max(50).pattern(/^[a-zA-Z0-9\-_\s]+$/)
    ).max(20).optional(),
    category: Joi.string().min(1).max(50).optional(),
    priority: Joi.number().integer().min(0).max(5).optional(),
    embedding: Joi.array().items(Joi.number()).optional(),
    metadata: Joi.object().optional()
  }).min(2), // At least id + one other field

  // Batch note schema
  batchNotes: Joi.array().items(Joi.ref('note')).min(1).max(100)
    .messages({
      'array.min': 'Batch must contain at least 1 note',
      'array.max': 'Batch cannot contain more than 100 notes'
    }),

  // Search criteria schema
  searchCriteria: Joi.object({
    userId: Joi.string().uuid().required(),
    text: Joi.string().min(1).max(1000).optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    category: Joi.string().optional(),
    dateRange: Joi.object({
      from: Joi.string().isoDate().required(),
      to: Joi.string().isoDate().required()
    }).optional(),
    priority: Joi.object({
      min: Joi.number().integer().min(0).max(5).optional(),
      max: Joi.number().integer().min(0).max(5).optional()
    }).optional(),
    embedding: Joi.array().items(Joi.number()).optional()
  }).or('text', 'tags', 'category', 'dateRange', 'priority', 'embedding')
    .messages({
      'object.missing': 'At least one search criteria must be provided'
    }),

  // Learning session schema
  learningSession: Joi.object({
    id: Joi.string().uuid().optional(),
    userId: Joi.string().uuid().required(),
    title: Joi.string().min(1).max(200).required(),
    description: Joi.string().max(1000).optional().allow(''),
    notes: Joi.array().items(Joi.string().uuid()).optional().default([]),
    tags: Joi.array().items(Joi.string().min(1).max(50)).max(20).optional().default([]),
    status: Joi.string().valid('planned', 'active', 'completed', 'paused').optional().default('planned'),
    progress: Joi.number().min(0).max(100).optional().default(0),
    metadata: Joi.object().optional().default({})
  })
};

/**
 * Validator Class
 */
export class NoteValidator {
  constructor(customSchemas = {}) {
    this.schemas = { ...schemas, ...customSchemas };
    this.validationOptions = {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
      convert: true
    };
  }

  /**
   * Validate note data
   * @param {Object} noteData - Note data to validate
   * @param {string} schemaType - Schema type to use ('note', 'noteUpdate', etc.)
   * @returns {Object} Validation result
   */
  async validateNote(noteData, schemaType = 'note') {
    try {
      const schema = this.schemas[schemaType];
      if (!schema) {
        throw new Error(`Unknown schema type: ${schemaType}`);
      }

      const { error, value } = schema.validate(noteData, this.validationOptions);

      if (error) {
        return {
          valid: false,
          errors: error.details.map(detail => detail.message),
          errorDetails: error.details,
          sanitized: null
        };
      }

      // Additional custom validations
      const customValidationResult = await this.customValidations(value, schemaType);
      if (!customValidationResult.valid) {
        return customValidationResult;
      }

      return {
        valid: true,
        errors: [],
        sanitized: value,
        metadata: {
          schema: schemaType,
          validatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Validation error: ${error.message}`],
        sanitized: null
      };
    }
  }

  /**
   * Validate batch of notes
   * @param {Array} notesData - Array of note data
   * @returns {Object} Batch validation result
   */
  async validateBatch(notesData) {
    try {
      // First validate the batch structure
      const batchValidation = await this.validateNote(notesData, 'batchNotes');
      if (!batchValidation.valid) {
        return {
          valid: false,
          errors: batchValidation.errors,
          results: []
        };
      }

      // Then validate each note individually
      const results = await Promise.all(
        notesData.map(async (noteData, index) => {
          const result = await this.validateNote(noteData);
          return {
            index,
            noteId: noteData.id || `note-${index}`,
            ...result
          };
        })
      );

      const validNotes = results.filter(r => r.valid);
      const invalidNotes = results.filter(r => !r.valid);

      return {
        valid: invalidNotes.length === 0,
        totalNotes: notesData.length,
        validNotes: validNotes.length,
        invalidNotes: invalidNotes.length,
        results,
        errors: invalidNotes.length > 0 
          ? [`${invalidNotes.length} notes failed validation`]
          : [],
        sanitized: validNotes.map(r => r.sanitized)
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Batch validation error: ${error.message}`],
        results: []
      };
    }
  }

  /**
   * Custom validations yang tidak bisa dilakukan dengan Joi
   */
  async customValidations(data, schemaType) {
    const errors = [];

    // Validate content quality
    if (data.content && schemaType === 'note') {
      // Check untuk spam/suspicious content
      if (this.isSpamContent(data.content)) {
        errors.push('Content appears to be spam or suspicious');
      }

      // Check untuk minimum meaningful content
      if (!this.hasMeaningfulContent(data.content)) {
        errors.push('Content does not appear to contain meaningful information');
      }
    }

    // Validate title uniqueness untuk user (jika diperlukan)
    if (data.title && data.userId && schemaType === 'note') {
      // Note: Implementasi ini memerlukan database access
      // const isDuplicate = await this.checkTitleDuplicate(data.userId, data.title);
      // if (isDuplicate) {
      //   errors.push('A note with this title already exists');
      // }
    }

    // Validate tags quality
    if (data.tags && Array.isArray(data.tags)) {
      const invalidTags = data.tags.filter(tag => {
        return typeof tag !== 'string' || 
               tag.trim().length === 0 || 
               this.isInvalidTag(tag);
      });
      
      if (invalidTags.length > 0) {
        errors.push(`Invalid tags found: ${invalidTags.join(', ')}`);
      }
    }

    // Validate embedding dimensions jika ada
    if (data.embedding && Array.isArray(data.embedding)) {
      if (data.embedding.length !== 1536) { // OpenAI embedding size
        errors.push('Embedding must be exactly 1536 dimensions');
      }
      
      if (!data.embedding.every(val => typeof val === 'number' && !isNaN(val))) {
        errors.push('Embedding must contain only valid numbers');
      }
    }

    // Validate metadata size
    if (data.metadata) {
      const metadataSize = JSON.stringify(data.metadata).length;
      if (metadataSize > 10000) { // 10KB limit
        errors.push('Metadata is too large (max 10KB)');
      }
    }

    // Date validations
    if (data.createdAt && data.updatedAt) {
      const created = new Date(data.createdAt);
      const updated = new Date(data.updatedAt);
      
      if (updated < created) {
        errors.push('Updated date cannot be before created date');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized: errors.length === 0 ? data : null
    };
  }

  /**
   * Check jika content merupakan spam
   */
  isSpamContent(content) {
    const spamIndicators = [
      // Excessive capitalization
      /[A-Z]{10,}/,
      // Excessive punctuation
      /[!?]{5,}/,
      // Repetitive text
      /(.{3,})\1{3,}/,
      // Common spam phrases
      /\b(buy now|click here|free money|winner|congratulations)\b/i
    ];

    return spamIndicators.some(pattern => pattern.test(content));
  }

  /**
   * Check jika content memiliki meaningful information
   */
  hasMeaningfulContent(content) {
    const cleanContent = content.trim().toLowerCase();
    
    // Too short
    if (cleanContent.length < 10) return false;
    
    // Only special characters or numbers
    if (!/[a-zA-Z]/.test(cleanContent)) return false;
    
    // Too repetitive
    const words = cleanContent.split(/\s+/);
    const uniqueWords = new Set(words);
    if (words.length > 10 && uniqueWords.size / words.length < 0.3) return false;
    
    return true;
  }

  /**
   * Check jika tag invalid
   */
  isInvalidTag(tag) {
    const invalidPatterns = [
      /^\d+$/, // Only numbers
      /^[^a-zA-Z0-9]/, // Starts with special character
      /\s{2,}/, // Multiple spaces
      /[<>]/  // HTML-like characters
    ];

    return invalidPatterns.some(pattern => pattern.test(tag));
  }

  /**
   * Sanitize note data untuk security
   */
  sanitizeNote(noteData) {
    const sanitized = { ...noteData };

    // HTML encoding untuk text fields
    const textFields = ['title', 'content', 'summary'];
    textFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = this.htmlEncode(sanitized[field]);
      }
    });

    // Sanitize tags
    if (sanitized.tags && Array.isArray(sanitized.tags)) {
      sanitized.tags = sanitized.tags
        .map(tag => this.sanitizeTag(tag))
        .filter(tag => tag !== null);
    }

    // Remove potentially dangerous metadata keys
    if (sanitized.metadata) {
      const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
      dangerousKeys.forEach(key => {
        delete sanitized.metadata[key];
      });
    }

    return sanitized;
  }

  /**
   * HTML encode text untuk prevent XSS
   */
  htmlEncode(text) {
    const htmlEntities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;'
    };

    return text.replace(/[&<>"'\/]/g, (char) => htmlEntities[char]);
  }

  /**
   * Sanitize individual tag
   */
  sanitizeTag(tag) {
    if (typeof tag !== 'string') return null;
    
    const sanitized = tag
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special chars except word chars, spaces, hyphens
      .replace(/\s+/g, ' ') // Normalize spaces
      .substring(0, 50); // Limit length

    return sanitized.length > 0 ? sanitized : null;
  }

  /**
   * Validate search criteria
   */
  async validateSearchCriteria(criteria) {
    return await this.validateNote(criteria, 'searchCriteria');
  }

  /**
   * Validate learning session
   */
  async validateLearningSession(sessionData) {
    return await this.validateNote(sessionData, 'learningSession');
  }

  /**
   * Add custom schema
   */
  addSchema(name, schema) {
    this.schemas[name] = schema;
  }

  /**
   * Get schema by name
   */
  getSchema(name) {
    return this.schemas[name];
  }

  /**
   * Validate dengan custom schema
   */
  async validateWithSchema(data, schemaName) {
    return await this.validateNote(data, schemaName);
  }

  /**
   * Get validation statistics
   */
  getValidationRules() {
    return {
      note: {
        maxTitleLength: 200,
        maxContentLength: 50000,
        maxSummaryLength: 500,
        maxTags: 20,
        maxTagLength: 50,
        maxPriority: 5,
        requiredFields: ['userId', 'title', 'content'],
        optionalFields: ['id', 'summary', 'tags', 'category', 'priority', 'embedding', 'metadata']
      },
      batch: {
        maxNotesPerBatch: 100,
        minNotesPerBatch: 1
      },
      security: {
        htmlEncoding: true,
        xssProtection: true,
        spamDetection: true,
        contentQualityCheck: true
      }
    };
  }
}

/**
 * Default validator instance
 */
const validator = new NoteValidator();

export default validator;