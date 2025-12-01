const express = require('express');
const router = express.Router();
const { pools } = require('../dbPools');
const { replicateOperation } = require('../replication');
const RecoveryLog = require('../models/recoveryLog');

// Map isolation level names to MySQL syntax
const isolationLevelMap = {
  'READ_UNCOMMITTED': 'READ UNCOMMITTED',
  'READ_COMMITTED': 'READ COMMITTED',
  'REPEATABLE_READ': 'REPEATABLE READ',
  'SERIALIZABLE': 'SERIALIZABLE'
};

// Helper to set isolation level for a connection
async function setIsolationLevel(connection, level) {
  const mysqlLevel = isolationLevelMap[level] || 'REPEATABLE READ';
  // Use SET TRANSACTION instead of SET SESSION - applies to the next transaction only
  await connection.query(`SET TRANSACTION ISOLATION LEVEL ${mysqlLevel}`);
}

// Helper to get test movie IDs (one even, one odd)
async function getTestMovieIds() {
  try {
    const [evenRows] = await pools.node1.query('SELECT id FROM title_basics WHERE id % 2 = 0 LIMIT 1');
    const [oddRows] = await pools.node1.query('SELECT id FROM title_basics WHERE id % 2 = 1 LIMIT 1');
    
    return {
      even: evenRows[0]?.id || 137788,
      odd: oddRows[0]?.id || 131771	
    };
  } catch (err) {
    return { even: 137788, odd: 131771}; // fallback
  }
}

// Case 1: Concurrent reads on the same row from nodes
async function runCase1(isolationLevel) {
  const testIds = await getTestMovieIds();
  const allResults = [];

  // Run test for EVEN ID (node1 + node2)
  const evenResults = await runCase1SingleTest(testIds.even, isolationLevel, ['node1', 'node2'], 'EVEN');
  allResults.push(evenResults);

  // Run test for ODD ID (node1 + node3)
  const oddResults = await runCase1SingleTest(testIds.odd, isolationLevel, ['node1', 'node3'], 'ODD');
  allResults.push(oddResults);

  return {
    success: true,
    case: 1,
    isolationLevel,
    sets: allResults,
    overallConsistency: allResults.every(r => r.consistency)
  };
}

async function runCase1SingleTest(movieId, isolationLevel, nodes, setType) {
  const results = [];
  const startTime = Date.now();

  try {
    // Get connections for the specified nodes only
    const connections = {};
    for (const node of nodes) {
      connections[node] = await pools[node].getConnection();
    }

    try {
      // Set isolation level for all connections
      await Promise.all(
        Object.values(connections).map(conn => setIsolationLevel(conn, isolationLevel))
      );

      // Begin transactions
      await Promise.all(
        Object.values(connections).map(conn => conn.beginTransaction())
      );

      nodes.forEach(node => {
        results.push({ node, operation: 'START TRANSACTION', status: 'Success', timestamp: Date.now() - startTime });
      });

      // Concurrent reads
      const readPromises = nodes.map(node =>
        connections[node].query('SELECT * FROM title_basics WHERE id = ?', [movieId]).then(([rows]) => ({
          node,
          data: rows[0],
          timestamp: Date.now() - startTime
        }))
      );

      const readResults = await Promise.all(readPromises);
      
      readResults.forEach(result => {
        results.push({
          node: result.node,
          operation: `READ id=${movieId}`,
          status: 'Success',
          data: result.data?.primaryTitle || 'N/A',
          timestamp: result.timestamp
        });
      });

      // Commit all transactions
      await Promise.all(
        Object.values(connections).map(conn => conn.commit())
      );

      nodes.forEach(node => {
        results.push({ node, operation: 'COMMIT', status: 'Success', timestamp: Date.now() - startTime });
      });

      return {
        setType,
        movieId,
        nodes,
        results,
        consistency: readResults.every(r => r.data?.primaryTitle === readResults[0].data?.primaryTitle),
        finalState: readResults.map(r => ({ node: r.node, title: r.data?.primaryTitle }))
      };

    } finally {
      Object.values(connections).forEach(conn => conn.release());
    }
  } catch (err) {
    return {
      setType,
      movieId,
      nodes,
      error: err.message,
      results
    };
  }
}

// Case 2: One write with replication happening concurrently with reads
async function runCase2(isolationLevel) {
  const testIds = await getTestMovieIds();
  const allResults = [];

  // Run test for EVEN ID (node1 writes, replicates to node2, node2 reads during replication)
  const evenResults = await runCase2SingleTest(testIds.even, isolationLevel, 'node1', 'node2', 'EVEN');
  allResults.push(evenResults);

  // Run test for ODD ID (node1 writes, replicates to node3, node3 reads during replication)
  const oddResults = await runCase2SingleTest(testIds.odd, isolationLevel, 'node1', 'node3', 'ODD');
  allResults.push(oddResults);

  return {
    success: true,
    case: 2,
    isolationLevel,
    sets: allResults,
    overallConsistency: allResults.every(r => r.consistency)
  };
}

async function runCase2SingleTest(movieId, isolationLevel, sourceNode, targetNode, setType) {
  const results = [];
  const startTime = Date.now();
  const testTitle = `Test_${setType}_${Date.now()}`;

  try {
    const connSource = await pools[sourceNode].getConnection();
    const connTarget = await pools[targetNode].getConnection();

    try {
      // Get original value
      const [originalRows] = await connSource.query('SELECT * FROM title_basics WHERE id = ?', [movieId]);
      const originalData = originalRows[0];
      const originalTitle = originalData?.primaryTitle;

      // Track which nodes have committed writes
      let sourceCommitted = false;
      let targetCommitted = false;
      let readData = undefined; // Track read data for dirty read detection

      // Set isolation level
      await setIsolationLevel(connSource, isolationLevel);
      await setIsolationLevel(connTarget, isolationLevel);

      // Source node begins transaction and writes
      await connSource.beginTransaction();
      results.push({ node: sourceNode, operation: 'START TRANSACTION', status: 'Success', timestamp: Date.now() - startTime });

      await connSource.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [testTitle, movieId]);
      results.push({
        node: sourceNode,
        operation: `WRITE id=${movieId}`,
        status: 'Success',
        data: testTitle,
        timestamp: Date.now() - startTime
      });

      await connSource.commit();
      sourceCommitted = true;
      results.push({ node: sourceNode, operation: 'COMMIT', status: 'Success', timestamp: Date.now() - startTime });

      // Simulate concurrent replication and read on target node
      // Create a separate connection for replication to simulate concurrent transactions
      const connReplication = await pools[targetNode].getConnection();
      
      try {
        await setIsolationLevel(connReplication, isolationLevel);
        await setIsolationLevel(connTarget, isolationLevel);

        // Start replication transaction first
        await connReplication.beginTransaction();
        results.push({ node: targetNode, operation: 'START REPLICATION TX', status: 'Success', timestamp: Date.now() - startTime });

        // Replication write
        await connReplication.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [testTitle, movieId]);
        results.push({
          node: targetNode,
          operation: `REPLICATION WRITE id=${movieId}`,
          status: 'Success',
          data: testTitle,
          timestamp: Date.now() - startTime
        });

        // Start read transaction while replication hasn't committed yet
        await connTarget.beginTransaction();
        results.push({ node: targetNode, operation: 'START READ TX', status: 'Success', timestamp: Date.now() - startTime });

        // Run read and commit simultaneously - let MySQL handle the isolation
        const readPromise = (async () => {
          const [rows] = await connTarget.query('SELECT primaryTitle FROM title_basics WHERE id = ?', [movieId]);
          return {
            success: true,
            data: rows[0]?.primaryTitle,
            timestamp: Date.now() - startTime
          };
        })();

        const replicationCommitPromise = (async () => {
          await connReplication.commit();
          return { committed: true, timestamp: Date.now() - startTime };
        })();

        // Let MySQL handle the isolation - no timeout, no delays
        const [readResult, replCommitResult] = await Promise.all([readPromise, replicationCommitPromise]);

        targetCommitted = replCommitResult.committed;

        results.push({
          node: targetNode,
          operation: `READ id=${movieId}`,
          status: readResult.success ? 'Success' : 'Failed',
          data: readResult.data || readResult.error,
          timestamp: readResult.timestamp
        });

        readData = readResult.data; // Store for later use

        results.push({ 
          node: targetNode, 
          operation: 'COMMIT REPLICATION', 
          status: 'Success', 
          timestamp: replCommitResult.timestamp 
        });

        // Commit read transaction
        await connTarget.commit();
        results.push({ node: targetNode, operation: 'COMMIT READ', status: 'Success', timestamp: Date.now() - startTime });

        connReplication.release();

      } catch (timeoutErr) {
        // Handle timeout or deadlock
        results.push({
          node: targetNode,
          operation: 'ERROR',
          status: 'Timeout/Deadlock',
          data: timeoutErr.message,
          timestamp: Date.now() - startTime
        });
        
        try { await connReplication.rollback(); } catch (e) {}
        try { await connTarget.rollback(); } catch (e) {}
        connReplication.release();
      }

      // Wait for any pending operations
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check final state
      const [finalSource] = await connSource.query('SELECT primaryTitle FROM title_basics WHERE id = ?', [movieId]);
      const [finalTarget] = await connTarget.query('SELECT primaryTitle FROM title_basics WHERE id = ?', [movieId]);

      const finalState = [
        { node: sourceNode, title: finalSource[0]?.primaryTitle },
        { node: targetNode, title: finalTarget[0]?.primaryTitle }
      ];

      // Restore original value on nodes that committed writes
      const restorePromises = [];
      if (sourceCommitted) {
        restorePromises.push(connSource.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [originalTitle, movieId]));
      }
      if (targetCommitted) {
        restorePromises.push(connTarget.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [originalTitle, movieId]));
      }
      if (restorePromises.length > 0) {
        await Promise.all(restorePromises).catch(err => console.error('Restore failed:', err.message));
      }

      // Detect dirty read: read must match testTitle AND read must happen before replication commit
      const readTimestamp = results.find(r => r.operation.startsWith('READ'))?.timestamp || Infinity;
      const commitTimestamp = results.find(r => r.operation === 'COMMIT REPLICATION')?.timestamp || 0;
      const isDirtyRead = readData === testTitle && readTimestamp < commitTimestamp;

      return {
        setType,
        movieId,
        nodes: [sourceNode, targetNode],
        results,
        dirtyRead: isDirtyRead, // Dirty read only if read happened before commit
        consistency: finalState[0].title === finalState[1].title,
        finalState
      };

    } finally {
      connSource.release();
      connTarget.release();
    }
  } catch (err) {
    return {
      setType,
      movieId,
      nodes: [sourceNode, targetNode],
      error: err.message,
      results
    };
  }
}

// Case 3: Concurrent writes - one node writing while another replicates to it
async function runCase3(isolationLevel) {
  const testIds = await getTestMovieIds();
  const allResults = [];

  // Run test for EVEN ID (node1 and node2)
  const evenResults = await runCase3SingleTest(testIds.even, isolationLevel, 'node1', 'node2', 'EVEN');
  allResults.push(evenResults);

  // Run test for ODD ID (node1 and node3)
  const oddResults = await runCase3SingleTest(testIds.odd, isolationLevel, 'node1', 'node3', 'ODD');
  allResults.push(oddResults);

  return {
    success: true,
    case: 3,
    isolationLevel,
    sets: allResults,
    overallConsistency: allResults.every(r => r.consistency)
  };
}

async function runCase3SingleTest(movieId, isolationLevel, node1Name, node2Name, setType) {
  const results = [];
  const startTime = Date.now();
  const timestamp = Date.now();
  let node1Committed = false;
  let node2Committed = false;

  try {
    const conn1 = await pools[node1Name].getConnection();
    const conn2 = await pools[node2Name].getConnection();
    const connReplication = await pools[node2Name].getConnection(); // Separate connection for replication

    try {
      // Get original value
      const [originalRows] = await conn1.query('SELECT * FROM title_basics WHERE id = ?', [movieId]);
      const originalTitle = originalRows[0]?.primaryTitle;

      // Set isolation level
      await setIsolationLevel(conn1, isolationLevel);
      await setIsolationLevel(conn2, isolationLevel);
      await setIsolationLevel(connReplication, isolationLevel);

      // Step 1: Node1 writes and commits
      await conn1.beginTransaction();
      results.push({ node: node1Name, operation: 'START TRANSACTION', status: 'Success', timestamp: Date.now() - startTime });

      const node1Title = `${node1Name.toUpperCase()}_${setType}_${timestamp}`;
      await conn1.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [node1Title, movieId]);
      results.push({
        node: node1Name,
        operation: `WRITE id=${movieId}`,
        status: 'Success',
        data: node1Title,
        timestamp: Date.now() - startTime
      });

      await conn1.commit();
      node1Committed = true;
      results.push({ node: node1Name, operation: 'COMMIT', status: 'Success', timestamp: Date.now() - startTime });

      // Step 2: Simulate concurrent replication and local write on node2
      try {
        // Start replication transaction
        await connReplication.beginTransaction();
        results.push({ node: node2Name, operation: 'START REPLICATION TX', status: 'Success', timestamp: Date.now() - startTime });

        // Replication write
        await connReplication.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [node1Title, movieId]);
        results.push({
          node: node2Name,
          operation: `REPLICATION WRITE id=${movieId}`,
          status: 'Success',
          data: node1Title,
          timestamp: Date.now() - startTime
        });

        // Start local write transaction on node2 (concurrent with replication)
        await conn2.beginTransaction();
        results.push({ node: node2Name, operation: 'START LOCAL WRITE TX', status: 'Success', timestamp: Date.now() - startTime });

        // Run replication commit and local write simultaneously
        const node2Title = `${node2Name.toUpperCase()}_${setType}_${timestamp}`;
        
        const replicationCommitPromise = (async () => {
          await connReplication.commit();
          return { committed: true, timestamp: Date.now() - startTime };
        })();

        const localWritePromise = (async () => {
          await conn2.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [node2Title, movieId]);
          return { 
            success: true, 
            data: node2Title,
            timestamp: Date.now() - startTime 
          };
        })();

        const [replCommitResult, writeResult] = await Promise.all([replicationCommitPromise, localWritePromise]);

        results.push({ 
          node: node2Name, 
          operation: 'COMMIT REPLICATION', 
          status: 'Success', 
          timestamp: replCommitResult.timestamp 
        });

        results.push({
          node: node2Name,
          operation: `LOCAL WRITE id=${movieId}`,
          status: writeResult.success ? 'Success' : 'Failed',
          data: writeResult.data,
          timestamp: writeResult.timestamp
        });

        // Commit local write
        await conn2.commit();
        node2Committed = true;
        results.push({ node: node2Name, operation: 'COMMIT LOCAL WRITE', status: 'Success', timestamp: Date.now() - startTime });

        connReplication.release();

      } catch (conflictErr) {
        // Handle write conflict or deadlock
        results.push({
          node: node2Name,
          operation: 'ERROR',
          status: 'Conflict/Deadlock',
          data: conflictErr.message,
          timestamp: Date.now() - startTime
        });
        
        try { await connReplication.rollback(); } catch (e) {}
        try { await conn2.rollback(); } catch (e) {}
        connReplication.release();
      }

      // Wait for any pending operations
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check final state from both nodes
      const [final1] = await conn1.query('SELECT primaryTitle FROM title_basics WHERE id = ?', [movieId]);
      const [final2] = await conn2.query('SELECT primaryTitle FROM title_basics WHERE id = ?', [movieId]);

      const finalState = [
        { node: node1Name, title: final1[0]?.primaryTitle },
        { node: node2Name, title: final2[0]?.primaryTitle }
      ];

      // Determine which transaction committed later
      const replicationCommitTime = results.find(r => r.operation === 'COMMIT REPLICATION')?.timestamp || 0;
      const localWriteCommitTime = results.find(r => r.operation === 'COMMIT LOCAL WRITE')?.timestamp || 0;
      
      // Expected winner is the later commit
      const node2Title = `${node2Name.toUpperCase()}_${setType}_${timestamp}`;
      const expectedWinner = localWriteCommitTime > replicationCommitTime ? node2Title : node1Title;
      
      // Consistency is achieved if the later transaction is the winner
      const actualWinner = finalState[1].title; // Node2 has the final state after concurrent writes
      const isConsistent = actualWinner === expectedWinner;

      // Restore original value on nodes that successfully committed
      const restorePromises = [];
      if (node1Committed) {
        restorePromises.push(conn1.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [originalTitle, movieId]));
      }
      if (node2Committed) {
        restorePromises.push(conn2.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [originalTitle, movieId]));
      }
      if (restorePromises.length > 0) {
        await Promise.all(restorePromises).catch(err => console.error('Restore failed:', err.message));
      }

      return {
        setType,
        movieId,
        nodes: [node1Name, node2Name],
        results,
        consistency: isConsistent,
        finalState,
        winner: finalState[0].title,
        expectedWinner: expectedWinner
      };

    } finally {
      conn1.release();
      conn2.release();
    }
  } catch (err) {
    return {
      setType,
      movieId,
      nodes: [node1Name, node2Name],
      error: err.message,
      results
    };
  }
}

// Main simulation endpoint
router.get('/simulate', async (req, res) => {
  const caseNum = parseInt(req.query.case) || 1;
  const isolationLevel = req.query.isolation || 'READ_COMMITTED';

  console.log(`[SIMULATION] Running Case ${caseNum} with ${isolationLevel}`);

  try {
    let result;
    switch (caseNum) {
      case 1:
        result = await runCase1(isolationLevel);
        break;
      case 2:
        result = await runCase2(isolationLevel);
        break;
      case 3:
        result = await runCase3(isolationLevel);
        break;
      default:
        return res.status(400).json({ error: 'Invalid case number' });
    }

    res.json(result);
  } catch (err) {
    console.error('[SIMULATION] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
