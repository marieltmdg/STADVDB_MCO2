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


async function resetPool(node) {
    console.log(`[POOL] Resetting pool for ${node}`);

    // End old connections
    if (adminPools[node]) {
        try {
            await adminPools[node].end();
        } catch (err) {
            console.error(`[POOL] Error ending pool for ${node}:`, err.message);
        }
    }

    // Create new pool (fresh privileges)
    adminPools[node] = mysql.createPool(nodeConfigs[node]);

    // Optional wait to ensure new connections initialize
    await new Promise(res => setTimeout(res, 200));
}

async function resetAllPools() {
    for (const node of Object.keys(pools)) {
        await resetPool(node);
    }
}

async function runOnNode(node, sql, params = []) {
  const pool = pools[node];

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
  // simulate failure/crash by revoking all privileges
  await runOnNode(node, "REVOKE  SELECT, INSERT, UPDATE, DELETE ON mco_2.* FROM 'mco2-user'@'%'");
  await runOnNode(node, "FLUSH PRIVILEGES");
  
  // Kill existing connections to force privilege refresh
  try {
    await runOnNode(node, "SELECT CONCAT('KILL ', id, ';') FROM information_schema.processlist WHERE user = 'mco2-user'");
    const [processes] = await adminPools[node].query(
      "SELECT id FROM information_schema.processlist WHERE user = 'mco2-user' AND command != 'Sleep'"
    );
    for (const proc of processes) {
      try {
        await runOnNode(node, `KILL ${proc.id}`);
      } catch (err) {
        // Connection might already be gone
      }
    }
  } catch (err) {
    console.error(`[REVOKE] Error killing connections on ${node}:`, err.message);
  }
  
  // Reset the application pool to force new connections
  if (pools[node]) {
    try {
      await pools[node].end();
      const nodeNum = node.replace('node', '');
      const config = {
        host: process.env[`DB_NODE${nodeNum}_IP`],
        user: process.env.DB_USER,
        password: process.env.DB_USER_PASSWORD,
        database: process.env[`DB${nodeNum === '1' ? '0' : nodeNum === '2' ? '1' : '2'}_NAME`],
        port: 3306
      };
      pools[node] = mysql.createPool(config);
    } catch (err) {
      console.error(`[REVOKE] Error resetting pool for ${node}:`, err.message);
    }
  }
}

async function grantAll(node) {
  await runOnNode(node, "GRANT SELECT, INSERT, UPDATE, DELETE ON mco_2.* TO 'mco2-user'@'%'");
  await runOnNode(node, "FLUSH PRIVILEGES");
  
  // Reset the application pool to pick up new privileges
  if (pools[node]) {
    try {
      await pools[node].end();
      const nodeNum = node.replace('node', '');
      const config = {
        host: process.env[`DB_NODE${nodeNum}_IP`],
        user: process.env.DB_USER,
        password: process.env.DB_USER_PASSWORD,
        database: process.env[`DB${nodeNum === '1' ? '0' : nodeNum === '2' ? '1' : '2'}_NAME`],
        port: 3306
      };
      pools[node] = mysql.createPool(config);
    } catch (err) {
      console.error(`[GRANT] Error resetting pool for ${node}:`, err.message);
    }
  }
}
const SLEEP = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  await sleep(SLEEP); 
  
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

    const newTitle = before.primaryTitle;
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
  await sleep(SLEEP); 

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
  await sleep(SLEEP); 


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

    const newTitle = before.primaryTitle;
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
  await sleep(SLEEP); 


  nodeStates.push({ nodeId: 'node2', status: 'OK', result: null });
  nodeStates.push({ nodeId: 'node3', status: 'OK', result: null });

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

    // central back to OK for display
  nodeStates.push({ nodeId: 'node1', status: 'OK', result: null });


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
      await grantAll("node1");
      await grantAll("node2");
      await grantAll("node3");
      await sleep(SLEEP);
      result = await runCase1(even, odd); 
    }
    else if (caseNum === 2) result = await runCase2(even, odd);
    else if (caseNum === 3) {
      await grantAll("node1");
      await grantAll("node2");
      await grantAll("node3");
      await sleep(SLEEP);
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


module.exports = router;