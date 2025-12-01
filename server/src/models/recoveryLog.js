const mysql = require('mysql2/promise');
const { pools } = require('../dbPools');

// Keep track of the last resolved log ID for each node
// This way we don't have to scan all logs every time
const checkpoints = {
  node1: 0,
  node2: 0,
  node3: 0
};

const RecoveryLog = {
  // Creates a recovery log entry when replication fails
  // Gets called from wherever the write happened
  async logOperation(pool_id, op_type, pk_value = null, before_values = null, after_values = null) {
    try {
      const currentPool = pools[pool_id];
      if (!currentPool) {
        console.error(`[RECOVERY_LOG] Invalid pool_id: ${pool_id}`);
        throw new Error(`Database pool not found: ${pool_id}`);
      }

      const [result] = await currentPool.query(
        `INSERT INTO recovery_log 
          (pool_id, op_type, pk_value, before_values, after_values, local_status, replication_status)
          VALUES (?, ?, ?, ?, ?, 'APPLIED', 'PENDING')`,
        [
          pool_id,
          op_type,
          pk_value ? String(pk_value) : null,
          before_values ? JSON.stringify(before_values) : null,
          after_values ? JSON.stringify(after_values) : null
        ]
      );

      console.log(`[RECOVERY_LOG] Logged ${op_type} operation on ${pool_id}, log_id=${result.insertId}`);
      return result.insertId;
    } catch (err) {
      console.error(`[RECOVERY_LOG] Failed to log operation on ${pool_id}:`, err.message);
      throw err;
    }
  },

  // Updates the status of a recovery log after trying to replicate it
  async updateReplicationStatus(pool_id, log_id, status) {
    try {
      const currentPool = pools[pool_id];
      if (!currentPool) {
        console.error(`[RECOVERY_LOG] Invalid pool_id: ${pool_id}`);
        throw new Error(`Database pool not found: ${pool_id}`);
      }

      await currentPool.query(
        `UPDATE recovery_log SET replication_status = ? WHERE log_id = ?`,
        [status, log_id]
      );

      console.log(`[RECOVERY_LOG] Updated log_id=${log_id} on ${pool_id} to replication_status=${status}`);
    } catch (err) {
      console.error(`[RECOVERY_LOG] Failed to update replication status on ${pool_id}:`, err.message);
      throw err;
    }
  },

  // Grabs all the logs that still need replication, starting after the checkpoint
  async getPendingLogs(pool_id) {
    try {
      const currentPool = pools[pool_id];
      if (!currentPool) {
        console.error(`[RECOVERY_LOG] Invalid pool_id: ${pool_id}`);
        throw new Error(`Database pool not found: ${pool_id}`);
      }

      const checkpoint = checkpoints[pool_id] || 0;

      const [rows] = await currentPool.query(
        `SELECT * FROM recovery_log 
         WHERE pool_id = ? 
           AND log_id > ? 
           AND local_status = 'APPLIED' 
           AND replication_status = 'PENDING'
         ORDER BY log_id ASC`,
        [pool_id, checkpoint]
      );

      console.log(`[RECOVERY_LOG] Found ${rows.length} pending logs on ${pool_id} (checkpoint: ${checkpoint})`);
      return rows;
    } catch (err) {
      console.error(`[RECOVERY_LOG] Failed to get pending logs from ${pool_id}:`, err.message);
      return [];
    }
  },

  // Goes through pending logs and tries to replicate them
  // Call this after any write operation to catch up on failed replications
  async resolvePendingLogs(pool_id, replicationFn) {
    try {
      const pendingLogs = await this.getPendingLogs(pool_id);
      
      if (pendingLogs.length === 0) {
        return;
      }

      console.log(`[RECOVERY_LOG] Resolving ${pendingLogs.length} pending logs on ${pool_id}`);

      let allResolved = true;
      let highestResolvedLogId = checkpoints[pool_id] || 0;

      for (const log of pendingLogs) {
        try {
          // Parse JSON values - handle cases where values might already be objects or null
          let beforeValues = null;
          let afterValues = null;
          
          if (log.before_values) {
            beforeValues = typeof log.before_values === 'string' 
              ? JSON.parse(log.before_values) 
              : log.before_values;
          }
          
          if (log.after_values) {
            afterValues = typeof log.after_values === 'string'
              ? JSON.parse(log.after_values)
              : log.after_values;
          }

          // Call the replication function
          await replicationFn({
            log_id: log.log_id,
            pool_id: log.pool_id,
            op_type: log.op_type,
            pk_value: log.pk_value,
            before_values: beforeValues,
            after_values: afterValues
          });

          // If successful, update status to DONE
          await this.updateReplicationStatus(pool_id, log.log_id, 'DONE');
          
          // Track the highest resolved log_id
          if (log.log_id > highestResolvedLogId) {
            highestResolvedLogId = log.log_id;
          }
        } catch (err) {
          console.error(`[RECOVERY_LOG] Failed to resolve log_id=${log.log_id}:`, err.message);
          // Mark that not all logs were resolved
          allResolved = false;
          // Keep status as PENDING for retry
          await this.updateReplicationStatus(pool_id, log.log_id, 'PENDING');
        }
      }

      // Only update checkpoint if ALL pending logs were successfully resolved
      if (allResolved && highestResolvedLogId > (checkpoints[pool_id] || 0)) {
        checkpoints[pool_id] = highestResolvedLogId;
        console.log(`[RECOVERY_LOG] Updated checkpoint for ${pool_id} to ${highestResolvedLogId} (all logs resolved)`);
      } else if (!allResolved) {
        console.log(`[RECOVERY_LOG] Checkpoint for ${pool_id} retained at ${checkpoints[pool_id] || 0} (some logs failed)`);
      }
    } catch (err) {
      console.error(`[RECOVERY_LOG] Error in resolvePendingLogs for ${pool_id}:`, err.message);
    }
  },

  // Returns the current checkpoint for a node
  getCheckpoint(pool_id) {
    return checkpoints[pool_id] || 0;
  },

  // Manually sets the checkpoint (useful if you need to reset or jump ahead)
  setCheckpoint(pool_id, log_id) {
    checkpoints[pool_id] = log_id;
    console.log(`[RECOVERY_LOG] Manually set checkpoint for ${pool_id} to ${log_id}`);
  }
};

module.exports = RecoveryLog;
