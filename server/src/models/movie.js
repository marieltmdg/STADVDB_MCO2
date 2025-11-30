
require('dotenv').config();
const mysql = require('mysql2/promise');

// Node configs from .env
const nodeConfigs = {
  node1: {
    host: process.env.DB_NODE1_IP,
    user: process.env.DB_USER,
    password: process.env.DB_USER_PASSWORD,
    database: process.env.DB0_NAME,
    port: 3306
  },
  node2: {
    host: process.env.DB_NODE2_IP,
    user: process.env.DB_USER,
    password: process.env.DB_USER_PASSWORD,
    database: process.env.DB1_NAME,
    port: 3306
  },
  node3: {
    host: process.env.DB_NODE3_IP,
    user: process.env.DB_USER,
    password: process.env.DB_USER_PASSWORD,
    database: process.env.DB2_NAME,
    port:3306
  }
};

// Pools for each node
const pools = {
  node1: mysql.createPool(nodeConfigs.node1),
  node2: mysql.createPool(nodeConfigs.node2),
  node3: mysql.createPool(nodeConfigs.node3)
};


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
    try {
      // Try node1 first
      const [result1] = await pools.node1.query(
        'INSERT INTO title_basics (titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
      );
      id = result1.insertId;
    } catch (err) {
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
    // Insert into node2 if even, node3 if odd (if not already inserted above)
    if (id % 2 === 0) {
      try {
        await pools.node2.query(
          'INSERT INTO title_basics (id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
        );
      } catch (e) {}
    } else {
      try {
        await pools.node3.query(
          'INSERT INTO title_basics (id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
        );
      } catch (e) {}
    }
    return { id, ...data };
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
    // Always update node1
    await pools.node1.query(
      'UPDATE title_basics SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE id = ?',
      [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres, id]
    );
    // Update node2 if even, node3 if odd
    if (id % 2 === 0) {
      await pools.node2.query(
        'UPDATE title_basics SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE id = ?',
        [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres, id]
      );
    } else {
      await pools.node3.query(
        'UPDATE title_basics SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE id = ?',
        [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres, id]
      );
    }
    return { id, ...data };
  },
  async delete(id) {
    // Always delete from node1
    await pools.node1.query('DELETE FROM title_basics WHERE id = ?', [id]);
    // Delete from node2 if even, node3 if odd
    if (id % 2 === 0) {
      await pools.node2.query('DELETE FROM title_basics WHERE id = ?', [id]);
    } else {
      await pools.node3.query('DELETE FROM title_basics WHERE id = ?', [id]);
    }
    return { id };
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
