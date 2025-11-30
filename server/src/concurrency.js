// Simple in-memory lock manager for concurrency control
const locks = {};

const IsolationLevel = {
  READ_UNCOMMITTED: 'read_uncommitted',
  READ_COMMITTED: 'read_committed',
  REPEATABLE_READ: 'repeatable_read',
  SERIALIZABLE: 'serializable',
};

function acquireLock(resource, type, txId) {
  if (!locks[resource]) locks[resource] = [];
  // For simplicity, allow only one write lock, multiple read locks
  if (type === 'write') {
    if (locks[resource].length === 0 || locks[resource].every(l => l.type === 'read')) {
      locks[resource] = [{ type, txId }];
      return true;
    }
    return false;
  } else {
    if (locks[resource].every(l => l.type === 'read')) {
      locks[resource].push({ type, txId });
      return true;
    }
    return false;
  }
}

function releaseLock(resource, txId) {
  if (!locks[resource]) return;
  locks[resource] = locks[resource].filter(l => l.txId !== txId);
  if (locks[resource].length === 0) delete locks[resource];
}

function getLocks(resource) {
  return locks[resource] || [];
}

module.exports = {
  IsolationLevel,
  acquireLock,
  releaseLock,
  getLocks,
};
