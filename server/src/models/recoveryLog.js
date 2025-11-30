const mysql = require('mysql2/promise');
const { pools } = require('../dbPools');


const RecoveryLog = {
  // Log a new operation
  async logOperation(op_type, pk_value, before_values = null, after_values = null) {
    // transaction_id unique per node
    const transaction_id = `${process.env.NODE_ID}-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    try {
      const currentPool = pools[process.env.NODE_ID];
      if (!currentPool) {
        console.error(`[${process.env.NODE_ID}] Invalid NODE_ID or pool not found`);
        throw new Error('Database pool not found for current NODE_ID');
      }


      await currentPool.query(
        `INSERT INTO recovery_log 
          (transaction_id, op_type, pk_value, before_values, after_values, local_status, replication_status)
          VALUES (?, ?, ?, ?, ?, 'PENDING', 'PENDING')`,
        [transaction_id, op_type, pk_value, JSON.stringify(before_values), JSON.stringify(after_values)]
      );
    } catch (err) {
      console.error(`[${process.env.NODE_ID}] Failed to insert recovery log:`, err.message);
    }
    return transaction_id;
  },

  async updateLocalStatus(transaction_id, status, after_values = null) {
    try {
      const currentPool = pools[process.env.NODE_ID];
      if (!currentPool) {
        console.error(`[${process.env.NODE_ID}] Invalid NODE_ID or pool not found`);
        throw new Error('Database pool not found for current NODE_ID');
      }

      await currentPool.query(
        `UPDATE recovery_log SET local_status = ?, after_values = COALESCE(?, after_values) WHERE transaction_id = ?`,
        [status, after_values ? JSON.stringify(after_values) : null, transaction_id]
      );
    } catch (err) {
      console.error(`[${process.env.NODE_ID}] Failed to update local status:`, err.message);
    }
  },

  async updateReplicationStatus(transaction_id, status) {
    try {
      const currentPool = pools[process.env.NODE_ID];
      if (!currentPool) {
        console.error(`[${process.env.NODE_ID}] Invalid NODE_ID or pool not found`);
        throw new Error('Database pool not found for current NODE_ID');
      }

      await currentPool.query(
        `UPDATE recovery_log SET replication_status = ? WHERE transaction_id = ?`,
        [status, transaction_id]
      );
    } catch (err) {
      console.error(`[${process.env.NODE_ID}] Failed to update replication status:`, err.message);
    }
  },

  async getPendingReplications() {
    const currentPool = pools[process.env.NODE_ID];
      if (!currentPool) {
        console.error(`[${process.env.NODE_ID}] Invalid NODE_ID or pool not found`);
        throw new Error('Database pool not found for current NODE_ID');
      }

    const [rows] = await currentPool.query(
      `SELECT * FROM recovery_log WHERE local_status='APPLIED' AND replication_status='FAILED'`
    );
    return rows;
  }
};

module.exports = RecoveryLog;
