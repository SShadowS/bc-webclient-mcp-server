/**
 * Raw WebSocket test to verify BC responds to messages
 */
import WebSocket from 'ws';
import fetch from 'node-fetch';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenant = 'default';

console.log('Step 1: Authenticate via HTTP...');
const loginUrl = `${baseUrl}?tenant=${tenant}`;
const loginPageResponse = await fetch(loginUrl);
const loginPageText = await loginPageResponse.text();

const csrfMatch = loginPageText.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/);
if (!csrfMatch) {
  throw new Error('Could not find CSRF token');
}
const csrfToken = csrfMatch[1];
console.log(`✓ Got CSRF token: ${csrfToken.substring(0, 20)}...`);

const loginFormData = new URLSearchParams();
loginFormData.set('__RequestVerificationToken', csrfToken);
loginFormData.set('username', username);
loginFormData.set('password', password);

const loginResponse = await fetch(loginUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: loginFormData,
  redirect: 'manual',
});

const cookies = loginResponse.headers.raw()['set-cookie'] || [];
const cookieString = cookies.join('; ');
console.log(`✓ Got ${cookies.length} cookies`);

const antiforgery = cookies.find((c) => c.startsWith('.AspNetCore.Antiforgery.'));
const antiforgeryCsrf = antiforgery?.match(/=([^;]+)/)?.[1];
console.log(`✓ Got antiforgery CSRF: ${antiforgeryCsrf?.substring(0, 20)}...`);

console.log('\nStep 2: Connect WebSocket...');
const wsUrl = `ws://Cronus27/BC/csh?ackseqnb=-1&csrftoken=${encodeURIComponent(antiforgeryCsrf)}`;
console.log(`URL: ${wsUrl.substring(0, 100)}...`);

const ws = new WebSocket(wsUrl, {
  headers: {
    Cookie: cookieString,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
});

let messageCount = 0;

ws.on('open', () => {
  console.log('✓ WebSocket connected');
  console.log('\nStep 3: Send OpenSession request...');

  const request = {
    jsonrpc: '2.0',
    method: 'OpenSession',
    params: [{
      clientType: 'WebClient',
      clientVersion: '26.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    }],
    id: 'test-123',
  };

  const message = JSON.stringify(request);
  console.log(`→ Sending: ${message.substring(0, 150)}...`);
  ws.send(message);

  // Timeout after 10 seconds
  setTimeout(() => {
    console.log(`\n✗ No response after 10s (received ${messageCount} messages)`);
    ws.close();
    process.exit(1);
  }, 10000);
});

ws.on('message', (data) => {
  messageCount++;
  const message = data.toString();
  console.log(`\n← Received message ${messageCount}:`);
  console.log(message.substring(0, 500));
  if (message.length > 500) {
    console.log(`... (${message.length} bytes total)`);
  }

  // Parse and check response
  try {
    const response = JSON.parse(message);
    if (response.id === 'test-123') {
      console.log('\n✓ Got OpenSession response!');
      ws.close();
      process.exit(0);
    }
  } catch (e) {
    console.log('(Not JSON or different format)');
  }
});

ws.on('error', (error) => {
  console.error('✗ WebSocket error:', error);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed: ${code} ${reason}`);
});

console.log('Waiting for connection...');
