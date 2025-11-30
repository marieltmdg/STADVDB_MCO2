const axios = require('axios');
const RecoveryLog = require('./models/recoveryLog');

const replicateToNodes = async (operation, id, data) => {
  const replicateUrls = process.env.REPLICATE_URLS ? process.env.REPLICATE_URLS.split(',').map(url => url.trim()) : [];
  const currentNode = process.env.NODE_ID;
  for (const url of replicateUrls) {
    // Skip replication to self
    if (url.includes(currentNode)) continue;
    // Only allow node1 to replicate to node2/node3, and node2/node3 to replicate to node1

    if (currentNode === 'node2' && !url.includes('node1')) continue;
    if (currentNode === 'node3' && !url.includes('node1')) continue;
    if (currentNode === 'node1' && (url.includes('node2') || url.includes('node3'))) {
      // node1 can replicate to node2 and node3
    } else if (currentNode !== 'node1') {
      // node2/node3 only replicate to node1
      if (!url.includes('node1')) continue;
    }
    // Enforce fragmentation rule based on URL
    let targetNode = '';
    if (url.includes('node2')) targetNode = 'node2';
    if (url.includes('node3')) targetNode = 'node3';
    const isEven = parseInt(id) % 2 === 0;
    if ((targetNode === 'node2' && !isEven) || (targetNode === 'node3' && isEven)) {
      console.log(`[REPLICATION] Skipped ${url} for id=${id} (fragmentation rule)`);
      continue;
    }

    let transactionId;

    try {
      // Log replication attempt
      const opMap = {
        create: 'REPL_INSERT',
        update: 'REPL_UPDATE',
        delete: 'REPL_DELETE'
      };
      const op_type = opMap[operation];
      transactionId = await RecoveryLog.logOperation(op_type, id, null, data);
      // Perform replication
      if (operation === 'create') {
        await axios.post(`${url}/movies`, { ...data, id });
      } else if (operation === 'update') {
        await axios.post(`${url}/movies/${id}`, data);
      } else if (operation === 'delete') {
        await axios.post(`${url}/movies/${id}/delete`);
      }

      console.log(`[REPLICATION] ${operation} for id=${id} sent to ${url}`);

      // Update recovery log as successful
      await RecoveryLog.updateReplicationStatus(transactionId, 'APPLIED');

    } catch (err) {
      console.error(
        `[REPLICATION ERROR] Could not replicate to ${url}:`,
        err.response ? err.response.data : err.message
      );
      if (transactionId) {
        await RecoveryLog.updateReplicationStatus(transactionId, 'FAILED');
      }
    }
  }
};

module.exports = { replicateToNodes };
