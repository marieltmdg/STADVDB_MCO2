
require('dotenv').config();
const mysql = require('mysql2/promise');
const RecoveryLog = require('./recoveryLog.js');
const { pools } = require('../dbPools');


const Movie = {
  async getAll(limit = 50) {
    try {
      // Try node1 first
      const [rows] = await pools.node1.query('SELECT * FROM title_basics LIMIT ?', [limit]);
      return rows;
    } catch (err) {
      // If node1 is unavailable, fallback to node2 and node3
      const [rows2] = await pools.node2.query('SELECT * FROM title_basics LIMIT ?', [limit]);
      const [rows3] = await pools.node3.query('SELECT * FROM title_basics LIMIT ?', [limit]);
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
      // Try node1 first
      const [rows] = await pools.node1.query('SELECT * FROM title_basics WHERE id = ?', [id]);
      return rows[0] || null;
    } catch (err) {
      // If node1 is unavailable, fallback to node2 and node3
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
  async create(data) {
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
    let transactionId;

    try {
      // Log the operation before applying
      transactionId = await RecoveryLog.logOperation('INSERT', null, null, data);

      // Try node1 first
      const [result1] = await pools.node1.query(
        'INSERT INTO title_basics (titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
      );
      id = result1.insertId;

      // Insert into node2 or node3 based on even/odd
      const targetPool = id % 2 === 0 ? pools.node2 : pools.node3;
      try {
        await targetPool.query(
          'INSERT INTO title_basics (id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
        );
      } catch (e) {
        // If node1 is offline, get next autoincrement from node2 (even) or node3 (odd)
        // Try node2 first (even)
        const [auto2] = await pools.node2.query("SHOW TABLE STATUS LIKE 'title_basics'");
        const nextId2 = auto2[0].Auto_increment;
        // Try node3 (odd)
        const [auto3] = await pools.node3.query("SHOW TABLE STATUS LIKE 'title_basics'");
        const nextId3 = auto3[0].Auto_increment;
        // Pick the lower one to avoid gaps, but ensure even/odd
        if (nextId2 % 2 === 0) {
          id = nextId2;
          await pools.node2.query(
            'INSERT INTO title_basics (id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
          );
        } else {
          id = nextId3;
          await pools.node3.query(
            'INSERT INTO title_basics (id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
          );
        }
        // Optionally, try to insert into both if possible
      }

      // Update recovery log as applied locally
      await RecoveryLog.updateLocalStatus(transactionId, 'APPLIED', { id, ...data });
      return { id, ...data };

    } catch (err) {
      console.error('Create operation failed:', err.message);
      if (transactionId) await RecoveryLog.updateReplicationStatus(transactionId, 'FAILED');
      throw err;
    }
  },

  async update(id, data) {
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

    let transactionId;

    try {
      // Get current state
      const before = await this.getById(id);

      // Log the operation
      transactionId = await RecoveryLog.logOperation('UPDATE', id, before, data);

      // Update node1
      await pools.node1.query(
        'UPDATE title_basics SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE id = ?',
        [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres, id]
      );

      // Update secondary node
      const targetPool = id % 2 === 0 ? pools.node2 : pools.node3;
      try {
        await targetPool.query(
          'UPDATE title_basics SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE id = ?',
          [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres, id]
        );
      } catch (e) {
        console.warn(`Replication update failed for id=${id}`);
      }

      await RecoveryLog.updateLocalStatus(transactionId, 'APPLIED', data);
      return { id, ...data };

    } catch (err) {
      console.error('Update operation failed:', err.message);
      if (transactionId) await RecoveryLog.updateReplicationStatus(transactionId, 'FAILED');
      throw err;
    }
  },

  async delete(id) {
    let transactionId;

    try {
      // Get current state before deletion
      const before = await this.getById(id);

      // Log delete operation
      transactionId = await RecoveryLog.logOperation('DELETE', id, before, null);

      // Delete from node1
      await pools.node1.query('DELETE FROM title_basics WHERE id = ?', [id]);

      // Delete from secondary node
      const targetPool = id % 2 === 0 ? pools.node2 : pools.node3;
      try {
        await targetPool.query('DELETE FROM title_basics WHERE id = ?', [id]);
      } catch (e) {
        console.warn(`Replication delete failed for id=${id}`);
      }

      await RecoveryLog.updateLocalStatus(transactionId, 'APPLIED');
      return { id };

    } catch (err) {
      console.error('Delete operation failed:', err.message);
      if (transactionId) await RecoveryLog.updateReplicationStatus(transactionId, 'FAILED');
      throw err;
    }
  },


  async getByParameters(params) {
    let query = 'SELECT * FROM title_basics WHERE 1=1';
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
      return unique;
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
