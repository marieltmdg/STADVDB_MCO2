const mysql = require('mysql2/promise');
require('dotenv').config();

// Database connection configurations
const servers = [
  {
    name: 'Server 0 (Full Table)',
    host: process.env.DB0_HOST,
    port: process.env.DB0_PORT,
    user: process.env.DB0_USER,
    password: process.env.DB0_PASS,
    database: process.env.DB0_NAME
  },
  {
    name: 'Server 1 (Fragment)',
    host: process.env.DB1_HOST,
    port: process.env.DB1_PORT,
    user: process.env.DB1_USER,
    password: process.env.DB1_PASS,
    database: process.env.DB1_NAME
  },
  {
    name: 'Server 2 (Fragment)',
    host: process.env.DB2_HOST,
    port: process.env.DB2_PORT,
    user: process.env.DB2_USER,
    password: process.env.DB2_PASS,
    database: process.env.DB2_NAME
  }
];

async function checkServerHealth(server) {
  try {
    const connection = await mysql.createConnection({
      host: server.host,
      port: server.port,
      user: server.user,
      password: server.password,
      database: server.database,
      connectTimeout: 5000
    });
    
    await connection.ping();
    await connection.end();
    
    return {
      status: 'OK',
      message: 'Connected successfully'
    };
  } catch (error) {
    return {
      status: 'FAIL',
      message: error.message
    };
  }
}

async function checkAllServers() {
  console.log('[INFO] Checking database server health...\n');
  
  const results = [];
  
  for (const server of servers) {
    console.log(`Checking ${server.name} (${server.host}:${server.port})...`);
    
    const health = await checkServerHealth(server);
    results.push({
      server: server.name,
      ...health
    });
    
    if (health.status === 'OK') {
      console.log(`  [OK] ${health.message}`);
    } else {
      console.log(`  [FAIL] ${health.message}`);
    }
  }
  
  console.log('\n[DATA] Health Check Summary:');
  const healthy = results.filter(r => r.status === 'OK').length;
  const total = results.length;
  
  console.log(`${healthy}/${total} servers healthy`);
  
  if (healthy === total) {
    console.log('[OK] All servers are healthy!');
  } else if (healthy === 0) {
    console.log('[FAIL] All servers are down!');
    console.log('[INFO] Please check your VPN connection to DLSU cloud.');
  } else {
    console.log('[WARN] Some servers are down!');
  }
  
  return results;
}

// Run if called directly
if (require.main === module) {
  checkAllServers()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Health check failed:', error);
      process.exit(1);
    });
}

module.exports = {
  checkServerHealth,
  checkAllServers
};