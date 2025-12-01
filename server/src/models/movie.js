
require('dotenv').config();
const mysql = require('mysql2/promise');
const RecoveryLog = require('./recoveryLog.js');
const { replicateOperation, resolvePendingLog } = require('../replication');
const { pools } = require('../dbPools');

const resolveAllPendingLogs = async () => {
  const nodes = ['node1', 'node2', 'node3'];
  for (const node of nodes) {
    try {
      await RecoveryLog.resolvePendingLogs(node, resolvePendingLog);
    } catch (err) {
      console.warn(`[MOVIE] Could not resolve pending logs for ${node}:`, err.message);
    }
  }
};

const Movie = {
  async getAll(limit = 50, offset = 0) {
    try {
      const [rows] = await pools.node1.query('SELECT * FROM title_basics LIMIT ? OFFSET ?', [limit, offset]);
      return rows;
    } catch (err) {
      const [rows2] = await pools.node2.query('SELECT * FROM title_basics LIMIT ? OFFSET ?', [limit, offset]);
      const [rows3] = await pools.node3.query('SELECT * FROM title_basics LIMIT ? OFFSET ?', [limit, offset]);
      const merged = [...rows2, ...rows3];
      const unique = Object.values(merged.reduce((acc, curr) => {
        acc[curr.id] = curr;
        return acc;
      }, {}));
      return unique.slice(0, limit);
    }
  },

  async getById(id) {
    try {
      const [rows] = await pools.node1.query('SELECT * FROM title_basics WHERE id = ?', [id]);
      return rows[0] || null;
    } catch (err) {
      const [rows2] = await pools.node2.query('SELECT * FROM title_basics WHERE id = ?', [id]);
      const [rows3] = await pools.node3.query('SELECT * FROM title_basics WHERE id = ?', [id]);
      const merged = [...rows2, ...rows3];
      const unique = Object.values(merged.reduce((acc, curr) => {
        acc[curr.id] = curr;
        return acc;
      }, {}));
      return unique[0] || null;
    }
  },

  async getCount() {
    try {
      const [rows] = await pools.node1.query('SELECT COUNT(*) as count FROM title_basics');
      return rows[0].count;
    } catch (err) {
      try {
        const [rows2] = await pools.node2.query('SELECT COUNT(*) as count FROM title_basics');
        const [rows3] = await pools.node3.query('SELECT COUNT(*) as count FROM title_basics');
        return rows2[0].count + rows3[0].count;
      } catch (fallbackErr) {
        console.error('All nodes unavailable for count:', fallbackErr);
        return 0;
      }
    }
  },

  async create(poolId, data) {
    const {
      titleType,
      primaryTitle,
      originalTitle,
      isAdult,
      startYear,
      endYear,
      runtimeMinutes,
      genres
    } = data;

    let id;
    let logId;
    let actualPoolId = poolId;

    try {
      try {
        const [result] = await pools.node1.query(
          'INSERT INTO title_basics (titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
        );
        id = result.insertId;
        actualPoolId = 'node1';
        console.log(`[MOVIE] Created record id=${id} on node1`);

      } catch (node1Err) {
        console.warn(`[MOVIE] Node1 unavailable for INSERT, delegating to node2/node3:`, node1Err.message);
        
        // Node1 is down, delegate to node2 or node3
        // Try to get next auto_increment from both nodes and pick appropriate one
        let targetPool;
        let targetPoolId;
        
        try {
          const [auto2] = await pools.node2.query("SHOW TABLE STATUS LIKE 'title_basics'");
          const nextId2 = auto2[0].Auto_increment;
          
          const [auto3] = await pools.node3.query("SHOW TABLE STATUS LIKE 'title_basics'");
          const nextId3 = auto3[0].Auto_increment;
          
          // Pick the node with lower auto_increment to avoid gaps
          if (nextId2 <= nextId3) {
            id = nextId2;
            targetPool = pools.node2;
            targetPoolId = 'node2';
          } else {
            id = nextId3;
            targetPool = pools.node3;
            targetPoolId = 'node3';
          }
          
          // Insert with explicit ID
          await targetPool.query(
            'INSERT INTO title_basics (id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
          );
          
          actualPoolId = targetPoolId;
          console.log(`[MOVIE] Created record id=${id} on ${targetPoolId} (node1 unavailable)`);
          
        } catch (delegateErr) {
          console.error(`[MOVIE] Failed to delegate INSERT to node2/node3:`, delegateErr.message);
          throw new Error('All database nodes unavailable for INSERT operation');
        }
      }

      const recordData = { id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres };

      // Replicate to appropriate node
      try {
        await replicateOperation(actualPoolId, null, 'INSERT', id, recordData, null);
        console.log(`[MOVIE] Replication succeeded for INSERT id=${id}`);
      } catch (replicationErr) {
        console.warn(`[MOVIE] Replication failed for INSERT id=${id}, logged for recovery`);
        // Recovery log is automatically created by replicateOperation when it fails
      }

      // Check and resolve any pending logs across all nodes
      await resolveAllPendingLogs();

      return recordData;

    } catch (err) {
      console.error('[MOVIE] Create operation failed:', err.message);
      throw err;
    }
  },

  // Updates a movie - same priority as create (node1 first, then fallback)
  async update(poolId, id, data) {
    const {
      titleType,
      primaryTitle,
      originalTitle,
      isAdult,
      startYear,
      endYear,
      runtimeMinutes,
      genres
    } = data;

    let logId;
    let actualPoolId = poolId;

    try {
      // Get current state before update
      const before = await this.getById(id);
      if (!before) {
        throw new Error(`Movie with id=${id} not found`);
      }

      // Try node1 first
      try {
        await pools.node1.query(
          'UPDATE title_basics SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE id = ?',
          [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres, id]
        );
        actualPoolId = 'node1';
        console.log(`[MOVIE] Updated record id=${id} on node1`);

      } catch (node1Err) {
        console.warn(`[MOVIE] Node1 unavailable for UPDATE, delegating to node2/node3:`, node1Err.message);
        
        // Node1 is down, delegate to node2 (even) or node3 (odd)
        const isEven = parseInt(id) % 2 === 0;
        const targetPoolId = isEven ? 'node2' : 'node3';
        const targetPool = pools[targetPoolId];
        
        try {
          await targetPool.query(
            'UPDATE title_basics SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE id = ?',
            [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres, id]
          );
          actualPoolId = targetPoolId;
          console.log(`[MOVIE] Updated record id=${id} on ${targetPoolId} (node1 unavailable)`);
          
        } catch (delegateErr) {
          console.error(`[MOVIE] Failed to delegate UPDATE to ${targetPoolId}:`, delegateErr.message);
          throw new Error(`Database node ${targetPoolId} unavailable for UPDATE operation`);
        }
      }

      const recordData = { titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres };

      // Replicate to appropriate node
      try {
        await replicateOperation(actualPoolId, null, 'UPDATE', id, recordData, before);
        console.log(`[MOVIE] Replication succeeded for UPDATE id=${id}`);
      } catch (replicationErr) {
        console.warn(`[MOVIE] Replication failed for UPDATE id=${id}, logged for recovery`);
        // Recovery log is automatically created by replicateOperation when it fails
      }

      // Check and resolve any pending logs across all nodes
      await resolveAllPendingLogs();

      return { id, ...recordData };

    } catch (err) {
      console.error('[MOVIE] Update operation failed:', err.message);
      throw err;
    }
  },

  // Deletes a movie - you guessed it, node1 first with fallback
  async delete(poolId, id) {
    let logId;
    let actualPoolId = poolId;

    try {
      // Get current state before deletion
      const before = await this.getById(id);
      if (!before) {
        throw new Error(`Movie with id=${id} not found`);
      }

      // Try node1 first
      try {
        await pools.node1.query('DELETE FROM title_basics WHERE id = ?', [id]);
        actualPoolId = 'node1';
        console.log(`[MOVIE] Deleted record id=${id} from node1`);

      } catch (node1Err) {
        console.warn(`[MOVIE] Node1 unavailable for DELETE, delegating to node2/node3:`, node1Err.message);
        
        // Node1 is down, delegate to node2 (even) or node3 (odd)
        const isEven = parseInt(id) % 2 === 0;
        const targetPoolId = isEven ? 'node2' : 'node3';
        const targetPool = pools[targetPoolId];
        
        try {
          await targetPool.query('DELETE FROM title_basics WHERE id = ?', [id]);
          actualPoolId = targetPoolId;
          console.log(`[MOVIE] Deleted record id=${id} from ${targetPoolId} (node1 unavailable)`);
          
        } catch (delegateErr) {
          console.error(`[MOVIE] Failed to delegate DELETE to ${targetPoolId}:`, delegateErr.message);
          throw new Error(`Database node ${targetPoolId} unavailable for DELETE operation`);
        }
      }

      // Replicate to appropriate node
      try {
        await replicateOperation(actualPoolId, null, 'DELETE', id, before, before);
        console.log(`[MOVIE] Replication succeeded for DELETE id=${id}`);
      } catch (replicationErr) {
        console.warn(`[MOVIE] Replication failed for DELETE id=${id}, logged for recovery`);
        // Recovery log is automatically created by replicateOperation when it fails
      }

      // Check and resolve any pending logs across all nodes
      await resolveAllPendingLogs();

      return { id };

    } catch (err) {
      console.error('[MOVIE] Delete operation failed:', err.message);
      throw err;
    }
  },

  async getByParameters(params, limit = null, offset = 0) {
    let query = 'SELECT * FROM title_basics WHERE 1=1';
    const values = [];
    console.log('[DEBUG] Movie.getByParameters called with params:', params);
    
    if (params.primaryTitle) {
      query += ' AND primaryTitle LIKE ?';
      values.push(`%${params.primaryTitle}%`);
    }
    if (params.startYear) {
      query += ' AND startYear = ?';
      values.push(params.startYear);
    }
    if (params.genres) {
      query += ' AND genres LIKE ?';
      values.push(`%${params.genres}%`);
    }
    if (params.titleType) {
      query += ' AND titleType = ?';
      values.push(params.titleType);
    }
    
    console.log('[DEBUG] Generated query:', query);
    console.log('[DEBUG] Query values:', values);
    
    // Add pagination if limit is specified
    if (limit) {
      query += ' LIMIT ? OFFSET ?';
      values.push(limit, offset);
    }
    
    try {
      // Try node1 first
      const [rows] = await pools.node1.query(query, values);
      return rows;
    } catch (err) {
      // If node1 is unavailable, fallback to node2 and node3
      const [rows2] = await pools.node2.query(query, values);
      const [rows3] = await pools.node3.query(query, values);
      const merged = [...rows2, ...rows3];
      const unique = Object.values(merged.reduce((acc, curr) => {
        acc[curr.id] = curr;
        return acc;
      }, {}));
      return limit ? unique.slice(offset, offset + limit) : unique;
    }
  },

  async getCountByParameters(params) {
    let query = 'SELECT COUNT(*) as count FROM title_basics WHERE 1=1';
    const values = [];
    if (params.primaryTitle) {
      query += ' AND primaryTitle LIKE ?';
      values.push(`%${params.primaryTitle}%`);
    }
    if (params.startYear) {
      query += ' AND startYear = ?';
      values.push(params.startYear);
    }
    if (params.genres) {
      query += ' AND genres LIKE ?';
      values.push(`%${params.genres}%`);
    }
    if (params.titleType) {
      query += ' AND titleType = ?';
      values.push(params.titleType);
    }
    
    try {
      // Try node1 first
      const [rows] = await pools.node1.query(query, values);
      return rows[0].count;
    } catch (err) {
      // If node1 is unavailable, fallback to node2 and node3
      try {
        const [rows2] = await pools.node2.query(query, values);
        const [rows3] = await pools.node3.query(query, values);
        return rows2[0].count + rows3[0].count;
      } catch (fallbackErr) {
        console.error('All nodes unavailable for search count:', fallbackErr);
        return 0;
      }
    }
  },

  // Reports functionality
  async getGenreReport() {
    try {
      const [rows] = await pools.node1.query(`
        SELECT 
          TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(genres, ',', numbers.n), ',', -1)) as genre,
          COUNT(*) as count
        FROM title_basics
        JOIN (
          SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
          UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10
        ) numbers
        ON CHAR_LENGTH(genres) - CHAR_LENGTH(REPLACE(genres, ',', '')) >= numbers.n - 1
        WHERE genres IS NOT NULL AND genres != ''
        GROUP BY genre
        ORDER BY count DESC
        LIMIT 20
      `);
      return rows;
    } catch (err) {
      console.error('Error generating genre report:', err);
      return [];
    }
  },

  async getYearReport() {
    try {
      const [rows] = await pools.node1.query(`
        SELECT 
          startYear as year,
          COUNT(*) as count
        FROM title_basics 
        WHERE startYear IS NOT NULL AND startYear BETWEEN 1900 AND 2030
        GROUP BY startYear
        ORDER BY startYear DESC
        LIMIT 50
      `);
      return rows;
    } catch (err) {
      console.error('Error generating year report:', err);
      return [];
    }
  },

  async getTypeReport() {
    try {
      const [rows] = await pools.node1.query(`
        SELECT 
          titleType as type,
          COUNT(*) as count,
          ROUND(AVG(runtimeMinutes), 1) as avg_runtime
        FROM title_basics 
        WHERE titleType IS NOT NULL
        GROUP BY titleType
        ORDER BY count DESC
      `);
      return rows;
    } catch (err) {
      console.error('Error generating type report:', err);
      return [];
    }
  },

  async getRuntimeReport() {
    try {
      const [rows] = await pools.node1.query(`
        SELECT 
          CASE 
            WHEN runtimeMinutes < 30 THEN 'Short (< 30 min)'
            WHEN runtimeMinutes BETWEEN 30 AND 90 THEN 'Standard (30-90 min)'
            WHEN runtimeMinutes BETWEEN 91 AND 180 THEN 'Long (91-180 min)'
            WHEN runtimeMinutes > 180 THEN 'Very Long (> 180 min)'
            ELSE 'Unknown'
          END as runtime_category,
          COUNT(*) as count,
          MIN(runtimeMinutes) as min_runtime,
          MAX(runtimeMinutes) as max_runtime,
          ROUND(AVG(runtimeMinutes), 1) as avg_runtime
        FROM title_basics 
        WHERE runtimeMinutes IS NOT NULL
        GROUP BY runtime_category
        ORDER BY avg_runtime ASC
      `);
      return rows;
    } catch (err) {
      console.error('Error generating runtime report:', err);
      return [];
    }
  },

  async cleanup() {
    await Promise.all([
      pools.node1.end(),
      pools.node2.end(),
      pools.node3.end()
    ]);
  }
};

module.exports = Movie;
