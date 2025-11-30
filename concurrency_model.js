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

export async function begin_transaction(node) {
  const conn = await pools[node].getConnection();
  await conn.beginTransaction();
  return conn; 
}

export async function commit(conn) {
  await conn.commit();
  conn.release();
}

export async function rollback(conn) {
  await conn.rollback();
  conn.release();
}

export async function read(conn, id) {
  const [rows] = await conn.query('SELECT * FROM table_basics WHERE id = ?', [id]);
  return rows[0] || null;
}

// Title for now
export async function write(conn, id, data) {
  await conn.query("UPDATE title_basics SET primaryTitle = ? WHERE id = ?", [data], [id])
}
