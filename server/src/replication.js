
const { pools } = require('./dbPools');
const RecoveryLog = require('./models/recoveryLog');

// Does the actual replication write to the target node
// No recovery logs are created here - that happens at a higher level
const replicateToNode = async (sourcePoolId, targetPoolId, logId, opType, id, data) => {
  const targetPool = pools[targetPoolId];
  
  if (!targetPool) {
    console.error(`[REPLICATION] Target pool ${targetPoolId} not found`);
    if (logId) {
      await RecoveryLog.updateReplicationStatus(sourcePoolId, logId, 'PENDING');
    }
    throw new Error(`Target pool ${targetPoolId} not available`);
  }

  try {
    // Ping the target node to check if it's reachable
    console.log(`[REPLICATION] Pinging ${targetPoolId}...`);
    await targetPool.query('SELECT 1');
    console.log(`[REPLICATION] ${targetPoolId} is reachable`);

    console.log(`[REPLICATION] Starting ${opType} for id=${id} from ${sourcePoolId} to ${targetPoolId}`);

    if (opType === 'INSERT') {
      await targetPool.query(
        'INSERT INTO title_basics (id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          data.titleType,
          data.primaryTitle,
          data.originalTitle,
          data.isAdult,
          data.startYear,
          data.endYear,
          data.runtimeMinutes,
          data.genres
        ]
      );
    } else if (opType === 'UPDATE') {
      await targetPool.query(
        'UPDATE title_basics SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE id = ?',
        [
          data.titleType,
          data.primaryTitle,
          data.originalTitle,
          data.isAdult,
          data.startYear,
          data.endYear,
          data.runtimeMinutes,
          data.genres,
          id
        ]
      );
    } else if (opType === 'DELETE') {
      const [result] = await targetPool.query(
        'DELETE FROM title_basics WHERE id = ?',
        [id]
      );
      console.log(`[REPLICATION] DELETE executed on ${targetPoolId}, affected rows: ${result.affectedRows}`);
    }

    console.log(`[REPLICATION] Successfully replicated ${opType} for id=${id} to ${targetPoolId}`);
    
    // Update recovery log to DONE on success (only if logId exists)
    if (logId) {
      await RecoveryLog.updateReplicationStatus(sourcePoolId, logId, 'DONE');
    }
    
  } catch (err) {
    console.error(`[REPLICATION] Failed to replicate to ${targetPoolId}:`, err.message);
    
    // Update recovery log to PENDING (only if logId exists)
    if (logId) {
      await RecoveryLog.updateReplicationStatus(sourcePoolId, logId, 'PENDING');
    }
    throw err;
  }
};

// Figures out where to replicate based on the source pool and ID
// node1 writes go to node2 (even IDs) or node3 (odd IDs)
// node2/node3 writes go back to node1
const replicateOperation = async (sourcePoolId, logId, opType, id, data, beforeData = null) => {
  try {
    console.log(`[REPLICATION] replicateOperation called with opType=${opType}, id=${id}, sourcePoolId=${sourcePoolId}`);
    
    const isEven = parseInt(id) % 2 === 0;
    let targetPoolId;

    // Determine target based on source
    if (sourcePoolId === 'node1') {
      // node1 replicates to node2 (even) or node3 (odd)
      targetPoolId = isEven ? 'node2' : 'node3';
    } else if (sourcePoolId === 'node2' || sourcePoolId === 'node3') {
      // node2 and node3 replicate to node1
      targetPoolId = 'node1';
    } else {
      throw new Error(`Invalid source pool: ${sourcePoolId}`);
    }

    // Check if target pool is reachable before attempting replication
    const targetPool = pools[targetPoolId];
    if (!targetPool) {
      console.error(`[REPLICATION] Target pool ${targetPoolId} not found`);
      // Create recovery log immediately if no logId exists
      if (!logId) {
        logId = await RecoveryLog.logOperation(
          sourcePoolId, 
          opType, 
          id, 
          beforeData, 
          data
        );
        console.log(`[REPLICATION] Created recovery log (log_id=${logId}) for unreachable pool ${targetPoolId}`);
      }
      throw new Error(`Target pool ${targetPoolId} not available`);
    }

    // Ping the target node to check if it's reachable
    console.log(`[REPLICATION] Pinging ${targetPoolId}...`);
    try {
      await targetPool.query('SELECT 1');
      console.log(`[REPLICATION] ${targetPoolId} is reachable`);
    } catch (pingErr) {
      console.error(`[REPLICATION] ${targetPoolId} is unreachable:`, pingErr.message);
      // Create recovery log immediately if no logId exists
      if (!logId) {
        logId = await RecoveryLog.logOperation(
          sourcePoolId, 
          opType, 
          id, 
          beforeData, 
          data
        );
        console.log(`[REPLICATION] Created recovery log (log_id=${logId}) for unreachable ${targetPoolId}`);
      } else {
        await RecoveryLog.updateReplicationStatus(sourcePoolId, logId, 'PENDING');
      }
      throw new Error(`Target node ${targetPoolId} is offline/unreachable`);
    }

    console.log(`[REPLICATION] Replicating from ${sourcePoolId} to ${targetPoolId} for id=${id}`);
    
    await replicateToNode(sourcePoolId, targetPoolId, logId, opType, id, data);
    
  } catch (err) {
    console.error(`[REPLICATION] Replication failed:`, err.message);
    throw err;
  }
};

// Tries to replay a failed replication from the recovery log
const resolvePendingLog = async (log) => {
  console.log(`[REPLICATION] resolvePendingLog called with op_type=${log.op_type}, pk_value=${log.pk_value}`);
  
  // Determine which data to use based on operation type
  // INSERT/UPDATE: use after_values as main data
  // DELETE: use before_values as main data (need to know what to delete)
  const data = log.after_values || log.before_values;
  const beforeData = log.before_values;
  
  if (!data) {
    throw new Error('No data available for replication');
  }

  await replicateOperation(
    log.pool_id,
    log.log_id,
    log.op_type,
    log.pk_value,
    data,
    beforeData
  );
};

module.exports = { 
  replicateOperation,
  replicateToNode,
  resolvePendingLog
};
