const mysql = require('mysql2/promise');
const SSH2TunnelManager = require('../services/ssh2TunnelManager');
require('dotenv').config();

// ---------------------------------------------------------------------
// HYBRID CONNECTION SETUP - DIRECT FIRST, SSH FALLBACK
// ---------------------------------------------------------------------
console.log('[INFO] Attempting direct database connections...');

let connectionMode = 'none';
let pools = {
  server0: null,
  server1: null,
  server2: null
};
let tunnelManager = new SSH2TunnelManager();
let sshPools = {
  server0: null,
  server1: null,
  server2: null
};

// Direct connection configurations
const directConfigs = {
  server0: {
    host: '103.231.240.130', // Use IP to force IPv4
    port: 60754,
    user: 'root',
    password: 'y4CUW63BZdM9Jr7QEjnGfxtR',
    database: 'mco2',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 15000,
    acquireTimeout: 15000,
    timeout: 15000
  },
  server1: {
    host: '103.231.240.130', // Use IP to force IPv4
    port: 60755,
    user: 'root',
    password: 'y4CUW63BZdM9Jr7QEjnGfxtR',
    database: 'mco2',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 15000,
    acquireTimeout: 15000,
    timeout: 15000
  },
  server2: {
    host: '103.231.240.130', // Use IP to force IPv4
    port: 60756,
    user: 'root',
    password: 'y4CUW63BZdM9Jr7QEjnGfxtR',
    database: 'mco2',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 15000,
    acquireTimeout: 15000,
    timeout: 15000
  }
};

// SSH tunnel configurations - only for accessible SSH ports
const tunnelConfigs = {
  server0: {
    username: 'root',
    host: '103.231.240.130',
    port: 60454, // This SSH port is accessible
    password: 'y4CUW63BZdM9Jr7QEjnGfxtR',
    dstHost: '10.2.14.54', // Use internal IP instead of localhost
    dstPort: 3306,
    localPort: 3306, // Local port for tunneled MySQL
    user: 'root', // MySQL user
    password: 'y4CUW63BZdM9Jr7QEjnGfxtR', // MySQL password
    database: 'mco2' // MySQL database
  },
  server1: {
    username: 'root',
    host: '103.231.240.130',
    port: 60455, // This SSH port is accessible
    password: 'y4CUW63BZdM9Jr7QEjnGfxtR',
    dstHost: '10.2.14.55',
    dstPort: 3306,
    localPort: 3307, // Different local port to avoid conflicts
    user: 'root', // MySQL user
    database: 'mco2' // MySQL database
  },
  server2: {
    username: 'root',
    host: '103.231.240.130',
    port: 60456, // This SSH port is accessible
    password: 'y4CUW63BZdM9Jr7QEjnGfxtR',
    dstHost: '10.2.14.56', // Use internal IP instead of localhost
    dstPort: 3306,
    localPort: 3308, // Different local port to avoid conflicts
    user: 'root', // MySQL user
    password: 'y4CUW63BZdM9Jr7QEjnGfxtR', // MySQL password
    database: 'mco2' // MySQL database
  }
};

// Test direct connection to a server
async function testDirectConnection(serverName, config) {
  try {
    console.log(`[INFO] Testing direct connection to ${serverName}...`);
    const testConnection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectTimeout: 10000
    });
    await testConnection.ping();
    await testConnection.end();
    console.log(`[SUCCESS] Direct connection to ${serverName} works`);
    return true;
  } catch (error) {
    console.log(`[FAIL] Direct connection to ${serverName}: ${error.message}`);
    return false;
  }
}

// Create SSH tunnel for a server
// Initialize connections with direct first, SSH fallback
async function initializeConnections() {
  try {
    // Test all direct connections first
    console.log('[INFO] Testing direct database connections...');
    const directTests = await Promise.all([
      testDirectConnection('server0', directConfigs.server0),
      testDirectConnection('server1', directConfigs.server1),
      testDirectConnection('server2', directConfigs.server2)
    ]);

    const allDirectConnectionsWork = directTests.every(test => test === true);

    if (allDirectConnectionsWork) {
      console.log('[SUCCESS] All direct connections work - using direct mode');
      connectionMode = 'direct';
      
      // Create direct connection pools
      pools.server0 = mysql.createPool(directConfigs.server0);
      pools.server1 = mysql.createPool(directConfigs.server1);
      pools.server2 = mysql.createPool(directConfigs.server2);
      
    } else {
      console.log('[INFO] Direct connections failed - attempting SSH tunnels...');
      
      try {
        // Try to establish SSH tunnels for accessible servers
        const sshResults = await Promise.allSettled([
          establishSSHTunnel('server0'),
          establishSSHTunnel('server2') // Skip server1 as SSH port 60455 is not accessible
        ]);
        
        let successfulTunnels = 0;
        
        for (const result of sshResults) {
          if (result.status === 'fulfilled') {
            successfulTunnels++;
          }
        }
        
        if (successfulTunnels > 0) {
          console.log(`[SUCCESS] ${successfulTunnels} SSH tunnels established - using hybrid mode`);
          connectionMode = 'ssh';
        } else {
          throw new Error('No SSH tunnels could be established');
        }
        
      } catch (sshError) {
        console.log('[INFO] SSH tunnels failed - falling back to mock data...');
        connectionMode = 'mock';
        initializeMockData();
      }
    }

    console.log(`[INFO] Database connections ready in ${connectionMode} mode`);
    return true;
    
  } catch (error) {
    console.error('[ERROR] Failed to establish any database connections:', error.message);
    console.log('[INFO] Falling back to mock data...');
    connectionMode = 'mock';
    initializeMockData();
    return true;
  }
}

// Establish SSH tunnel for a specific server
async function establishSSHTunnel(serverName) {
  if (!tunnelConfigs[serverName]) {
    throw new Error(`No tunnel configuration for ${serverName}`);
  }
  
  try {
    console.log(`[INFO] Establishing SSH tunnel for ${serverName}...`);
    
    // Create SSH tunnel
    await tunnelManager.createTunnel(serverName, tunnelConfigs[serverName]);
    
    // Test MySQL connection through tunnel
    const mysqlWorking = await tunnelManager.testMySQLThroughTunnel(serverName, {
      localPort: tunnelConfigs[serverName].localPort,
      user: tunnelConfigs[serverName].user,
      password: tunnelConfigs[serverName].password,
      database: tunnelConfigs[serverName].database
    });
    
    if (mysqlWorking) {
      // Create MySQL pool for tunneled connection
      sshPools[serverName] = mysql.createPool({
        host: '127.0.0.1',
        port: tunnelConfigs[serverName].localPort,
        user: tunnelConfigs[serverName].user,
        password: tunnelConfigs[serverName].password,
        database: tunnelConfigs[serverName].database,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0
      });
      
      console.log(`[SUCCESS] SSH tunnel and MySQL pool ready for ${serverName}`);
      return true;
    } else {
      throw new Error(`MySQL connection through tunnel failed for ${serverName}`);
    }
    
  } catch (error) {
    console.error(`[ERROR] Failed to establish SSH tunnel for ${serverName}:`, error.message);
    throw error;
  }
}

// Mock data for testing when connections fail
const mockMovies = [
  {
    tconst: 'tt0000001',
    titleType: 'short',
    primaryTitle: 'Carmencita',
    originalTitle: 'Carmencita',
    isAdult: false,
    startYear: 1894,
    endYear: null,
    runtimeMinutes: 1,
    genres: 'Documentary,Short'
  },
  {
    tconst: 'tt0000002',
    titleType: 'short',
    primaryTitle: 'Le clown et ses chiens',
    originalTitle: 'Le clown et ses chiens',
    isAdult: false,
    startYear: 1892,
    endYear: null,
    runtimeMinutes: 5,
    genres: 'Animation,Short'
  },
  {
    tconst: 'tt0000003',
    titleType: 'short',
    primaryTitle: 'Pauvre Pierrot',
    originalTitle: 'Pauvre Pierrot',
    isAdult: false,
    startYear: 1892,
    endYear: null,
    runtimeMinutes: 4,
    genres: 'Animation,Comedy,Romance'
  }
];

function initializeMockData() {
  pools.mockData = mockMovies;
  console.log('[INFO] Mock data initialized with', mockMovies.length, 'movies');
}

// Utility: choose the fragment based on tconst mod 2
function getFragmentPool(tconst) {
  // In SSH mode, use SSH pools; in direct mode, use direct pools
  const activePools = connectionMode === 'ssh' ? sshPools : pools;
  return Number(tconst.replace(/\D/g, '')) % 2 === 0 ? activePools.server1 : activePools.server2;
}

// Utility: get the main pool (server0) based on connection mode
function getMainPool() {
  return connectionMode === 'ssh' ? sshPools.server0 : pools.server0;
}

// ---------------------------------------------------------------------
// MODEL METHODS
// ---------------------------------------------------------------------

module.exports = {
  // Initialize database connections with direct first, SSH fallback
  async initialize() {
    await initializeConnections();
  },

  // Cleanup connections
  async cleanup() {
    console.log(`[INFO] Cleaning up ${connectionMode} connections...`);
    
    if (connectionMode === 'direct') {
      // Close direct connection pools
      if (pools.server0) await pools.server0.end();
      if (pools.server1) await pools.server1.end();
      if (pools.server2) await pools.server2.end();
    } else if (connectionMode === 'ssh') {
      // Close SSH connection pools
      if (sshPools.server0) await sshPools.server0.end();
      if (sshPools.server1) await sshPools.server1.end();
      if (sshPools.server2) await sshPools.server2.end();
      
      // Close SSH tunnels
      await tunnelManager.closeAllTunnels();
    } else if (connectionMode === 'mock') {
      console.log('[INFO] Cleaning up mock connections...');
      pools.mockData = null;
    }
  },

  // GET ALL (use server0 or mock data)
  async getAll(limit = 500) {
    if (connectionMode === 'mock') {
      console.log('[INFO] Returning mock movie data');
      return pools.mockData.slice(0, Math.min(limit, pools.mockData.length));
    }
    
    const mainPool = getMainPool();
    if (!mainPool) throw new Error('Database not initialized');
    
    const [rows] = await mainPool.query(
      `SELECT * FROM movies LIMIT ?`,
      [limit]
    );
    return rows;
  },

  // GET BY ID (search database or mock data)
  async getById(tconst) {
    if (connectionMode === 'mock') {
      console.log(`[INFO] Searching mock data for tconst: ${tconst}`);
      return pools.mockData.find(movie => movie.tconst === tconst) || null;
    }
    
    const mainPool = getMainPool();
    if (!mainPool) throw new Error('Database not initialized');
    
    // Try server0 first (full table)
    try {
      const [rows] = await mainPool.query(
        `SELECT * FROM movies WHERE tconst = ?`,
        [tconst]
      );
      if (rows.length > 0) return rows[0];
    } catch (err) {
      console.log('[INFO] Server0 unavailable, trying fragments...');
    }

    // Try appropriate fragment
    const fragmentPool = getFragmentPool(tconst);
    if (fragmentPool) {
      const [rows] = await fragmentPool.query(
        `SELECT * FROM movies WHERE tconst = ?`,
        [tconst]
      );
      return rows.length > 0 ? rows[0] : null;
    }
    return null;
  },

  // CREATE (must insert into server0 AND correct fragment)
  async create(data) {
    if (connectionMode === 'mock') {
      console.log('[INFO] Adding to mock data (simulation only)');
      pools.mockData.push(data);
      return data;
    }
    
    const mainPool = getMainPool();
    if (!mainPool) throw new Error('Database not initialized');
    
    const {
      tconst, titleType, primaryTitle, originalTitle,
      isAdult, startYear, endYear, runtimeMinutes, genres
    } = data;

    const fragment = getFragmentPool(tconst);

    // Insert into server0
    await mainPool.query(
      `INSERT INTO movies (tconst, titleType, primaryTitle, originalTitle, 
        isAdult, startYear, endYear, runtimeMinutes, genres)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tconst, titleType, primaryTitle, originalTitle,
       isAdult, startYear, endYear, runtimeMinutes, genres]
    );

    // Insert into correct fragment if available
    if (fragment) {
      await fragment.query(
        `INSERT INTO movies (tconst, titleType, primaryTitle, originalTitle, 
          isAdult, startYear, endYear, runtimeMinutes, genres)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tconst, titleType, primaryTitle, originalTitle,
         isAdult, startYear, endYear, runtimeMinutes, genres]
      );
    }

    return data;
  },

  // UPDATE (must update both central and fragment)
  async update(tconst, data) {
    if (connectionMode === 'mock') {
      console.log('[INFO] Updating mock data (simulation only)');
      const index = pools.mockData.findIndex(movie => movie.tconst === tconst);
      if (index !== -1) {
        pools.mockData[index] = { ...pools.mockData[index], ...data };
        return 1;
      }
      return 0;
    }
    
    const mainPool = getMainPool();
    if (!mainPool) throw new Error('Database not initialized');
    
    const fragment = getFragmentPool(tconst);

    const fields = Object.keys(data)
      .map(key => `${key} = ?`)
      .join(', ');
    const values = Object.values(data);

    // Update server0
    const [result0] = await mainPool.query(
      `UPDATE movies SET ${fields} WHERE tconst = ?`,
      [...values, tconst]
    );

    // Update fragment if available
    if (fragment) {
      await fragment.query(
        `UPDATE movies SET ${fields} WHERE tconst = ?`,
        [...values, tconst]
      );
    }

    return result0.affectedRows;
  },

  // DELETE (delete from server0 and fragment)
  async delete(tconst) {
    if (connectionMode === 'mock') {
      console.log('[INFO] Deleting from mock data (simulation only)');
      const index = pools.mockData.findIndex(movie => movie.tconst === tconst);
      if (index !== -1) {
        pools.mockData.splice(index, 1);
        return 1;
      }
      return 0;
    }
    
    const mainPool = getMainPool();
    if (!mainPool) throw new Error('Database not initialized');
    
    const fragment = getFragmentPool(tconst);

    const [result0] = await mainPool.query(
      `DELETE FROM movies WHERE tconst = ?`,
      [tconst]
    );

    // Delete from fragment if available
    if (fragment) {
      await fragment.query(
        `DELETE FROM movies WHERE tconst = ?`,
        [tconst]
      );
    }

    return result0.affectedRows;
  },

  // SEARCH (always use Server0 - has full data)
  async getByParameters(params) {
    if (connectionMode === 'mock') {
      console.log('[INFO] Searching mock data');
      return pools.mockData.filter(movie => {
        return Object.entries(params).every(([key, value]) => {
          return movie[key] && movie[key].toString().toLowerCase().includes(value.toLowerCase());
        });
      }).slice(0, 500);
    }
    
    const mainPool = getMainPool();
    if (!mainPool) throw new Error('Database not initialized');
    
    const filters = [];
    const values = [];

    Object.entries(params).forEach(([key, value]) => {
      filters.push(`${key} LIKE ?`);
      values.push(`%${value}%`);
    });

    const whereClause = filters.length > 0
      ? `WHERE ` + filters.join(' AND ')
      : '';

    const [rows] = await mainPool.query(
      `SELECT * FROM movies ${whereClause} LIMIT 500`,
      values
    );

    return rows;
  }
};
