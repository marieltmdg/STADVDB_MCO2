const mysql = require('mysql2/promise');
require('dotenv').config();

// Database connection configurations
const servers = [
  {
    name: 'Server 0 (Port 60754)',
    host: process.env.DB0_HOST,
    port: process.env.DB0_PORT,
    user: process.env.DB0_USER,
    password: process.env.DB0_PASS
  },
  {
    name: 'Server 1 (Port 60755)',
    host: process.env.DB1_HOST,
    port: process.env.DB1_PORT,
    user: process.env.DB1_USER,
    password: process.env.DB1_PASS
  },
  {
    name: 'Server 2 (Port 60756)',
    host: process.env.DB2_HOST,
    port: process.env.DB2_PORT,
    user: process.env.DB2_USER,
    password: process.env.DB2_PASS
  }
];

async function exploreServer(server) {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: server.host,
      port: server.port,
      user: server.user,
      password: server.password,
      connectTimeout: 10000
    });
    
    console.log(`\n[INFO] Exploring ${server.name}...`);
    
    // Get databases
    const [databases] = await connection.query('SHOW DATABASES');
    console.log(`\n[DATA] Databases:`);
    databases.forEach(db => {
      if (!['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db.Database)) {
        console.log(`  • ${db.Database}`);
      }
    });
    
    // Check common database names
    const commonDbNames = ['movies_db', 'mco2', 'stadvdb', 'movies'];
    for (const dbName of commonDbNames) {
      try {
        await connection.query(`USE ${dbName}`);
        console.log(`\n[DATA] Tables in '${dbName}':`);
        
        const [tables] = await connection.query('SHOW TABLES');
        if (tables.length === 0) {
          console.log(`  (empty database)`);
        } else {
          for (const table of tables) {
            const tableName = table[`Tables_in_${dbName}`];
            console.log(`  • ${tableName}`);
            
            // Get table info if it's a movies-related table
            if (tableName.toLowerCase().includes('movie')) {
              const [columns] = await connection.query(`DESCRIBE ${tableName}`);
              console.log(`    Columns: ${columns.map(col => col.Field).join(', ')}`);
              
              const [count] = await connection.query(`SELECT COUNT(*) as count FROM ${tableName}`);
              console.log(`    Records: ${count[0].count}`);
            }
          }
        }
      } catch (error) {
        // Database doesn't exist, continue
      }
    }
    
    await connection.end();
    
  } catch (error) {
    console.log(`  [FAIL] Connection failed: ${error.message}`);
    if (connection) await connection.end();
  }
}

async function exploreAllServers() {
  console.log('[INFO] Exploring existing databases on all servers...');
  
  for (const server of servers) {
    await exploreServer(server);
    console.log('\n' + '='.repeat(60));
  }
  
  console.log('\n[OK] Discovery complete!');
  console.log('\n[INFO] Next steps:');
  console.log('1. Update the .env file with the correct database names');
  console.log('2. Update the movie model to use the existing table structure');
  console.log('3. Test the connection with: npm run health');
}

// Run if called directly
if (require.main === module) {
  exploreAllServers()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Exploration failed:', error);
      process.exit(1);
    });
}

module.exports = {
  exploreAllServers,
  exploreServer
};