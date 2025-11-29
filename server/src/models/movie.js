const mysql = require('mysql2/promise');
require('dotenv').config();

// ---------------------------------------------------------------------
// CONNECTION POOLS FOR ALL THREE SERVERS
// ---------------------------------------------------------------------
const server0 = mysql.createPool({
  host: 'ccscloud.dlsu.edu.ph',
  port: 60754, // Server0 full table
  user: 'root',
  password: 'y4CUW63BZdM9Jr7QEjnGfxtR',
  database: 'movies_db',
  waitForConnections: true,
  connectionLimit: 10
});

const server1 = mysql.createPool({
  host: 'ccscloud.dlsu.edu.ph',
  port: 60755, // Server1 fragment
  user: 'root',
  password: 'y4CUW63BZdM9Jr7QEjnGfxtR',
  database: 'movies_db',
  waitForConnections: true,
  connectionLimit: 10
});

const server2 = mysql.createPool({
  host: 'ccscloud.dlsu.edu.ph',
  port: 60756, // Server2 fragment
  user: 'root',
  password: 'y4CUW63BZdM9Jr7QEjnGfxtR',
  database: 'movies_db',
  waitForConnections: true,
  connectionLimit: 10
});

// Utility: choose the fragment based on tconst mod 2
function getFragmentPool(tconst) {
  return Number(tconst.replace(/\D/g, '')) % 2 === 0 ? server1 : server2;
}

// ---------------------------------------------------------------------
// MODEL METHODS
// ---------------------------------------------------------------------

module.exports = {
  // GET ALL (use server0 because it has the full table)
  async getAll(limit = 500) {
    const [rows] = await server0.query(
      `SELECT * FROM movies LIMIT ?`,
      [limit]
    );
    return rows;
  },

  // GET BY ID — hit the correct fragment or server0
  async getById(tconst) {
    // First try the central server0
    const [central] = await server0.query(
      `SELECT * FROM movies WHERE tconst = ?`,
      [tconst]
    );

    if (central.length > 0) return central[0];

    // If not in server0 (rare), check fragments
    const fragment = getFragmentPool(tconst);
    const [rows] = await fragment.query(
      `SELECT * FROM movies WHERE tconst = ?`,
      [tconst]
    );

    return rows[0] || null;
  },

  // CREATE — Must insert into server0 AND correct fragment
  async create(data) {
    const {
      tconst, titleType, primaryTitle, originalTitle,
      isAdult, startYear, endYear, runtimeMinutes, genres
    } = data;

    const fragment = getFragmentPool(tconst);

    // Insert into server0
    await server0.query(
      `INSERT INTO movies (tconst, titleType, primaryTitle, originalTitle, 
        isAdult, startYear, endYear, runtimeMinutes, genres)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tconst, titleType, primaryTitle, originalTitle,
       isAdult, startYear, endYear, runtimeMinutes, genres]
    );

    // Insert into correct fragment (server1 or server2)
    await fragment.query(
      `INSERT INTO movies (tconst, titleType, primaryTitle, originalTitle, 
        isAdult, startYear, endYear, runtimeMinutes, genres)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tconst, titleType, primaryTitle, originalTitle,
       isAdult, startYear, endYear, runtimeMinutes, genres]
    );

    return data;
  },

  // UPDATE — must update both central and fragment
  async update(tconst, data) {
    const fragment = getFragmentPool(tconst);

    const fields = Object.keys(data)
      .map(key => `${key} = ?`)
      .join(', ');

    const values = Object.values(data);

    // Update server0
    const [result0] = await server0.query(
      `UPDATE movies SET ${fields} WHERE tconst = ?`,
      [...values, tconst]
    );

    // Update fragment
    await fragment.query(
      `UPDATE movies SET ${fields} WHERE tconst = ?`,
      [...values, tconst]
    );

    return result0.affectedRows;
  },

  // DELETE — delete from server0 and fragment
  async delete(tconst) {
    const fragment = getFragmentPool(tconst);

    const [result0] = await server0.query(
      `DELETE FROM movies WHERE tconst = ?`,
      [tconst]
    );

    await fragment.query(
      `DELETE FROM movies WHERE tconst = ?`,
      [tconst]
    );

    return result0.affectedRows;
  },

  // SEARCH — always use Server0 (has full data)
  async getByParameters(params) {
    const filters = [];
    const values = [];

    Object.entries(params).forEach(([key, value]) => {
      filters.push(`${key} LIKE ?`);
      values.push(`%${value}%`);
    });

    const whereClause = filters.length > 0
      ? `WHERE ` + filters.join(' AND ')
      : '';

    const [rows] = await server0.query(
      `SELECT * FROM movies ${whereClause} LIMIT 500`,
      values
    );

    return rows;
  }
};
