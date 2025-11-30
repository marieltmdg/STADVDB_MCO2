const mysql = require('mysql2/promise');

// Google Cloud SQL nodes
const dbConfig = {
  host: '104.199.157.218', // Node 1
  user: 'mco2-user',
  password: '7rczmyBjdyL3&Mry',
  database: 'mco_2', // Change to your actual database name
  port: 3306,
  // You can add more nodes for failover if needed
  // For simplicity, using one node here
};

const pool = mysql.createPool(dbConfig);


const Movie = {
  async getAll(limit = 50) {
    const [rows] = await pool.query('SELECT * FROM title_basics_25k LIMIT ?', [limit]);
    return rows;
  },
  async getById(tconst) {
    const [rows] = await pool.query('SELECT * FROM title_basics_25k WHERE tconst = ?', [tconst]);
    return rows[0];
  },
  async create(data) {
    const {
      tconst,
      titleType,
      primaryTitle,
      originalTitle,
      isAdult,
      startYear,
      endYear,
      runtimeMinutes,
      genres
    } = data;
    await pool.query(
      'INSERT INTO title_basics_25k (tconst, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [tconst, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres]
    );
    return { tconst, ...data };
  },
  async update(tconst, data) {
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
    await pool.query(
      'UPDATE title_basics_25k SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE tconst = ?',
      [titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres, tconst]
    );
    return { tconst, ...data };
  },
  async delete(tconst) {
    await pool.query('DELETE FROM title_basics_25k WHERE tconst = ?', [tconst]);
    return { tconst };
  },
  async getByParameters(params) {
    let query = 'SELECT * FROM title_basics_25k WHERE 1=1';
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
    const [rows] = await pool.query(query, values);
    return rows;
  },
  async cleanup() {
    await pool.end();
  }
};

module.exports = Movie;
