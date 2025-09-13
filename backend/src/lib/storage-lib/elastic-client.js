/**
 * Elasticsearch Client - Elasticsearch Database Interface
 * 
 * Client untuk Elasticsearch operations
 * Mendukung full-text search, analytics, dan indexing
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { Client } from '@elastic/elasticsearch';

export default class ElasticClient {
  constructor(config = {}) {
    this.config = {
      node: config.node || process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
      username: config.username || process.env.ELASTICSEARCH_USERNAME || null,
      password: config.password || process.env.ELASTICSEARCH_PASSWORD || null,
      index: config.index || process.env.ELASTICSEARCH_INDEX || 'mcp_server',
      maxRetries: config.maxRetries || 3,
      requestTimeout: config.requestTimeout || 30000,
      pingTimeout: config.pingTimeout || 3000,
      ...config
    };

    this.client = null;
    this.isConnected = false;
    this.indices = {
      users: `${this.config.index}_users`,
      notes: `${this.config.index}_notes`,
      sessions: `${this.config.index}_sessions`,
      learning: `${this.config.index}_learning`,
      logs: `${this.config.index}_logs`
    };
  }

  /**
   * Connect ke Elasticsearch cluster
   */
  async connect() {
    try {
      const clientConfig = {
        node: this.config.node,
        maxRetries: this.config.maxRetries,
        requestTimeout: this.config.requestTimeout,
        pingTimeout: this.config.pingTimeout
      };

      // Add authentication jika ada
      if (this.config.username && this.config.password) {
        clientConfig.auth = {
          username: this.config.username,
          password: this.config.password
        };
      }

      this.client = new Client(clientConfig);

      // Test connection
      const info = await this.client.info();
      const clusterName = info?.body?.cluster_name || info?.cluster_name || 'Unknown';
      const version = info?.body?.version?.number || info?.version?.number || 'Unknown';
      console.log(`✅ Connected to Elasticsearch cluster: ${clusterName} (v${version})`);

      // Initialize indices (skip if fails)
      try {
        await this.initializeIndices();
      } catch (indexError) {
        console.warn('⚠️ Failed to initialize indices:', indexError.message);
      }

      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to Elasticsearch:', error);
      throw new Error(`Elasticsearch connection failed: ${error.message}`);
    }
  }

  /**
   * Initialize indices dengan mappings
   */
  async initializeIndices() {
    try {
      // Index mappings
      const mappings = {
        users: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              username: { type: 'keyword' },
              email: { type: 'keyword' },
              roles: { type: 'keyword' },
              permissions: { type: 'keyword' },
              created_at: { type: 'date' },
              updated_at: { type: 'date' },
              last_login: { type: 'date' },
              metadata: { type: 'object', enabled: false }
            }
          }
        },
        
        notes: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              user_id: { type: 'keyword' },
              title: { 
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              content: { 
                type: 'text',
                analyzer: 'standard'
              },
              summary: { type: 'text' },
              tags: { type: 'keyword' },
              category: { type: 'keyword' },
              priority: { type: 'integer' },
              embedding: { 
                type: 'dense_vector',
                dims: 1536
              },
              created_at: { type: 'date' },
              updated_at: { type: 'date' },
              archived_at: { type: 'date' },
              metadata: { type: 'object', enabled: false }
            }
          }
        },

        sessions: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              user_id: { type: 'keyword' },
              token_hash: { type: 'keyword' },
              expires_at: { type: 'date' },
              created_at: { type: 'date' },
              ip_address: { type: 'ip' },
              user_agent: { 
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' }
                }
              }
            }
          }
        },

        learning: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              user_id: { type: 'keyword' },
              title: { 
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              description: { type: 'text' },
              notes: { type: 'keyword' },
              tags: { type: 'keyword' },
              status: { type: 'keyword' },
              progress: { type: 'float' },
              started_at: { type: 'date' },
              completed_at: { type: 'date' },
              metadata: { type: 'object', enabled: false }
            }
          }
        },

        logs: {
          mappings: {
            properties: {
              timestamp: { type: 'date' },
              level: { type: 'keyword' },
              message: { type: 'text' },
              source: { type: 'keyword' },
              user_id: { type: 'keyword' },
              ip_address: { type: 'ip' },
              user_agent: { type: 'keyword' },
              metadata: { type: 'object', enabled: false }
            }
          }
        }
      };

      // Create indices jika belum ada
      for (const [indexType, indexName] of Object.entries(this.indices)) {
        try {
          const exists = await this.client.indices.exists({
            index: indexName
          });

          if (!exists.body) {
            await this.client.indices.create({
              index: indexName,
              body: mappings[indexType]
            });
            console.log(`✅ Created Elasticsearch index: ${indexName}`);
          }
        } catch (error) {
          console.error(`❌ Failed to create index ${indexName}:`, error);
        }
      }

      console.log('✅ Elasticsearch indices initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Elasticsearch indices:', error);
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      if (!this.client || !this.isConnected) return false;
      
      const health = await this.client.cluster.health();
      return health.body.status !== 'red';
    } catch (error) {
      console.error('❌ Elasticsearch health check failed:', error);
      return false;
    }
  }

  /**
   * Index document
   */
  async index(indexType, document, id = null) {
    try {
      const indexName = this.indices[indexType];
      if (!indexName) {
        throw new Error(`Unknown index type: ${indexType}`);
      }

      const params = {
        index: indexName,
        body: {
          ...document,
          indexed_at: new Date().toISOString()
        }
      };

      if (id) {
        params.id = id;
      }

      const result = await this.client.index(params);
      return result.body;
    } catch (error) {
      throw new Error(`Failed to index document: ${error.message}`);
    }
  }

  /**
   * Get document by ID
   */
  async get(indexType, id) {
    try {
      const indexName = this.indices[indexType];
      if (!indexName) {
        throw new Error(`Unknown index type: ${indexType}`);
      }

      const result = await this.client.get({
        index: indexName,
        id
      });

      return result.body._source;
    } catch (error) {
      if (error.meta?.statusCode === 404) {
        return null;
      }
      throw new Error(`Failed to get document: ${error.message}`);
    }
  }

  /**
   * Update document
   */
  async update(indexType, id, updates) {
    try {
      const indexName = this.indices[indexType];
      if (!indexName) {
        throw new Error(`Unknown index type: ${indexType}`);
      }

      const result = await this.client.update({
        index: indexName,
        id,
        body: {
          doc: {
            ...updates,
            updated_at: new Date().toISOString()
          }
        }
      });

      return result.body;
    } catch (error) {
      throw new Error(`Failed to update document: ${error.message}`);
    }
  }

  /**
   * Delete document
   */
  async delete(indexType, id) {
    try {
      const indexName = this.indices[indexType];
      if (!indexName) {
        throw new Error(`Unknown index type: ${indexType}`);
      }

      const result = await this.client.delete({
        index: indexName,
        id
      });

      return result.body;
    } catch (error) {
      throw new Error(`Failed to delete document: ${error.message}`);
    }
  }

  /**
   * Search documents
   */
  async search(indexType, query, options = {}) {
    try {
      const indexName = this.indices[indexType];
      if (!indexName) {
        throw new Error(`Unknown index type: ${indexType}`);
      }

      const {
        from = 0,
        size = 10,
        sort = [],
        highlight = null,
        aggregations = null
      } = options;

      const searchParams = {
        index: indexName,
        body: {
          query,
          from,
          size,
          sort
        }
      };

      if (highlight) {
        searchParams.body.highlight = highlight;
      }

      if (aggregations) {
        searchParams.body.aggs = aggregations;
      }

      const result = await this.client.search(searchParams);
      
      return {
        hits: result.body.hits.hits.map(hit => ({
          id: hit._id,
          score: hit._score,
          source: hit._source,
          highlight: hit.highlight
        })),
        total: result.body.hits.total.value,
        aggregations: result.body.aggregations
      };
    } catch (error) {
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  /**
   * Full-text search
   */
  async fullTextSearch(indexType, searchText, options = {}) {
    const query = {
      multi_match: {
        query: searchText,
        fields: options.fields || ['title^2', 'content', 'summary'],
        type: 'best_fields',
        fuzziness: options.fuzziness || 'AUTO'
      }
    };

    return await this.search(indexType, query, options);
  }

  /**
   * Semantic search menggunakan vector similarity
   */
  async semanticSearch(indexType, embedding, options = {}) {
    const query = {
      script_score: {
        query: { match_all: {} },
        script: {
          source: "cosineSimilarity(params.query_vector, 'embedding') + 1.0",
          params: {
            query_vector: embedding
          }
        }
      }
    };

    return await this.search(indexType, query, options);
  }

  /**
   * Aggregated search
   */
  async aggregate(indexType, aggregations, query = { match_all: {} }) {
    try {
      const indexName = this.indices[indexType];
      if (!indexName) {
        throw new Error(`Unknown index type: ${indexType}`);
      }

      const result = await this.client.search({
        index: indexName,
        body: {
          query,
          size: 0,
          aggs: aggregations
        }
      });

      return result.body.aggregations;
    } catch (error) {
      throw new Error(`Aggregation failed: ${error.message}`);
    }
  }

  /**
   * Bulk operations
   */
  async bulk(operations) {
    try {
      const body = operations.flatMap(op => {
        const { action, indexType, id, document } = op;
        const indexName = this.indices[indexType];
        
        if (!indexName) {
          throw new Error(`Unknown index type: ${indexType}`);
        }

        const actionObj = { [action]: { _index: indexName } };
        if (id) actionObj[action]._id = id;

        if (action === 'index' || action === 'create') {
          return [actionObj, document];
        } else if (action === 'update') {
          return [actionObj, { doc: document }];
        } else {
          return [actionObj];
        }
      });

      const result = await this.client.bulk({ body });
      return result.body;
    } catch (error) {
      throw new Error(`Bulk operation failed: ${error.message}`);
    }
  }

  /**
   * Index note dengan full-text dan semantic search support
   */
  async indexNote(note) {
    return await this.index('notes', {
      id: note.id,
      user_id: note.userId,
      title: note.title,
      content: note.content,
      summary: note.summary || '',
      tags: note.tags || [],
      category: note.category || 'general',
      priority: note.priority || 0,
      embedding: note.embedding || null,
      created_at: note.createdAt,
      updated_at: note.updatedAt,
      metadata: note.metadata || {}
    }, note.id);
  }

  /**
   * Search notes dengan berbagai kriteria
   */
  async searchNotes(userId, searchCriteria, options = {}) {
    let query;

    if (searchCriteria.text) {
      // Full-text search
      query = {
        bool: {
          must: [
            { term: { user_id: userId } },
            {
              multi_match: {
                query: searchCriteria.text,
                fields: ['title^2', 'content', 'summary'],
                type: 'best_fields',
                fuzziness: 'AUTO'
              }
            }
          ]
        }
      };
    } else if (searchCriteria.embedding) {
      // Semantic search
      query = {
        bool: {
          must: [
            { term: { user_id: userId } },
            {
              script_score: {
                query: { match_all: {} },
                script: {
                  source: "cosineSimilarity(params.query_vector, 'embedding') + 1.0",
                  params: {
                    query_vector: searchCriteria.embedding
                  }
                }
              }
            }
          ]
        }
      };
    } else {
      // Filter-based search
      const filters = [{ term: { user_id: userId } }];

      if (searchCriteria.tags) {
        filters.push({ terms: { tags: searchCriteria.tags } });
      }

      if (searchCriteria.category) {
        filters.push({ term: { category: searchCriteria.category } });
      }

      if (searchCriteria.dateRange) {
        filters.push({
          range: {
            created_at: {
              gte: searchCriteria.dateRange.from,
              lte: searchCriteria.dateRange.to
            }
          }
        });
      }

      query = { bool: { must: filters } };
    }

    return await this.search('notes', query, {
      ...options,
      highlight: {
        fields: {
          title: {},
          content: { fragment_size: 150 }
        }
      }
    });
  }

  /**
   * Log event ke Elasticsearch
   */
  async log(level, message, metadata = {}) {
    return await this.index('logs', {
      timestamp: new Date().toISOString(),
      level,
      message,
      source: 'mcp-server',
      ...metadata
    });
  }

  /**
   * Get statistics
   */
  async getStatistics() {
    try {
      const [clusterHealth, indices, nodes] = await Promise.all([
        this.client.cluster.health(),
        this.client.cat.indices({ index: `${this.config.index}_*`, format: 'json' }),
        this.client.nodes.info()
      ]);

      const indexStats = {};
      if (indices.body && Array.isArray(indices.body)) {
        indices.body.forEach(index => {
          const indexType = index.index.replace(`${this.config.index}_`, '');
          indexStats[indexType] = {
            documentCount: parseInt(index['docs.count']) || 0,
            storeSize: index['store.size'] || '0b',
            health: index.health
          };
        });
      }

      return {
        connected: this.isConnected,
        cluster: {
          name: clusterHealth.body.cluster_name,
          status: clusterHealth.body.status,
          nodes: clusterHealth.body.number_of_nodes,
          dataNodes: clusterHealth.body.number_of_data_nodes
        },
        indices: indexStats,
        nodeCount: Object.keys(nodes.body.nodes || {}).length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to get Elasticsearch statistics: ${error.message}`);
    }
  }

  /**
   * Backup operations
   */
  async backup(backupPath) {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const snapshotName = `mcp-backup-${timestamp}`;
      
      // Create snapshot repository jika belum ada
      try {
        await this.client.snapshot.createRepository({
          repository: 'mcp_backups',
          body: {
            type: 'fs',
            settings: {
              location: backupPath
            }
          }
        });
      } catch (error) {
        // Repository might already exist
        if (!error.message.includes('already exists')) {
          console.warn('⚠️ Repository creation warning:', error.message);
        }
      }

      // Create snapshot
      const result = await this.client.snapshot.create({
        repository: 'mcp_backups',
        snapshot: snapshotName,
        body: {
          indices: Object.values(this.indices).join(','),
          include_global_state: false
        }
      });

      return {
        success: true,
        snapshotName,
        backupPath,
        timestamp: new Date().toISOString(),
        result: result.body
      };
    } catch (error) {
      throw new Error(`Elasticsearch backup failed: ${error.message}`);
    }
  }

  /**
   * Cleanup old data
   */
  async cleanup(retentionDays = 180) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const deleteQuery = {
        query: {
          range: {
            created_at: {
              lt: cutoffDate.toISOString()
            }
          }
        }
      };

      const results = {};

      // Cleanup logs (shorter retention)
      const logCutoff = new Date();
      logCutoff.setDate(logCutoff.getDate() - 30); // 30 days for logs

      const logDeleteQuery = {
        query: {
          range: {
            timestamp: {
              lt: logCutoff.toISOString()
            }
          }
        }
      };

      results.logs = await this.client.deleteByQuery({
        index: this.indices.logs,
        body: logDeleteQuery
      });

      // Cleanup other indices
      for (const [indexType, indexName] of Object.entries(this.indices)) {
        if (indexType === 'logs') continue; // Already handled
        
        try {
          results[indexType] = await this.client.deleteByQuery({
            index: indexName,
            body: deleteQuery
          });
        } catch (error) {
          console.error(`❌ Failed to cleanup ${indexType}:`, error);
          results[indexType] = { error: error.message };
        }
      }

      return {
        success: true,
        cleanupDate: cutoffDate.toISOString(),
        results
      };
    } catch (error) {
      throw new Error(`Cleanup failed: ${error.message}`);
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      if (this.client) {
        await this.client.close();
        this.isConnected = false;
        console.log('🔌 Elasticsearch connection closed');
      }
    } catch (error) {
      console.error('❌ Error closing Elasticsearch connection:', error);
      throw error;
    }
  }
}