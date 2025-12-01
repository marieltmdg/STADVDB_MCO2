require('dotenv').config();
const mysql = require('mysql2/promise');
const { pools } = require('../dbPools');

async function begin_transaction(node, isolationLevel) {
  const conn = await pools[node].getConnection();
  // Convert isolation level to proper MySQL format
  let mysqlIsolation;
  switch(isolationLevel) {
    case 'READ_UNCOMMITTED': mysqlIsolation = 'READ UNCOMMITTED'; break;
    case 'READ_COMMITTED': mysqlIsolation = 'READ COMMITTED'; break;
    case 'REPEATABLE_READ': mysqlIsolation = 'REPEATABLE READ'; break;
    case 'SERIALIZABLE': mysqlIsolation = 'SERIALIZABLE'; break;
    default: mysqlIsolation = 'READ COMMITTED';
  }
  await conn.execute(`SET SESSION TRANSACTION ISOLATION LEVEL ${mysqlIsolation}`);
  await conn.beginTransaction();
  return conn; 
}

async function commit(conn) {
  await conn.commit();
  conn.release();
}

async function rollback(conn) {
  await conn.rollback();
  conn.release();
}

async function read(conn, id) {
  const [rows] = await conn.query('SELECT * FROM title_basics WHERE id = ?', [id]);
  return rows[0] || null;
}

// Title for now
async function write(conn, id, data) {
  await conn.query("UPDATE title_basics SET primaryTitle = ? WHERE id = ?", [data, id]);
}

async function write_delete(conn, id) {
  await conn.query("DELETE FROM title_basics WHERE id = ?", [id]);
}
module.exports = { begin_transaction, commit, rollback, read, write };