/**
 * WebSocket Endpoint Discovery Tool
 * Tries common BC WebSocket endpoint paths to find the correct one
 */

import 'dotenv/config';
import WebSocket from 'ws';

const baseHost = (process.env.BC_BASE_URL || '')
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');

const username = process.env.BC_USERNAME || 'user';
const password = process.env.BC_PASSWORD || 'pass';
const tenantId = process.env.BC_TENANT_ID || '';

// Create auth header
const fullUsername = tenantId ? `${tenantId}\\${username}` : username;
const authHeader = Buffer.from(`${fullUsername}:${password}`).toString('base64');

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  BC WebSocket Endpoint Discovery                         ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');
console.log(`Host: ${baseHost}`);
console.log(`User: ${fullUsername}`);
console.log('');
console.log('Testing common endpoint paths...');
console.log('═'.repeat(63));
console.log('');

// Extract base path components
const pathMatch = baseHost.match(/^([^\/]+)(\/.*)?$/);
const host = pathMatch ? pathMatch[1] : baseHost;
const basePath = pathMatch && pathMatch[2] ? pathMatch[2] : '';

// Generate list of endpoints to try
const endpoints = [
  // Standard path with base path
  `ws://${host}${basePath}/ws/connect`,

  // Without base path
  `ws://${host}/ws/connect`,

  // With common instance names
  `ws://${host}/BC/ws/connect`,
  `ws://${host}/BC190/ws/connect`,
  `ws://${host}/BC200/ws/connect`,
  `ws://${host}/BC210/ws/connect`,
  `ws://${host}/BC220/ws/connect`,
  `ws://${host}/BC230/ws/connect`,
  `ws://${host}/BC240/ws/connect`,
  `ws://${host}/BC250/ws/connect`,
  `ws://${host}/BC260/ws/connect`,
  `ws://${host}/BC270/ws/connect`,

  // With clientservice prefix
  `ws://${host}${basePath}/clientservice/ws/connect`,
  `ws://${host}/clientservice/ws/connect`,

  // With common ports
  `ws://${host}:7085${basePath}/ws/connect`,
  `ws://${host}:7085/ws/connect`,
  `ws://${host}:7046${basePath}/ws/connect`,
  `ws://${host}:7046/ws/connect`,

  // With api path
  `ws://${host}${basePath}/api/ws/connect`,
  `ws://${host}/api/ws/connect`,
];

// Remove duplicates
const uniqueEndpoints = [...new Set(endpoints)];

let foundEndpoints = [];
let testedCount = 0;

async function testEndpoint(url) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve({ url, status: 'timeout' });
    }, 3000);

    const ws = new WebSocket(url, {
      headers: {
        'Authorization': `Basic ${authHeader}`
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      if (err.message.includes('404')) {
        resolve({ url, status: '404' });
      } else if (err.message.includes('401')) {
        resolve({ url, status: '401', success: true });
      } else if (err.message.includes('403')) {
        resolve({ url, status: '403', success: true });
      } else if (err.message.includes('ECONNREFUSED')) {
        resolve({ url, status: 'refused' });
      } else if (err.message.includes('ENOTFOUND')) {
        resolve({ url, status: 'dns_error' });
      } else {
        resolve({ url, status: 'error', message: err.message });
      }
    });

    ws.on('open', () => {
      clearTimeout(timeout);
      ws.close();
      resolve({ url, status: 'connected', success: true });
    });

    ws.on('unexpected-response', (req, res) => {
      clearTimeout(timeout);
      resolve({ url, status: res.statusCode, success: res.statusCode < 500 });
    });
  });
}

// Test each endpoint
for (const url of uniqueEndpoints) {
  process.stdout.write(`[${++testedCount}/${uniqueEndpoints.length}] Testing: ${url} ... `);

  const result = await testEndpoint(url);

  if (result.status === '404') {
    console.log('❌ 404 Not Found');
  } else if (result.status === '401') {
    console.log('✅ FOUND! (401 Unauthorized - endpoint exists!)');
    foundEndpoints.push({ ...result, note: 'Endpoint exists but auth may need adjustment' });
  } else if (result.status === '403') {
    console.log('✅ FOUND! (403 Forbidden - endpoint exists!)');
    foundEndpoints.push({ ...result, note: 'Endpoint exists but may need different credentials' });
  } else if (result.status === 'connected') {
    console.log('✅✅ CONNECTED! (WebSocket opened successfully!)');
    foundEndpoints.push({ ...result, note: 'Perfect! This endpoint works!' });
  } else if (result.status === 'refused') {
    console.log('⚠️  Connection refused (port not open)');
  } else if (result.status === 'dns_error') {
    console.log('⚠️  DNS error (host not found)');
  } else if (result.status === 'timeout') {
    console.log('⏱️  Timeout (no response)');
  } else {
    console.log(`⚠️  ${result.status} ${result.message || ''}`);
    if (result.success) {
      foundEndpoints.push(result);
    }
  }
}

console.log('');
console.log('═'.repeat(63));
console.log('');

if (foundEndpoints.length === 0) {
  console.log('❌ No working WebSocket endpoints found!');
  console.log('');
  console.log('Possible causes:');
  console.log('  1. WebSocket endpoint not enabled in BC');
  console.log('  2. Wrong base URL or host name');
  console.log('  3. Firewall blocking WebSocket connections');
  console.log('  4. BC container not exposing WebSocket port');
  console.log('');
  console.log('Next steps:');
  console.log('  • Check BC web client network traffic (F12 → Network → WS)');
  console.log('  • Verify BC server configuration');
  console.log('  • Check container logs: docker logs <container-name>');
  console.log('  • See ENDPOINT-DISCOVERY.md for detailed troubleshooting');
} else {
  console.log('✅ Found working endpoint(s):');
  console.log('');

  foundEndpoints.forEach((result, index) => {
    console.log(`${index + 1}. ${result.url}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Note: ${result.note}`);
    console.log('');
  });

  console.log('To use this endpoint, update your .env file:');
  console.log('');

  const bestEndpoint = foundEndpoints[0];
  const endpointUrl = bestEndpoint.url.replace(/^wss?:\/\//, '');
  const parts = endpointUrl.split('/');
  const hostPart = parts[0];
  const pathParts = parts.slice(1, -2); // Remove /ws/connect

  if (pathParts.length > 0) {
    console.log(`BC_BASE_URL=http://${hostPart}/${pathParts.join('/')}`);
  } else {
    console.log(`BC_BASE_URL=http://${hostPart}`);
  }
}

console.log('');
console.log('═'.repeat(63));
