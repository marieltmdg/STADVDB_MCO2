const express = require('express');
const router = express.Router();
const { IsolationLevel, acquireLock, releaseLock } = require('../concurrency');
const Movie = require('../models/movie');
const { begin_transaction, commit, rollback, read, write } = require('../models/concurrency_model');

// GET /api/simulate?case=1&isolation=READ_COMMITTED
router.get('/simulate', async (req, res) => {
  const caseNum = parseInt(req.query.case) || 1;
  const isolationLevel = req.query.isolation || 'READ_COMMITTED';
  
  console.log(`[SIMULATION] Running Case ${caseNum} with isolation level: ${isolationLevel}`);
  
  try {
    let nodeStates = [];
    let replicationLog = [];
    
    switch(caseNum) {
      case 1: // Concurrent reads
        const case1Result = await runConcurrencyCase1(isolationLevel);
        nodeStates = case1Result.nodeStates;
        replicationLog = case1Result.replicationLog;
        break;
      case 2: // Read-Write
        const case2Result = await runConcurrencyCase2(isolationLevel);
        nodeStates = case2Result.nodeStates;
        replicationLog = case2Result.replicationLog;
        break;
      case 3: // Concurrent writes
        const case3Result = await runConcurrencyCase3(isolationLevel);
        nodeStates = case3Result.nodeStates;
        replicationLog = case3Result.replicationLog;
        break;
      default:
        throw new Error('Invalid case number');
    }
    
    res.json({ nodeStates, replicationLog });
  } catch (error) {
    console.error('[SIMULATION ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

// Real concurrency test implementations using actual database operations
async function runConcurrencyCase1(isolationLevel) {
  const testId = '135244'; // Even ID - belongs to node2
  const txId = Date.now();
  let replicationLog = [];
  
  console.log(`[CASE 1] Starting concurrent reads on testId: ${testId} (even - node2 owner) with isolation: ${isolationLevel}`);
  
  try {
    // Acquire read locks for all nodes
    console.log(`[CASE 1] Acquiring read locks for concurrent reads...`);
    const lock1 = acquireLock(testId, 'read', `tx${txId}_1`);
    const lock2 = acquireLock(testId, 'read', `tx${txId}_2`);
    
    if (!lock1 || !lock2) {
      console.log(`[CASE 1] Failed to acquire locks: lock1=${lock1}, lock2=${lock2}`);
      releaseLock(testId, `tx${txId}_1`);
      releaseLock(testId, `tx${txId}_2`);
      throw new Error('Failed to acquire read locks');
    }
    
    console.log(`[CASE 1] Read locks acquired successfully`);
    console.log(`[CASE 1] Beginning transactions on all nodes for concurrent reads`);
    const conn1 = await begin_transaction('node1', isolationLevel); // Central node
    const conn2 = await begin_transaction('node2', isolationLevel); // Even fragment (owns the data)
    
    console.log(`[CASE 1] Starting concurrent reads from all nodes...`);
    const [result1, result2] = await Promise.all([
      read(conn1, testId),
      read(conn2, testId)
    ]);
    
    console.log(`[CASE 1] Node1 read result:`, result1);
    console.log(`[CASE 1] Node2 read result:`, result2);
    
    console.log(`[CASE 1] Committing transactions...`);
    await Promise.all([commit(conn1), commit(conn2)]);
    
    // Release locks after successful completion
    console.log(`[CASE 1] Releasing read locks...`);
    releaseLock(testId, `tx${txId}_1`);
    releaseLock(testId, `tx${txId}_2`);
    
    replicationLog = [
      { transactionId: `READ_TX${txId}_1`, operation: 'READ', node: 'Node1', status: result1 ? 'SUCCESS' : 'NO_DATA' },
      { transactionId: `READ_TX${txId}_2`, operation: 'READ', node: 'Node2', status: result2 ? 'SUCCESS' : 'NO_DATA' }
    ];
    
    console.log(`[CASE 1] Case 1 completed successfully`);
    console.log(`[CASE 1] Replication log:`, replicationLog);
    
    return {
      nodeStates: [
        { nodeId: 'node1', status: result1 ? 'Read successful' : 'Read failed - no data', result: result1 },
        { nodeId: 'node2', status: result2 ? 'Read successful' : 'Read failed - no data', result: result2 },
      ],
      replicationLog
    };
  } catch (error) {
    console.error(`[CASE 1] Error occurred:`, error);
    
    // Release any acquired locks on error
    releaseLock(testId, `tx${txId}_1`);
    releaseLock(testId, `tx${txId}_2`);
    
    replicationLog = [
      { transactionId: `READ_TX${txId}_1`, operation: 'READ', node: 'Node1', status: 'ERROR' },
      { transactionId: `READ_TX${txId}_2`, operation: 'read', node: 'Node2', status: 'ERROR' }
    ];
    
    console.log(`[CASE 1] Returning error state with replication log:`, replicationLog);
    
    return {
      nodeStates: [
        { nodeId: 'node1', status: 'Read error: ' + error.message, result: null },
        { nodeId: 'node2', status: 'Read error: ' + error.message, result: null },
      ],
      replicationLog
    };
  }
}

async function runConcurrencyCase2(isolationLevel) {
  const testId = '135243'; // Odd ID - belongs to node3
  const txId = Date.now();
  let replicationLog = [];
  
  console.log(`[CASE 2] Starting read-write operations on testId: ${testId} (odd - node3) with isolation: ${isolationLevel}`);
  
  try {
    // Acquire locks: read locks for node1 & node2, write lock for node3
    console.log(`[CASE 2] Acquiring locks: read locks for node1&2, write lock for node3...`);
    const readLock1 = acquireLock(testId, 'read', `tx${txId}_1`);
    const readLock2 = acquireLock(testId, 'read', `tx${txId}_2`);
    const writeLock3 = acquireLock(testId, 'write', `tx${txId}_3`);
    
    // Check if write lock conflicts with read locks
    if (!readLock1 || !readLock2 || !writeLock3) {
      console.log(`[CASE 2] Lock conflict detected: read1=${readLock1}, read2=${readLock2}, write3=${writeLock3}`);
      releaseLock(testId, `tx${txId}_1`);
      releaseLock(testId, `tx${txId}_2`);
      releaseLock(testId, `tx${txId}_3`);
      
      // Simulate lock conflict behavior
      return {
        nodeStates: [
          { nodeId: 'node1', status: readLock1 ? 'Read completed' : 'Read blocked by write lock', result: null },
          { nodeId: 'node2', status: readLock2 ? 'Read completed' : 'Read blocked by write lock', result: null },
          { nodeId: 'node3', status: writeLock3 ? 'Write committed' : 'Write blocked by read locks', result: null }
        ],
        replicationLog: [
          { transactionId: `READ_TX${txId}_1`, operation: 'read', node: 'Node1', status: readLock1 ? 'SUCCESS' : 'BLOCKED' },
          { transactionId: `READ_TX${txId}_2`, operation: 'read', node: 'Node2', status: readLock2 ? 'SUCCESS' : 'BLOCKED' },
          { transactionId: `WRITE_TX${txId}_3`, operation: 'UPDATE', node: 'Node3', status: writeLock3 ? 'SUCCESS' : 'BLOCKED' }
        ]
      };
    }
    
    console.log(`[CASE 2] All locks acquired successfully`);
    console.log(`[CASE 2] Beginning transactions: node3 will write, node1 and node2 will read`);
    const conn1 = await begin_transaction('node1', isolationLevel); // Central node reading
    const conn2 = await begin_transaction('node2', isolationLevel); // Even fragment reading
    const conn3 = await begin_transaction('node3', isolationLevel); // Odd fragment writing
    
    console.log(`[CASE 2] Starting write on node3 and concurrent reads on node1 and node2...`);
    const [read1, read2, write3] = await Promise.allSettled([
      read(conn1, testId),  // Central node reads
      read(conn2, testId),  // Even fragment reads (cross-fragment read)
      write(conn3, testId, 'Updated by Node 3 (owner)') // Odd fragment writes (owns the data)
    ]);
    
    console.log(`[CASE 2] Node1 read result:`, read1);
    console.log(`[CASE 2] Node2 read result:`, read2);
    console.log(`[CASE 2] Node3 write result:`, write3);
    
    console.log(`[CASE 2] Committing transactions...`);
    await Promise.allSettled([commit(conn1), commit(conn2), commit(conn3)]);
    
    // Release locks after completion
    console.log(`[CASE 2] Releasing locks...`);
    releaseLock(testId, `tx${txId}_1`);
    releaseLock(testId, `tx${txId}_2`);
    releaseLock(testId, `tx${txId}_3`);
    
    replicationLog = [
      { transactionId: `READ_TX${txId}_1`, operation: 'READ', node: 'Node1', status: read1.status === 'fulfilled' ? 'SUCCESS' : 'BLOCKED' },
      { transactionId: `READ_TX${txId}_2`, operation: 'READ', node: 'Node2', status: read2.status === 'fulfilled' ? 'SUCCESS' : 'BLOCKED' },
      { transactionId: `WRITE_TX${txId}_3`, operation: 'UPDATE', node: 'Node3', status: write3.status === 'fulfilled' ? 'SUCCESS' : 'FAILED' }
    ];
    
    console.log(`[CASE 2] Case 2 completed`);
    console.log(`[CASE 2] Replication log:`, replicationLog);
    
    return {
      nodeStates: [
        { nodeId: 'node1', status: read1.status === 'fulfilled' ? 'Read completed' : 'Read blocked', result: read1.status === 'fulfilled' ? read1.value : null },
        { nodeId: 'node2', status: read2.status === 'fulfilled' ? 'Read completed' : 'Read blocked', result: read2.status === 'fulfilled' ? read2.value : null },
        { nodeId: 'node3', status: write3.status === 'fulfilled' ? 'Write committed' : 'Write failed', result: write3.status === 'fulfilled' ? 'Updated by Node 3 (owner)' : null }
      ],
      replicationLog
    };
  } catch (error) {
    console.error(`[CASE 2] Error occurred:`, error);
    
    // Release any acquired locks on error
    releaseLock(testId, `tx${txId}_1`);
    releaseLock(testId, `tx${txId}_2`);
    releaseLock(testId, `tx${txId}_3`);
    
    replicationLog = [
      { transactionId: `READ_TX${txId}_1`, operation: 'read', node: 'Node1', status: 'ERROR' },
      { transactionId: `READ_TX${txId}_2`, operation: 'read', node: 'Node2', status: 'ERROR' },
      { transactionId: `WRITE_TX${txId}_3`, operation: 'UPDATE', node: 'Node3', status: 'ERROR' }
    ];
    
    console.log(`[CASE 2] Returning error state with replication log:`, replicationLog);
    
    return {
      nodeStates: [
        { nodeId: 'node1', status: 'Transaction error', result: null },
        { nodeId: 'node2', status: 'Transaction error', result: null },
        { nodeId: 'node3', status: 'Transaction error', result: null }
      ],
      replicationLog
    };
  }
}

async function runConcurrencyCase3(isolationLevel) {
  const testId = '135243'; // Odd ID - belongs to node3 primarily
  const txId = Date.now();
  let replicationLog = [];
  
  console.log(`[CASE 3] Starting concurrent writes on testId: ${testId} (odd - node3 owner) with isolation: ${isolationLevel}`);
  
  try {
    // Try to acquire write locks for both nodes (should conflict)
    console.log(`[CASE 3] Attempting to acquire write locks for concurrent writes...`);
    const writeLock1 = acquireLock(testId, 'write', `tx${txId}_1`);
    const writeLock3 = acquireLock(testId, 'write', `tx${txId}_3`);
    
    console.log(`[CASE 3] Lock acquisition results: node1=${writeLock1}, node3=${writeLock3}`);
    
    // Only one write lock should succeed
    let winner = null;
    let loser = null;
    
    if (writeLock1 && !writeLock3) {
      winner = { node: 'node1', txId: `tx${txId}_1`, msg: 'Updated by Node 1 (central)' };
      loser = { node: 'node3', txId: `tx${txId}_3` };
    } else if (!writeLock1 && writeLock3) {
      winner = { node: 'node3', txId: `tx${txId}_3`, msg: 'Updated by Node 3 (odd fragment - owner)' };
      loser = { node: 'node1', txId: `tx${txId}_1` };
    } else if (writeLock1 && writeLock3) {
      // Should not happen with proper exclusive locking, but handle it
      console.log(`[CASE 3] WARNING: Both write locks acquired - this indicates a locking bug`);
      winner = { node: 'node1', txId: `tx${txId}_1`, msg: 'Updated by Node 1 (central)' };
      loser = { node: 'node3', txId: `tx${txId}_3` };
      releaseLock(testId, `tx${txId}_3`); // Release the second lock
    } else {
      // Neither lock acquired - very unusual
      throw new Error('Failed to acquire any write locks');
    }
    
    console.log(`[CASE 3] Lock conflict resolved: ${winner.node} wins, ${loser.node} blocked`);
    console.log(`[CASE 3] Beginning transaction for winner: ${winner.node}`);
    
    let writeResult = null;
    if (winner.node === 'node1') {
      const conn1 = await begin_transaction('node1', isolationLevel);
      await write(conn1, testId, winner.msg);
      await commit(conn1);
      writeResult = { node: 'node1', success: true, message: winner.msg };
    } else {
      const conn3 = await begin_transaction('node3', isolationLevel);
      await write(conn3, testId, winner.msg);
      await commit(conn3);
      writeResult = { node: 'node3', success: true, message: winner.msg };
    }
    
    console.log(`[CASE 3] Write completed by ${writeResult.node}`);
    
    // Release the winning lock
    releaseLock(testId, winner.txId);
    
    
    replicationLog = [
      { 
        transactionId: `WRITE_TX${txId}_1`, 
        operation: 'UPDATE', 
        node: 'Node1', 
        status: writeResult.node === 'node1' ? 'SUCCESS' : 'BLOCKED' 
      },
      { 
        transactionId: `WRITE_TX${txId}_3`, 
        operation: 'UPDATE', 
        node: 'Node3', 
        status: writeResult.node === 'node3' ? 'SUCCESS' : 'BLOCKED' 
      }
    ];
    
    console.log(`[CASE 3] Case 3 completed`);
    console.log(`[CASE 3] Replication log:`, replicationLog);
    
    return {
      nodeStates: [
        { 
          nodeId: 'node1', 
          status: writeResult.node === 'node1' ? 'Write committed' : 'Write blocked by lock conflict', 
          result: writeResult.node === 'node1' ? writeResult.message : 'Blocked by node3 write lock' 
        },
        { nodeId: 'node2', status: 'Idle', result: null },
        { 
          nodeId: 'node3', 
          status: writeResult.node === 'node3' ? 'Write committed' : 'Write blocked by lock conflict', 
          result: writeResult.node === 'node3' ? writeResult.message : 'Blocked by node1 write lock' 
        }
      ],
      replicationLog
    };
  } catch (error) {
    console.error(`[CASE 3] Error occurred:`, error);
    
    // Release any acquired locks on error
    releaseLock(testId, `tx${txId}_1`);
    releaseLock(testId, `tx${txId}_3`);
    
    replicationLog = [
      { transactionId: `WRITE_TX${txId}_1`, operation: 'UPDATE', node: 'Node1', status: 'ERROR' },
      { transactionId: `WRITE_TX${txId}_3`, operation: 'UPDATE', node: 'Node3', status: 'ERROR' }
    ];
    
    console.log(`[CASE 3] Returning error state with replication log:`, replicationLog);
    
    return {
      nodeStates: [
        { nodeId: 'node1', status: 'Write error: ' + error.message, result: null },
        { nodeId: 'node2', status: 'Idle', result: null },
        { nodeId: 'node3', status: 'Write error: ' + error.message, result: null }
      ],
      replicationLog
    };
  }
}


module.exports = router;
