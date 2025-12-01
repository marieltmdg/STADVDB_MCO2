const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { pools } = require('../dbPools');
const { replicateOperation, resolvePendingLog } = require('../replication');
const RecoveryLog = require('../models/recoveryLog');
const env = process.env;

// Helper to get test movie IDs (one even, one odd)
async function getTestMovieIds() {
  try {
    const [evenRows] = await pools.node1.query('SELECT id FROM title_basics WHERE id % 2 = 0 LIMIT 1');
    const [oddRows] = await pools.node1.query('SELECT id FROM title_basics WHERE id % 2 = 1 LIMIT 1');
    
    return {
      even: evenRows[0]?.id || 2,
      odd: oddRows[0]?.id || 1
    };
  } catch (err) {
    return { even: 2, odd: 1 }; // fallback
  }
}

// Helper to revoke permission

const nodeConfigs = {
  node1: {
    host: process.env.DB_NODE1_IP,
    user: process.env.DB_ADMIN,
    password: process.env.DB_ADMIN_PASSWORD,
    database: process.env.DB0_NAME,
    port: 3306
  },
  node2: {
    host: process.env.DB_NODE2_IP,
    user: process.env.DB_ADMIN,
    password: process.env.DB_ADMIN_PASSWORD,
    database: process.env.DB1_NAME,
    port: 3306
  },
  node3: {
    host: process.env.DB_NODE3_IP,
    user: process.env.DB_ADMIN,
    password: process.env.DB_ADMIN_PASSWORD,
    database: process.env.DB2_NAME,
    port: 3306
  }
};

const adminPools = {
  node1: mysql.createPool(nodeConfigs.node1),
  node2: mysql.createPool(nodeConfigs.node2),
  node3: mysql.createPool(nodeConfigs.node3)
};

async function runOnNode(node, sql, params = []) {
  const pool = adminPools[node];
  
  if (!pool) throw new Error('Unknown node: ' + node);

  try {
    const [res] = await pool.query(sql, params);
    return res;
  } 
  catch(err) {
    console.log(`Error in running on node ${node}: `, err);
  }
}

async function revokeAll(node) {
  // revoke insert/update/delete (simulate write failures)
  await runOnNode(node, "REVOKE  SELECT, INSERT, UPDATE, DELETE ON mco_2.* FROM 'mco2-user'@'%'");
  await runOnNode(node, "FLUSH PRIVILEGES");
}

async function grantAll(node) {
  await runOnNode(node, "GRANT SELECT, INSERT, UPDATE, DELETE ON mco_2.* TO 'mco2-user'@'%'");
  await runOnNode(node, "FLUSH PRIVILEGES");
}

async function revokeWrites(node) {
  // Revoke only write privileges to simulate write failures while keeping SELECT/ping available
  await runOnNode(node, "REVOKE INSERT, UPDATE, DELETE ON mco_2.title_basics FROM 'mco2-user'@'%'");
  await runOnNode(node, "FLUSH PRIVILEGES");
}

async function revokeSelect(node) {
  // Revoke SELECT to make the node appear unreachable to the application (SELECT 1 will fail)
  await runOnNode(node, "REVOKE SELECT ON mco_2.* FROM 'mco2-user'@'%'");
  await runOnNode(node, "FLUSH PRIVILEGES");
}

// // Example usage (run with ADMIN env vars set)
// if (require.main === module) {
//   (async () => {
//     try {
//       await revokeWrites('node2');   // simulate node2 write failure
//       // await revokeSelect('node1'); // simulate central unreachable
//       // await grantAll('node2');     // restore node2
//       console.log('done');
//     } catch (e) {
//       console.error(e);
//     }
//   })();



/*
Case #1: When attempting to replicate the transaction from Node 2 or Node 3 to the central node, 
the transaction fails in writing (insert / update) to the central node.
*/
async function runCase1() {
  // Case 1: Node2/Node3 -> Central write fails (central SELECT revoked)
  const nodeStates = [];
  const replicationLog = [];

  // mark central as unreachable for pings
  await revokeSelect('node1');
  nodeStates.push({ nodeId: 'node1', status: 'SELECT_REVOKED', result: null });

  // const ids = await getTestMovieIds();
  const tests = [
    { src: 'node2', id: 132710 },
    { src: 'node3', id: 108531 }
  ];

  for (const t of tests) {
    const [rows] = await pools[t.src].query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [t.id]);
    const before = rows[0] || null;
    if (!before) {
      replicationLog.push({ transactionId: `${t.src}-${t.id}`, operation: 'UPDATE', node: t.src, status: 'SKIPPED_NO_ROW' });
      continue;
    }

    const newTitle = (before.primaryTitle || '') + ' - RECOVERY_CASE1';
    await pools[t.src].query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [newTitle, t.id]);

    try {
      await replicateOperation(t.src, null, 'UPDATE', t.id, { primaryTitle: newTitle });
      replicationLog.push({ transactionId: `${t.src}-${t.id}`, operation: 'UPDATE', node: 'node1', status: 'OK' });
    } catch (err) {
      // replication failed -> recovery log entry expected
      replicationLog.push({ transactionId: `${t.src}-${t.id}`, operation: 'UPDATE', node: 'node1', status: 'FAILED', message: err.message });
    }

    // collect pending logs created on source
    const pending = await RecoveryLog.getPendingLogs(t.src);
    replicationLog.push({ transactionId: `${t.src}-${t.id}`, operation: 'PENDING_CHECK', node: t.src, status: pending.length ? 'PENDING' : 'NONE', details: pending });

    // revert change so source DB stays clean
    await pools[t.src].query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [before.primaryTitle, t.id]);
  }

  // include source nodes states as normal
  nodeStates.push({ nodeId: 'node2', status: 'OK', result: null });
  nodeStates.push({ nodeId: 'node3', status: 'OK', result: null });

  return { nodeStates, replicationLog };
}

async function runCase2() {
  // Case 2: Central recovers and missed writes should be applied
  const nodeStates = [];
  const replicationLog = [];

  // bring central back
  await grantAll('node1');
  nodeStates.push({ nodeId: 'node1', status: 'GRANTED', result: null });

  const ids = await getTestMovieIds();
  const sources = ['node2', 'node3'];

  for (const src of sources) {
    const beforeResolve = await RecoveryLog.getPendingLogs(src);
    replicationLog.push({ transactionId: `${src}-beforeResolve`, operation: 'PENDING_LIST', node: src, status: beforeResolve.length ? 'PENDING' : 'NONE', details: beforeResolve });

    // attempt to resolve
    try {
      await RecoveryLog.resolvePendingLogs(src, resolvePendingLog);
      replicationLog.push({ transactionId: `${src}-resolve`, operation: 'RESOLVE', node: 'node1', status: 'RESOLVE_ATTEMPTED' });
    } catch (err) {
      replicationLog.push({ transactionId: `${src}-resolve`, operation: 'RESOLVE', node: 'node1', status: 'RESOLVE_FAILED', message: err.message });
    }

    const afterResolve = await RecoveryLog.getPendingLogs(src);
    replicationLog.push({ transactionId: `${src}-afterResolve`, operation: 'PENDING_LIST', node: src, status: afterResolve.length ? 'PENDING' : 'NONE', details: afterResolve });
  }

  // show central state content for the sample ids
  const idsToCheck = [ids.even, ids.odd];
  for (const id of idsToCheck) {
    const [rows] = await pools.node1.query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [id]);
    nodeStates.push({ nodeId: 'node1', status: 'OK', result: rows[0] || null });
  }

  // include source nodes as OK
  nodeStates.push({ nodeId: 'node2', status: 'OK', result: null });
  nodeStates.push({ nodeId: 'node3', status: 'OK', result: null });

  return { nodeStates, replicationLog };
}

async function runCase3() {
  // Case 3: Central -> node2/node3 write fails (nodes unreachable)
  const nodeStates = [];
  const replicationLog = [];

  // make both target nodes unreachable (revoke SELECT)
  await revokeSelect('node2');
  await revokeSelect('node3');
  nodeStates.push({ nodeId: 'node2', status: 'SELECT_REVOKED', result: null });
  nodeStates.push({ nodeId: 'node3', status: 'SELECT_REVOKED', result: null });

  // pick an id that belongs to central -> use even to attempt replicate to node2
  const ids = await getTestMovieIds();
  const useId = ids.even; // deterministic pick

  const [rows] = await pools.node1.query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [useId]);
  const before = rows[0] || null;
  if (before) {
    const newTitle = (before.primaryTitle || '') + ' - RECOVERY_CASE3';
    await pools.node1.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [newTitle, useId]);

    try {
      await replicateOperation('node1', null, 'UPDATE', useId, { primaryTitle: newTitle });
      replicationLog.push({ transactionId: `node1-${useId}`, operation: 'UPDATE', node: 'node2|node3', status: 'OK' });
    } catch (err) {
      replicationLog.push({ transactionId: `node1-${useId}`, operation: 'UPDATE', node: 'node2|node3', status: 'FAILED', message: err.message });
    }

    // pending logs should be created on node1
    const pending1 = await RecoveryLog.getPendingLogs('node1');
    replicationLog.push({ transactionId: `node1-pending`, operation: 'PENDING_LIST', node: 'node1', status: pending1.length ? 'PENDING' : 'NONE', details: pending1 });

    // revert central change to keep DB consistent
    await pools.node1.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [before.primaryTitle, useId]);
  } else {
    replicationLog.push({ transactionId: `node1-${useId}`, operation: 'UPDATE', node: 'node1', status: 'SKIPPED_NO_ROW' });
  }

  // central back to OK for display
  nodeStates.push({ nodeId: 'node1', status: 'OK', result: null });

  return { nodeStates, replicationLog };
}

async function runCase4() {
  // Case 4: node2/node3 recover and missed writes should be applied
  const nodeStates = [];
  const replicationLog = [];

  // restore permissions on node2 and node3
  await grantAll('node2');
  await grantAll('node3');
  nodeStates.push({ nodeId: 'node2', status: 'GRANTED', result: null });
  nodeStates.push({ nodeId: 'node3', status: 'GRANTED', result: null });

  // resolve pending logs from central (node1) so central's pending entries are applied to node2/node3
  try {
    const beforePending = await RecoveryLog.getPendingLogs('node1');
    replicationLog.push({ transactionId: 'node1-before', operation: 'PENDING_LIST', node: 'node1', status: beforePending.length ? 'PENDING' : 'NONE', details: beforePending });

    await RecoveryLog.resolvePendingLogs('node1', resolvePendingLog);
    replicationLog.push({ transactionId: 'node1-resolve', operation: 'RESOLVE', node: 'node2|node3', status: 'RESOLVE_ATTEMPTED' });
  } catch (err) {
    replicationLog.push({ transactionId: 'node1-resolve', operation: 'RESOLVE', node: 'node2|node3', status: 'RESOLVE_FAILED', message: err.message });
  }

  const afterPending = await RecoveryLog.getPendingLogs('node1');
  replicationLog.push({ transactionId: 'node1-after', operation: 'PENDING_LIST', node: 'node1', status: afterPending.length ? 'PENDING' : 'NONE', details: afterPending });

  // optionally show a couple of rows on node2/node3 to confirm they received new data
  const ids = await getTestMovieIds();
  const [r2] = await pools.node2.query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [ids.even]);
  const [r3] = await pools.node3.query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [ids.odd]);

  nodeStates.push({ nodeId: 'node2', status: 'OK', result: r2[0] || null });
  nodeStates.push({ nodeId: 'node3', status: 'OK', result: r3[0] || null });

  return { nodeStates, replicationLog };
}

router.get('/simulate/recovery', async (req, res) => {
  const caseNum = Number(req.query.case || req.query.c || 0);
  try {
    let result;
    if (caseNum === 1) result = await runCase1();
    else if (caseNum === 2) result = await runCase2();
    else if (caseNum === 3) result = await runCase3();
    else if (caseNum === 4) result = await runCase4();
    else return res.status(400).json({ error: 'missing or invalid case param (1..4)' });

    return res.json({
      success: true,
      case: caseNum,
      nodeStates: result.nodeStates || [],
      replicationLog: result.replicationLog || []
    });
  } catch (err) {
    console.error('[SIMULATE_RECOVERY] Error running case', caseNum, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// router.get('/simulate/recovery', async (req, res) => {
//   const caseNum = parseInt(req.query.case) || 1;

//   console.log(`[RECOVERY SIMULATION] Running Case ${caseNum}`);

//   try {
//     if (caseNum === 1) {
//       const out = await runCase1();
//       return res.json({ success: true, case: 1, out });
//     }

//     if (caseNum === 2) {
//       // Case 2: central node recovers and missed writes are applied
//       // Restore node1 privileges then resolve pending logs for the sources
//       await grantAll('node1');

//       await RecoveryLog.resolvePendingLogs('node2', resolvePendingLog);
//       await RecoveryLog.resolvePendingLogs('node3', resolvePendingLog);

//       // Show last 10 rows on node1 and pending logs
//       const [rows] = await pools.node1.query('SELECT * FROM title_basics ORDER BY id DESC LIMIT 10');
//       const pending2 = await RecoveryLog.getPendingLogs('node2');
//       const pending3 = await RecoveryLog.getPendingLogs('node3');

//       return res.json({ success: true, case: 2, node1_recent: rows, pending: { node2: pending2, node3: pending3 } });
//     }

//     if (caseNum === 3) {
//       // Case 3: central -> node2/node3 replication fails
//       // Revoke SELECT on nodes so ping fails
//       await revokeSelect('node2');
//       await revokeSelect('node3');

//       // Insert on node1 and attempt replicate
//       const [auto1] = await pools.node1.query("SHOW TABLE STATUS LIKE 'title_basics'");
//       const newId = auto1[0].Auto_increment;
//       const data = { id: newId, titleType: 'movie', primaryTitle: 'RECOVERY_CASE3_CENTRAL', originalTitle: 'RECOVERY', isAdult: 0, startYear: 2025, endYear: null, runtimeMinutes: 88, genres: 'Test' };
//       await pools.node1.query('INSERT INTO title_basics (id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [data.id, data.titleType, data.primaryTitle, data.originalTitle, data.isAdult, data.startYear, data.endYear, data.runtimeMinutes, data.genres]);

//       try {
//         await replicateOperation('node1', null, 'INSERT', data.id, data);
//       } catch (err) {
//         // expected: replication will create pending log on node1
//       }

//       const pending1 = await RecoveryLog.getPendingLogs('node1');
//       return res.json({ success: true, case: 3, created: { node1: data.id }, pending1 });
//     }

//     if (caseNum === 4) {
//       // Case 4: node2/node3 recovers and missed writes are applied (restore privileges and resolve)
//       await grantAll('node2');
//       await grantAll('node3');

//       // Resolve pending logs originating from node1 and others
//       await RecoveryLog.resolvePendingLogs('node1', resolvePendingLog);
//       await RecoveryLog.resolvePendingLogs('node2', resolvePendingLog);
//       await RecoveryLog.resolvePendingLogs('node3', resolvePendingLog);

//       // Return recent states
//       const [n2] = await pools.node2.query('SELECT * FROM title_basics ORDER BY id DESC LIMIT 10');
//       const [n3] = await pools.node3.query('SELECT * FROM title_basics ORDER BY id DESC LIMIT 10');

//       const pending1After = await RecoveryLog.getPendingLogs('node1');

//       return res.json({ success: true, case: 4, node2_recent: n2, node3_recent: n3, pending1After });
//     }

//     return res.status(400).json({ success: false, message: 'Invalid case' });
//   } catch (err) {
//     console.error('[SIMULATE_RECOVERY] Error', err.message);
//     return res.status(500).json({ success: false, error: err.message });
//   }
// });

module.exports = router;