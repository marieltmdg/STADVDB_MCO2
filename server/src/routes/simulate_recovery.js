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
  // Revoke SELECT to make the node appear unreachable to the application (SELECT will fail)
  await runOnNode(node, "REVOKE SELECT ON mco_2.* FROM 'mco2-user'@'%'");
  await runOnNode(node, "FLUSH PRIVILEGES");
}

async function captureInitialValues(even, odd) {
    const ids = [even, odd];
    const state = { node1: {}, node2: {}, node3: {} };
    for (const node of ['node1','node2','node3']) {
        for (const id of ids) {
            try {
                const [rows] = await pools[node].query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [id]);
                state[node][id] = rows[0] || null;
            } catch (err) {
                console.error(`[captureInitialValues] ${node} id=${id} ->`, err.message);
                state[node][id] = null;
            }
        }
    }
    return state;
}

// Restore snapshot captured with captureInitialValues
// returns an array of restore results for reporting
async function restoreInitialValues(snapshot) {
    const results = [];
    for (const node of ['node1','node2','node3']) {
        const pool = pools[node];
        if (!pool) continue;
        for (const idStr of Object.keys(snapshot[node] || {})) {
            const id = Number(idStr);
            const saved = snapshot[node][id];
            try {
                if (saved === null) {
                    // originally missing -> delete any test rows
                    const [del] = await pool.query('DELETE FROM title_basics WHERE id = ?', [id]);
                    results.push({ node, id, action: 'DELETE_IF_EXISTS', affectedRows: del.affectedRows });
                    continue;
                }
                // update existing row to match saved values
                const params = [
                    saved.titleType || null,
                    saved.primaryTitle || null,
                    saved.originalTitle || null,
                    saved.isAdult || 0,
                    saved.startYear || null,
                    saved.endYear || null,
                    saved.runtimeMinutes || null,
                    saved.genres || null,
                    id
                ];
                const [res] = await pool.query(
                    'UPDATE title_basics SET titleType = ?, primaryTitle = ?, originalTitle = ?, isAdult = ?, startYear = ?, endYear = ?, runtimeMinutes = ?, genres = ? WHERE id = ?',
                    params
                );
                if (res.affectedRows === 0) {
                    // row missing -> insert using saved values
                    const insertParams = [
                        id,
                        saved.titleType || 'movie',
                        saved.primaryTitle || '',
                        saved.originalTitle || '',
                        saved.isAdult || 0,
                        saved.startYear || null,
                        saved.endYear || null,
                        saved.runtimeMinutes || null,
                        saved.genres || null
                    ];
                    const [ins] = await pool.query(
                        'INSERT INTO title_basics (id, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        insertParams
                    );
                    results.push({ node, id, action: 'INSERT', insertId: ins.insertId || id });
                } else results.push({ node, id, action: 'UPDATE', affectedRows: res.affectedRows });
            } catch (err) {
                console.error(`[restoreInitialValues] ${node} id=${id} ->`, err.message);
                results.push({ node, id, action: 'ERROR', message: err.message });
            }
        }
    }
    return results;
}

/*
Case #1: When attempting to replicate the transaction from Node 2 or Node 3 to the central node, 
the transaction fails in writing (insert / update) to the central node.
*/
async function runCase1(even, odd) {
  // Case 1: Node2/Node3 -> Central write fails
  const nodeStates = [];
  const replicationLog = [];



  // mark central as unreachable for pings
  await revokeAll('node1');
  
  nodeStates.push({ nodeId: 'node1', status: 'REVOKED_ALL', result: null });

  const sources = [
    {src: "node2", id: even}, 
    {src: "node3", id: odd}
  ]

  for (const s of sources) {
    const [rows] = await pools[s.src].query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [s.id]);
    const before = rows[0] || null;
    if (!before) {
      replicationLog.push({ transactionId: `${s.src}-${s.id}`, operation: 'UPDATE', node: s.src, status: 'SKIPPED_NO_ROW' });
      continue;
    }

    const newTitle = (before.primaryTitle || '') + ' - RECOVERY_CASE1';
    await pools[s.src].query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [newTitle, s.id]);

    // send full row so replication/insert preserves all fields
    const after = { ...before, primaryTitle: newTitle };

    try {
      await replicateOperation(s.src, null, 'UPDATE', s.id, after);
      replicationLog.push({ transactionId: `${s.src}-${s.id}`, operation: 'UPDATE', node: 'node1', status: 'OK' });
    } catch (err) {
      // replication failed -> recovery log entry expected
      replicationLog.push({ transactionId: `${s.src}-${s.id}`, operation: 'UPDATE', node: 'node1', status: 'FAILED', message: err.message });
    }

    // collect pending logs created on source
    const pending = await RecoveryLog.getPendingLogs(s.src);
    replicationLog.push({ transactionId: `${s.src}-${s.id}`, operation: 'PENDING_CHECK', node: s.src, status: pending.length ? 'PENDING' : 'NONE', details: pending });
    
    // revert change so source DB stays clean
    await pools[s.src].query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [before.primaryTitle, s.id]);

    // --- verify node1 didn't get the change; if it did, revert node1 too ---
    try {
      const [node1Rows] = await pools.node1.query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [s.id]);
      const node1Row = node1Rows[0] || null;
      if (node1Row && node1Row.primaryTitle === newTitle) {
        // central has the updated title -> revert to original
        await pools.node1.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [before.primaryTitle, s.id]);
        replicationLog.push({
          transactionId: `node1-revert-${s.src}-${s.id}`,
          operation: 'REVERT',
          node: 'node1',
          status: 'REVERTED',
          details: { from: newTitle, to: before.primaryTitle }
        });
      } else {
        replicationLog.push({
          transactionId: `node1-check-${s.src}-${s.id}`,
          operation: 'VERIFY_NODE1',
          node: 'node1',
          status: node1Row ? 'UNCHANGED' : 'MISSING'
        });
      }
    } catch (err) {
      replicationLog.push({
        transactionId: `node1-check-error-${s.src}-${s.id}`,
        operation: 'VERIFY_NODE1',
        node: 'node1',
        status: 'ERROR',
        message: err.message
      });
    }
  }

  // include source nodes states as normal
  nodeStates.push({ nodeId: 'node2', status: 'OK', result: null });
  nodeStates.push({ nodeId: 'node3', status: 'OK', result: null });

  return { nodeStates, replicationLog };
}

async function runCase2(even, odd) {
  // Case 2: Central recovers and missed writes should be applied
  const nodeStates = [];
  const replicationLog = [];

  // bring central back
  await grantAll('node1');
  nodeStates.push({ nodeId: 'node1', status: 'GRANTED', result: null });

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
  const idsToCheck = [even, odd];
  for (const id of idsToCheck) {
    const [rows] = await pools.node1.query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [id]);
    nodeStates.push({ nodeId: 'node1', status: 'OK', result: rows[0] || null });
  }

  // include source nodes as OK
  nodeStates.push({ nodeId: 'node2', status: 'OK', result: null });
  nodeStates.push({ nodeId: 'node3', status: 'OK', result: null });

  return { nodeStates, replicationLog };
}

async function runCase3(even, odd) {
  // Case 3: Central -> node2/node3 write fails (nodes unreachable)
  const nodeStates = [];
  const replicationLog = [];

  // make both target nodes unreachable
  await revokeAll('node2');
  await revokeAll('node3');

  nodeStates.push({ nodeId: 'node2', status: 'REVOKED_ALL', result: null });
  nodeStates.push({ nodeId: 'node3', status: 'REVOKED_ALL', result: null });

  // test both even and odd ids on central, targeting node2/node3 respectively
  const idsToTest = [even, odd];

  for (const id of idsToTest) {
    const target = (id % 2 === 0) ? 'node2' : 'node3';
    const [rows] = await pools.node1.query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [id]);
    const before = rows[0] || null;

    if (!before) {
      replicationLog.push({ transactionId: `node1-${id}`, operation: 'UPDATE', node: 'node1', status: 'SKIPPED_NO_ROW' });
      continue;
    }

    const newTitle = (before.primaryTitle || '') + ` - RECOVERY_CASE3`;
    await pools.node1.query('UPDATE title_basics SET primaryTitle = ? WHERE id = ?', [newTitle, id]);

    // send full row so replication/insert preserves all fields
    const after = { ...before, primaryTitle: newTitle };  

    try {
      await replicateOperation('node1', null, 'UPDATE', id, after);
      replicationLog.push({ transactionId: `node1-${id}`, operation: 'UPDATE', node: target, status: 'OK' });
    } catch (err) {
      replicationLog.push({ transactionId: `node1-${id}`, operation: 'UPDATE', node: target, status: 'FAILED', message: err.message });
    }

    // check pending logs created on central
    const pending1 = await RecoveryLog.getPendingLogs('node1');
    replicationLog.push({ transactionId: `node1-${id}-pending`, operation: 'PENDING_LIST', node: 'node1', status: pending1.length ? 'PENDING' : 'NONE', details: pending1 });
  }

  // central back to OK for display
  nodeStates.push({ nodeId: 'node1', status: 'OK', result: null });

  return { nodeStates, replicationLog };
}

async function runCase4(even, odd) {
  // Case 4: node2/node3 recover and missed writes should be applied
  const nodeStates = [];
  const replicationLog = [];

  // restore permissions on node2 and node3
  await grantAll('node2');
  await grantAll('node3');

  nodeStates.push({ nodeId: 'node2', status: 'GRANTED', result: null });
  nodeStates.push({ nodeId: 'node3', status: 'GRANTED', result: null });

  // capture pending logs on central BEFORE resolving
  const beforePending = await RecoveryLog.getPendingLogs('node1');
  replicationLog.push({
    transactionId: 'node1-before',
    operation: 'PENDING_LIST',
    node: 'node1',
    status: beforePending.length ? 'PENDING' : 'NONE',
    details: beforePending
  });

  // resolve pending logs from central (node1) -> node2/node3
  try {
    await RecoveryLog.resolvePendingLogs('node1', resolvePendingLog);
    replicationLog.push({ transactionId: 'node1-resolve', operation: 'RESOLVE', node: 'node2|node3', status: 'RESOLVE_ATTEMPTED' });
  } catch (err) {
    replicationLog.push({ transactionId: 'node1-resolve', operation: 'RESOLVE', node: 'node2|node3', status: 'RESOLVE_FAILED', message: err.message });
  }

  // capture pending logs on central AFTER resolving
  const afterPending = await RecoveryLog.getPendingLogs('node1');
  replicationLog.push({
    transactionId: 'node1-after',
    operation: 'PENDING_LIST',
    node: 'node1',
    status: afterPending.length ? 'PENDING' : 'NONE',
    details: afterPending
  });

  // Verify that node2 has the even id and node3 has the odd id after recovery
  const evenId = (typeof even !== 'undefined') ? even : (await getTestMovieIds()).even;
  const oddId = (typeof odd !== 'undefined') ? odd : (await getTestMovieIds()).odd;

  const [r2] = await pools.node2.query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [evenId]);
  const [r3] = await pools.node3.query('SELECT * FROM title_basics WHERE id = ? LIMIT 1', [oddId]);

  nodeStates.push({ nodeId: 'node2', status: 'OK', result: r2[0] || null });
  nodeStates.push({ nodeId: 'node3', status: 'OK', result: r3[0] || null });

  // Add verification entries to replication log
  replicationLog.push({
    transactionId: `node2-${evenId}`,
    operation: 'VERIFY',
    node: 'node2',
    status: r2[0] ? 'PRESENT' : 'MISSING',
    details: r2[0] || null
  });
  replicationLog.push({
    transactionId: `node3-${oddId}`,
    operation: 'VERIFY',
    node: 'node3',
    status: r3[0] ? 'PRESENT' : 'MISSING',
    details: r3[0] || null
  });

  return { nodeStates, replicationLog };
}

router.get('/simulate/recovery', async (req, res) => {
  const caseNum = Number(req.query.case || req.query.c || 0);
  try {
    let result;   
      // Reset grants

    // const {even, odd} = await getTestMovieIds();
    const even = 132710;
    const odd = 108531;
    if (caseNum === 1) {
      await grantAll('node1');
      await grantAll('node2');
      await grantAll('node3');    
      result = await runCase1(even, odd); 
    }
    else if (caseNum === 2) result = await runCase2(even, odd);
    else if (caseNum === 3) {
      await grantAll('node1');
      await grantAll('node2');
      await grantAll('node3');   
      result = await runCase3(even, odd);
    }
    else if (caseNum === 4) result = await runCase4(even, odd);
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