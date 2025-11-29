const { Client } = require('ssh2');
const mysql = require('mysql2/promise');
const net = require('net');

class SSH2TunnelManager {
  constructor() {
    this.connections = new Map();
    this.tunnels = new Map();
    this.servers = new Map();
  }

  // Create SSH tunnel using ssh2 library with proper local port forwarding
  async createTunnel(serverName, sshConfig) {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const localPort = sshConfig.localPort;
      
      console.log(`[INFO] Creating SSH tunnel for ${serverName} on local port ${localPort}...`);
      
      client.on('ready', () => {
        console.log(`[INFO] SSH connection ready for ${serverName}`);
        
        // Create a local server to handle the tunnel
        const server = net.createServer((localSocket) => {
          // For each local connection, create a forwarded connection through SSH
          client.forwardOut(
            '127.0.0.1', // source IP
            0,           // source port (0 = any)
            sshConfig.dstHost || '127.0.0.1', // destination IP on remote server
            sshConfig.dstPort || 3306,        // destination port on remote server
            (err, stream) => {
              if (err) {
                console.error(`[ERROR] Port forwarding failed for ${serverName}:`, err.message);
                localSocket.end();
                return;
              }
              
              // Pipe the local socket to the SSH stream and vice versa
              localSocket.pipe(stream).pipe(localSocket);
              
              localSocket.on('error', (err) => {
                console.error(`[ERROR] Local socket error for ${serverName}:`, err.message);
                stream.end();
              });
              
              stream.on('error', (err) => {
                console.error(`[ERROR] SSH stream error for ${serverName}:`, err.message);
                localSocket.end();
              });
            }
          );
        });
        
        // Listen on the local port
        server.listen(localPort, '127.0.0.1', () => {
          console.log(`[SUCCESS] SSH tunnel established for ${serverName} on local port ${localPort}`);
          
          // Store the client and server
          this.connections.set(serverName, client);
          this.servers.set(serverName, server);
          
          resolve({ client, server, localPort });
        });
        
        server.on('error', (err) => {
          console.error(`[ERROR] Local server error for ${serverName}:`, err.message);
          client.end();
          reject(err);
        });
      });
      
      client.on('error', (err) => {
        console.error(`[ERROR] SSH connection failed for ${serverName}:`, err.message);
        reject(err);
      });
      
      // Connect with configuration
      const connectionConfig = {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        password: sshConfig.password,
        readyTimeout: 20000,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3
      };
      
      console.log(`[INFO] Connecting to SSH for ${serverName} at ${sshConfig.host}:${sshConfig.port}...`);
      client.connect(connectionConfig);
    });
  }

  // Test MySQL connection through SSH tunnel
  async testMySQLThroughTunnel(serverName, mysqlConfig) {
    try {
      console.log(`[INFO] Testing MySQL connection through SSH tunnel for ${serverName}...`);
      
      // Wait a moment for the tunnel to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Create a direct MySQL connection to the tunneled endpoint
      const connection = await mysql.createConnection({
        host: '127.0.0.1',
        port: mysqlConfig.localPort,
        user: mysqlConfig.user,
        password: mysqlConfig.password,
        database: mysqlConfig.database,
        connectTimeout: 10000
      });
      
      await connection.ping();
      await connection.end();
      
      console.log(`[SUCCESS] MySQL connection through tunnel works for ${serverName}`);
      return true;
    } catch (error) {
      console.log(`[FAIL] MySQL connection through tunnel failed for ${serverName}: ${error.message}`);
      return false;
    }
  }

  // Close all tunnels
  async closeAllTunnels() {
    console.log('[INFO] Closing all SSH tunnels...');
    
    for (const [serverName, server] of this.servers) {
      try {
        server.close();
        console.log(`[INFO] Closed local server for ${serverName}`);
      } catch (error) {
        console.error(`[ERROR] Failed to close local server for ${serverName}:`, error.message);
      }
    }
    
    for (const [serverName, client] of this.connections) {
      try {
        client.end();
        console.log(`[INFO] Closed SSH connection for ${serverName}`);
      } catch (error) {
        console.error(`[ERROR] Failed to close SSH connection for ${serverName}:`, error.message);
      }
    }
    
    this.connections.clear();
    this.servers.clear();
  }

  // Get active tunnel info
  getTunnelInfo() {
    const info = {};
    for (const [serverName] of this.connections) {
      info[serverName] = {
        connected: true,
        serverName
      };
    }
    return info;
  }
}

module.exports = SSH2TunnelManager;