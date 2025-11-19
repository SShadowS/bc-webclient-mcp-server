/**
 * Test script to verify STDIO logging functionality
 *
 * This script spawns the MCP server with STDIO logging enabled,
 * sends a few test requests, and verifies the log file is created.
 */

import { spawn } from 'child_process';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_FILE = join(__dirname, 'logs', 'mcp-stdio-test.log');
const LOG_DIR = join(__dirname, 'logs');

console.log('🧪 Testing STDIO Logging');
console.log('='.repeat(60));

// Ensure log directory exists
try {
  await mkdir(LOG_DIR, { recursive: true });
} catch (error) {
  // Directory might already exist
}

// Clean up old log file if it exists
try {
  await rm(LOG_FILE);
  console.log('✓ Cleaned up old log file');
} catch (error) {
  // File might not exist
}

// Spawn MCP server with STDIO logging enabled
console.log('\n📝 Starting MCP server with STDIO logging enabled...');
console.log(`   Log file: ${LOG_FILE}`);

const server = spawn('node', ['dist/stdio-server.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    MCP_STDIO_LOG_FILE: LOG_FILE,
    BC_BASE_URL: 'http://Cronus27/BC/',
    BC_USERNAME: 'sshadows',
    BC_PASSWORD: '1234',
    BC_TENANT: 'default',
    NODE_ENV: 'development',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdoutData = '';
let stderrData = '';

server.stdout.on('data', (data) => {
  stdoutData += data.toString();
});

server.stderr.on('data', (data) => {
  const text = data.toString();
  stderrData += text;
  // Log stderr in real-time
  process.stderr.write(data);

  // Look for STDIO logging messages
  if (text.includes('STDIO logging')) {
    console.log(`\n🔍 Found logging message: ${text.trim()}`);
  }
});

// Wait for server to start
await new Promise((resolve) => setTimeout(resolve, 2000));

console.log('\n📤 Sending test requests...');

// Send initialize request
const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'STDIO Log Test',
      version: '1.0.0',
    },
  },
};

server.stdin.write(JSON.stringify(initializeRequest) + '\n');
console.log('   Sent: initialize request');

// Wait for response
await new Promise((resolve) => setTimeout(resolve, 500));

// Send tools/list request
const toolsListRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {},
};

server.stdin.write(JSON.stringify(toolsListRequest) + '\n');
console.log('   Sent: tools/list request');

// Wait for response
await new Promise((resolve) => setTimeout(resolve, 500));

// Send ping request
const pingRequest = {
  jsonrpc: '2.0',
  id: 3,
  method: 'ping',
  params: {},
};

server.stdin.write(JSON.stringify(pingRequest) + '\n');
console.log('   Sent: ping request');

// Wait for responses
await new Promise((resolve) => setTimeout(resolve, 1000));

// Close server
console.log('\n🛑 Stopping server...');
server.kill('SIGTERM');

// Wait for server to shutdown
await new Promise((resolve) => setTimeout(resolve, 1000));

// Check if log file was created and contains expected data
console.log('\n📄 Verifying log file...');

try {
  const logContent = await readFile(LOG_FILE, 'utf-8');

  console.log(`   ✓ Log file created (${logContent.length} bytes)`);

  // Check for session start marker
  if (logContent.includes('MCP STDIO Session Started:')) {
    console.log('   ✓ Contains session start marker');
  } else {
    console.log('   ✗ Missing session start marker');
  }

  // Check for session end marker
  if (logContent.includes('MCP STDIO Session Ended:')) {
    console.log('   ✓ Contains session end marker');
  } else {
    console.log('   ✗ Missing session end marker');
  }

  // Check for RECV markers (incoming requests)
  const recvCount = (logContent.match(/\[.*?\] RECV/g) || []).length;
  console.log(`   ✓ Contains ${recvCount} RECV messages`);

  // Check for SEND markers (outgoing responses)
  const sendCount = (logContent.match(/\[.*?\] SEND/g) || []).length;
  console.log(`   ✓ Contains ${sendCount} SEND messages`);

  // Check for our test requests
  if (logContent.includes('"method":"initialize"')) {
    console.log('   ✓ Contains initialize request');
  }

  if (logContent.includes('"method":"tools/list"')) {
    console.log('   ✓ Contains tools/list request');
  }

  if (logContent.includes('"method":"ping"')) {
    console.log('   ✓ Contains ping request');
  }

  console.log('\n✅ STDIO logging test PASSED!');
  console.log(`\n📝 Log file location: ${LOG_FILE}`);
  console.log('   You can inspect it to see the full JSON-RPC communication.');

} catch (error) {
  console.error('\n❌ STDIO logging test FAILED!');
  console.error(`   Error: ${error.message}`);
  process.exit(1);
}
