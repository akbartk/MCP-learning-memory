/**
 * ScyllaDB Client - ScyllaDB Database Interface
 * 
 * Client untuk ScyllaDB database operations
 * Mendukung high-performance NoSQL operations dengan Cassandra compatibility
 * 
 * @author MCP Server Team
 * @version 1.0.0
 */

import { Client } from 'cassandra-driver';

export default class ScyllaClient {
  constructor(config = {}) {
    this.config = {
      contactPoints: config.contactPoints || (process.env.SCYLLA_CONTACT_POINTS || 'localhost').split(','),
      localDataCenter: config.localDataCenter || process.env.SCYLLA_LOCAL_DC || 'datacenter1',
      keyspace: config.keyspace || process.env.SCYLLA_KEYSPACE || 'mcp_server',
      username: config.username || process.env.SCYLLA_USERNAME || null,
      password: config.password || process.env.SCYLLA_PASSWORD || null,
      port: config.port || parseInt(process.env.SCYLLA_PORT) || 9042,
      protocolOptions: {
        port: config.port || parseInt(process.env.SCYLLA_PORT) || 9042
      },
      pooling: {
        heartBeatInterval: 30000,
        idleTimeout: 120000
      },
      socketOptions: {
        connectTimeout: 5000,
        readTimeout: 12000
      },
      ...config
    };

    this.client = null;
    this.isConnected = false;
    this.prepared = new Map(); // Cache untuk prepared statements
  }

  /**
   * Connect ke ScyllaDB cluster
   */
  async connect() {
    try {
      const clientOptions = {
        contactPoints: this.config.contactPoints,
        localDataCenter: this.config.localDataCenter,
        protocolOptions: this.config.protocolOptions,
        pooling: {
          ...this.config.pooling,
          heartBeatInterval: 30000,
          idleTimeout: 120000,
          coreConnectionsPerHost: {
            local: 2,
            remote: 1
          }
        },
        socketOptions: {
          ...this.config.socketOptions,
          connectTimeout: 10000,
          readTimeout: 12000
        },
        policies: {
          reconnection: {
            baseDelay: 1000,
            maxDelay: 10 * 60 * 1000
          }
        }
      };

      // Add authentication jika ada
      if (this.config.username && this.config.password) {
        clientOptions.authProvider = new Client.auth.PlainTextAuthProvider(
          this.config.username,
          this.config.password
        );
      }

      this.client = new Client(clientOptions);

      // Event listeners
      this.client.on('hostAdd', (host) => {
        console.log(`➕ ScyllaDB host added: ${host.address}`);
      });

      this.client.on('hostRemove', (host) => {
        console.log(`➖ ScyllaDB host removed: ${host.address}`);
      });

      this.client.on('hostUp', (host) => {
        console.log(`🟢 ScyllaDB host up: ${host.address}`);
      });

      this.client.on('hostDown', (host) => {
        console.log(`🔴 ScyllaDB host down: ${host.address}`);
      });

      // Connect to cluster dengan timeout
      const connectTimeout = setTimeout(() => {
        throw new Error('ScyllaDB connection timeout after 30 seconds');
      }, 30000);

      await this.client.connect();
      clearTimeout(connectTimeout);

      console.log(`✅ Connected to ScyllaDB cluster: ${this.config.contactPoints.join(', ')}`);

      // Initialize keyspace dan tables dengan retry
      let retries = 3;
      while (retries > 0) {
        try {
          await this.initializeSchema();
          break;
        } catch (schemaError) {
          console.warn(`⚠️ Schema initialization attempt ${4 - retries} failed:`, schemaError.message);
          retries--;
          if (retries === 0) {
            console.error('❌ Failed to initialize schema after 3 attempts');
            // Don't throw, continue with connection
          } else {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to ScyllaDB:', error.message);
      this.isConnected = false;
      // Don't throw, return false untuk graceful degradation
      return false;
    }
  }

  /**
   * Initialize database schema
   */
  async initializeSchema() {
    try {
      // Create keyspace jika belum ada
      await this.execute(`
        CREATE KEYSPACE IF NOT EXISTS ${this.config.keyspace}
        WITH REPLICATION = {
          'class': 'SimpleStrategy',
          'replication_factor': 3
        }
      `);

      // Use keyspace
      await this.execute(`USE ${this.config.keyspace}`);

      // Create basic tables
      await this.createTables();

      console.log(`✅ ScyllaDB schema initialized for keyspace: ${this.config.keyspace}`);
    } catch (error) {
      console.error('❌ Failed to initialize ScyllaDB schema:', error);
      throw error;
    }
  }

  /**
   * Create necessary tables
   */
  async createTables() {
    const tables = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username TEXT,
        email TEXT,
        password_hash TEXT,
        roles SET<TEXT>,
        permissions SET<TEXT>,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        last_login TIMESTAMP,
        metadata MAP<TEXT, TEXT>
      )`,

      // Sessions table
      `CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        user_id UUID,
        token_hash TEXT,
        expires_at TIMESTAMP,
        created_at TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT
      )`,

      // Notes table
      `CREATE TABLE IF NOT EXISTS notes (
        id UUID PRIMARY KEY,
        user_id UUID,
        title TEXT,
        content TEXT,
        summary TEXT,
        tags SET<TEXT>,
        category TEXT,
        priority INT,
        embedding VECTOR<FLOAT, 1536>,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        archived_at TIMESTAMP,
        metadata MAP<TEXT, TEXT>
      )`,

      // Learning sessions table
      `CREATE TABLE IF NOT EXISTS learning_sessions (
        id UUID PRIMARY KEY,
        user_id UUID,
        title TEXT,
        description TEXT,
        notes LIST<UUID>,
        tags SET<TEXT>,
        status TEXT,
        progress FLOAT,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        metadata MAP<TEXT, TEXT>
      )`,

      // Backups table
      `CREATE TABLE IF NOT EXISTS backups (
        id UUID PRIMARY KEY,
        user_id UUID,
        backup_type TEXT,
        filename TEXT,
        file_size BIGINT,
        compression_type TEXT,
        created_at TIMESTAMP,
        expires_at TIMESTAMP,
        status TEXT,
        metadata MAP<TEXT, TEXT>
      )`
    ];

    for (const table of tables) {
      await this.execute(table);
    }

    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS ON users (email)',
      'CREATE INDEX IF NOT EXISTS ON users (username)',
      'CREATE INDEX IF NOT EXISTS ON sessions (user_id)',
      'CREATE INDEX IF NOT EXISTS ON notes (user_id)',
      'CREATE INDEX IF NOT EXISTS ON notes (category)',
      'CREATE INDEX IF NOT EXISTS ON learning_sessions (user_id)',
      'CREATE INDEX IF NOT EXISTS ON backups (user_id)'
    ];

    for (const index of indexes) {
      try {
        await this.execute(index);
      } catch (error) {
        // Index might already exist, ignore error
        if (!error.message.includes('already exists')) {
          console.warn('⚠️ Index creation warning:', error.message);
        }
      }
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      if (!this.client || !this.isConnected) return false;
      
      const result = await this.execute('SELECT now() FROM system.local');
      return result && result.rows.length > 0;
    } catch (error) {
      console.error('❌ ScyllaDB health check failed:', error);
      return false;
    }
  }

  /**
   * Execute CQL query
   */
  async execute(query, params = [], options = {}) {
    try {
      if (!this.isConnected) {
        throw new Error('Not connected to ScyllaDB');
      }

      const result = await this.client.execute(query, params, options);
      return result;
    } catch (error) {
      console.error('❌ ScyllaDB query failed:', error);
      throw new Error(`ScyllaDB query failed: ${error.message}`);
    }
  }

  /**
   * Prepare dan cache statement
   */
  async prepare(query) {
    try {
      if (this.prepared.has(query)) {
        return this.prepared.get(query);
      }

      const prepared = await this.client.prepare(query);
      this.prepared.set(query, prepared);
      return prepared;
    } catch (error) {
      throw new Error(`Failed to prepare statement: ${error.message}`);
    }
  }

  /**
   * Execute prepared statement
   */
  async executePrepared(query, params = [], options = {}) {
    try {
      const prepared = await this.prepare(query);
      return await this.client.execute(prepared, params, options);
    } catch (error) {
      throw new Error(`Failed to execute prepared statement: ${error.message}`);
    }
  }

  /**
   * Batch operations
   */
  async batch(queries, options = {}) {
    try {
      const batchQueries = queries.map(q => ({
        query: q.query,
        params: q.params || []
      }));

      return await this.client.batch(batchQueries, options);
    } catch (error) {
      throw new Error(`Batch operation failed: ${error.message}`);
    }
  }

  /**
   * User operations
   */
  async createUser(userData) {
    const query = `
      INSERT INTO users (id, username, email, password_hash, roles, permissions, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      userData.id,
      userData.username,
      userData.email,
      userData.passwordHash,
      userData.roles || [],
      userData.permissions || [],
      new Date(),
      new Date(),
      userData.metadata || {}
    ];

    return await this.executePrepared(query, params);
  }

  async getUserById(userId) {
    const query = 'SELECT * FROM users WHERE id = ?';
    const result = await this.executePrepared(query, [userId]);
    return result.rows[0] || null;
  }

  async getUserByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = ? ALLOW FILTERING';
    const result = await this.executePrepared(query, [email]);
    return result.rows[0] || null;
  }

  async updateUser(userId, updates) {
    const updateFields = [];
    const params = [];

    Object.entries(updates).forEach(([key, value]) => {
      updateFields.push(`${key} = ?`);
      params.push(value);
    });

    updateFields.push('updated_at = ?');
    params.push(new Date());
    params.push(userId);

    const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
    return await this.executePrepared(query, params);
  }

  /**
   * Notes operations
   */
  async createNote(noteData) {
    const query = `
      INSERT INTO notes (id, user_id, title, content, summary, tags, category, priority, embedding, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      noteData.id,
      noteData.userId,
      noteData.title,
      noteData.content,
      noteData.summary || '',
      noteData.tags || [],
      noteData.category || 'general',
      noteData.priority || 0,
      noteData.embedding || null,
      new Date(),
      new Date(),
      noteData.metadata || {}
    ];

    return await this.executePrepared(query, params);
  }

  async getNotesByUser(userId, limit = 100) {
    const query = 'SELECT * FROM notes WHERE user_id = ? LIMIT ?';
    const result = await this.executePrepared(query, [userId, limit]);
    return result.rows;
  }

  async getNoteById(noteId) {
    const query = 'SELECT * FROM notes WHERE id = ?';
    const result = await this.executePrepared(query, [noteId]);
    return result.rows[0] || null;
  }

  async updateNote(noteId, updates) {
    const updateFields = [];
    const params = [];

    Object.entries(updates).forEach(([key, value]) => {
      updateFields.push(`${key} = ?`);
      params.push(value);
    });

    updateFields.push('updated_at = ?');
    params.push(new Date());
    params.push(noteId);

    const query = `UPDATE notes SET ${updateFields.join(', ')} WHERE id = ?`;
    return await this.executePrepared(query, params);
  }

  async deleteNote(noteId) {
    const query = 'DELETE FROM notes WHERE id = ?';
    return await this.executePrepared(query, [noteId]);
  }

  /**
   * Session operations
   */
  async createSession(sessionData) {
    const query = `
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      sessionData.id,
      sessionData.userId,
      sessionData.tokenHash,
      sessionData.expiresAt,
      new Date(),
      sessionData.ipAddress,
      sessionData.userAgent
    ];

    return await this.executePrepared(query, params);
  }

  async getSessionById(sessionId) {
    const query = 'SELECT * FROM sessions WHERE id = ?';
    const result = await this.executePrepared(query, [sessionId]);
    return result.rows[0] || null;
  }

  async deleteSession(sessionId) {
    const query = 'DELETE FROM sessions WHERE id = ?';
    return await this.executePrepared(query, [sessionId]);
  }

  async deleteExpiredSessions() {
    const query = 'DELETE FROM sessions WHERE expires_at < ? ALLOW FILTERING';
    return await this.executePrepared(query, [new Date()]);
  }

  /**
   * Get statistics
   */
  async getStatistics() {
    try {
      const [systemInfo, userCount, noteCount, sessionCount] = await Promise.all([
        this.execute('SELECT * FROM system.local'),
        this.execute(`SELECT COUNT(*) as count FROM ${this.config.keyspace}.users`),
        this.execute(`SELECT COUNT(*) as count FROM ${this.config.keyspace}.notes`),
        this.execute(`SELECT COUNT(*) as count FROM ${this.config.keyspace}.sessions`)
      ]);

      const system = systemInfo.rows[0];

      return {
        connected: this.isConnected,
        cluster: system.cluster_name,
        datacenter: system.data_center,
        version: system.release_version,
        keyspace: this.config.keyspace,
        tables: {
          users: userCount.rows[0].count.low,
          notes: noteCount.rows[0].count.low,
          sessions: sessionCount.rows[0].count.low
        },
        hosts: this.client.getState().getConnectedHosts().length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to get ScyllaDB statistics: ${error.message}`);
    }
  }

  /**
   * Backup operations
   */
  async backup(backupPath) {
    try {
      // ScyllaDB backup biasanya menggunakan nodetool snapshot
      // Karena kita tidak bisa execute system commands dari Node.js,
      // kita return info untuk manual backup atau implementation dengan child_process

      return {
        success: true,
        backupPath,
        timestamp: new Date().toISOString(),
        method: 'manual',
        instructions: [
          'Execute on ScyllaDB nodes:',
          `nodetool snapshot ${this.config.keyspace}`,
          `Find snapshots in: /var/lib/scylla/data/${this.config.keyspace}/*/snapshots/`
        ]
      };
    } catch (error) {
      throw new Error(`ScyllaDB backup preparation failed: ${error.message}`);
    }
  }

  /**
   * Cleanup operations
   */
  async cleanup() {
    try {
      // Delete expired sessions
      await this.deleteExpiredSessions();
      
      // Archive old notes (older than 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      const query = `
        UPDATE notes 
        SET archived_at = ? 
        WHERE created_at < ? AND archived_at = null
        ALLOW FILTERING
      `;
      
      await this.executePrepared(query, [new Date(), sixMonthsAgo]);
      
      return { success: true, cleanupDate: new Date().toISOString() };
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
        await this.client.shutdown();
        this.isConnected = false;
        this.prepared.clear();
        console.log('🔌 ScyllaDB connection closed');
      }
    } catch (error) {
      console.error('❌ Error closing ScyllaDB connection:', error);
      throw error;
    }
  }
}