/**
 * Capture ALL BC Traffic - WebSocket + HTTP
 *
 * Enhanced capture that records:
 * - WebSocket frames (sent & received)
 * - HTTP requests & responses (POST, PUT, PATCH)
 * - Focuses on BC-related traffic
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

const BC_URL = 'http://Cronus27/BC/?tenant=default';
const USERNAME = 'sshadows';
const PASSWORD = '1234';

const OUT_DIR = 'C:\\bc4ubuntu\\Decompiled\\bc-poc';
const WS_FILE = path.join(OUT_DIR, 'captured-websocket.json');
const HTTP_FILE = path.join(OUT_DIR, 'captured-http.json');

const DEFAULT_SELECTOR_TIMEOUT = 15000;

function ensureOutDir() {
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }
}

function maybeParseJSON(text) {
  if (typeof text !== 'string') return { ok: false };
  const t = text.trim();
  if (!t || (!t.startsWith('{') && !t.startsWith('['))) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false };
  }
}

function nowISO() {
  return new Date().toISOString();
}

async function attachNetworkCapture(page) {
  const context = page.context();
  const cdpSession = await context.newCDPSession(page);

  const socketMeta = new Map();
  const wsMessages = [];
  const httpMessages = [];
  const pendingRequests = new Map();

  await cdpSession.send('Network.enable');

  // ============================================================
  // WebSocket Capture
  // ============================================================

  cdpSession.on('Network.webSocketCreated', ({ requestId, url }) => {
    socketMeta.set(requestId, { url, createdAt: Date.now() });
    console.log(`[WS] Created: ${url}`);
  });

  cdpSession.on('Network.webSocketClosed', ({ requestId }) => {
    const meta = socketMeta.get(requestId);
    console.log(`[WS] Closed: ${meta?.url || requestId}`);
  });

  function recordWsFrame(direction, params) {
    const { requestId, response } = params;
    const { opcode, payloadData, mask } = response || {};
    const meta = socketMeta.get(requestId);

    const record = {
      source: 'websocket',
      direction,
      timestamp: Date.now(),
      iso: nowISO(),
      url: meta?.url,
      opcode,
      masked: Boolean(mask),
      payloadText: (opcode === 1 && typeof payloadData === 'string') ? payloadData : null,
    };

    const parsed = maybeParseJSON(record.payloadText);
    if (parsed.ok) record.payload = parsed.value;

    wsMessages.push(record);

    if (parsed.ok && typeof parsed.value === 'object') {
      const method = parsed.value.method || (parsed.value.result ? 'response' : 'unknown');
      const arrow = direction === 'sent' ? '→' : '←';
      console.log(`[${arrow}] WS ${method}`);
    }
  }

  cdpSession.on('Network.webSocketFrameReceived', (params) => {
    try {
      recordWsFrame('received', params);
    } catch (err) {
      console.warn('[CDP] WS FrameReceived error:', err);
    }
  });

  cdpSession.on('Network.webSocketFrameSent', (params) => {
    try {
      recordWsFrame('sent', params);
    } catch (err) {
      console.warn('[CDP] WS FrameSent error:', err);
    }
  });

  // ============================================================
  // HTTP Capture
  // ============================================================

  cdpSession.on('Network.requestWillBeSent', ({ requestId, request }) => {
    const { url, method, postData } = request;

    // Only capture interesting requests (POST, PUT, PATCH to BC)
    if (!url.includes('Cronus27') && !url.includes('BC/')) return;
    if (method === 'GET' || method === 'OPTIONS') return;

    const record = {
      source: 'http',
      direction: 'request',
      timestamp: Date.now(),
      iso: nowISO(),
      requestId,
      method,
      url,
      postData: postData || null,
    };

    // Try to parse POST data as JSON
    if (postData) {
      const parsed = maybeParseJSON(postData);
      if (parsed.ok) record.postDataParsed = parsed.value;
    }

    pendingRequests.set(requestId, record);
    console.log(`[→] HTTP ${method} ${url.substring(0, 80)}`);
  });

  cdpSession.on('Network.responseReceived', ({ requestId, response }) => {
    const request = pendingRequests.get(requestId);
    if (!request) return;

    const { status, statusText, url, mimeType } = response;

    const record = {
      ...request,
      responseStatus: status,
      responseStatusText: statusText,
      responseMimeType: mimeType,
    };

    // We'll get the response body in loadingFinished
    pendingRequests.set(requestId, record);
    console.log(`[←] HTTP ${status} ${url.substring(0, 80)}`);
  });

  cdpSession.on('Network.loadingFinished', async ({ requestId }) => {
    const record = pendingRequests.get(requestId);
    if (!record) return;

    try {
      const result = await cdpSession.send('Network.getResponseBody', { requestId });
      if (result.body) {
        const parsed = maybeParseJSON(result.body);
        if (parsed.ok) {
          record.responseBody = parsed.value;
        } else {
          // Store as text if not too large
          if (result.body.length < 10000) {
            record.responseBodyText = result.body;
          } else {
            record.responseBodyText = `[truncated ${result.body.length} bytes]`;
          }
        }
      }
    } catch (err) {
      // Response body not available (e.g., redirect)
    }

    httpMessages.push(record);
    pendingRequests.delete(requestId);
  });

  return { cdpSession, wsMessages, httpMessages };
}

async function loginIfNeeded(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_SELECTOR_TIMEOUT }).catch(() => {});

  const usernameSelector = 'input[name="UserName"], input[name="username"], input[type="email"]';
  const passwordSelector = 'input[name="Password"], input[type="password"]';
  const submitSelector = 'button[type="submit"], button:has-text("Sign in"), input[type="submit"]';

  const hasPasswordField = (await page.locator(passwordSelector).count()) > 0;

  if (hasPasswordField) {
    console.log('Logging in...');
    await page.locator(usernameSelector).fill(USERNAME, { timeout: DEFAULT_SELECTOR_TIMEOUT }).catch(() => {});
    await page.locator(passwordSelector).fill(PASSWORD, { timeout: DEFAULT_SELECTOR_TIMEOUT });
    await page.locator(submitSelector).click({ timeout: DEFAULT_SELECTOR_TIMEOUT });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    console.log('✓ Logged in');
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BC Complete Traffic Capture');
  console.log('  Capturing WebSocket + HTTP traffic');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  ensureOutDir();

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('Attaching network listeners...');
  const { cdpSession, wsMessages, httpMessages } = await attachNetworkCapture(page);

  // CRITICAL: Also attach Playwright's WebSocket listener as fallback
  // This captures WebSockets in iframes and workers that CDP might miss
  page.on('websocket', (ws) => {
    console.log(`[WS] Created: ${ws.url()}`);

    ws.on('framesent', (event) => {
      const text = event.payload;
      const parsed = maybeParseJSON(text);
      const record = {
        source: 'websocket',
        direction: 'sent',
        timestamp: Date.now(),
        iso: nowISO(),
        url: ws.url(),
        opcode: 1,
        masked: true,
        payloadText: text,
      };
      if (parsed.ok) record.payload = parsed.value;
      wsMessages.push(record);

      if (parsed.ok && typeof parsed.value === 'object') {
        const method = parsed.value.method || 'unknown';
        console.log(`[→] WS ${method}`);
      }
    });

    ws.on('framereceived', (event) => {
      const text = event.payload;
      const parsed = maybeParseJSON(text);
      const record = {
        source: 'websocket',
        direction: 'received',
        timestamp: Date.now(),
        iso: nowISO(),
        url: ws.url(),
        opcode: 1,
        masked: false,
        payloadText: text,
      };
      if (parsed.ok) record.payload = parsed.value;
      wsMessages.push(record);

      if (parsed.ok && typeof parsed.value === 'object') {
        const method = parsed.value.method || (parsed.value.result ? 'response' : 'unknown');
        console.log(`[←] WS ${method}`);
      }
    });
  });

  console.log('✓ Listeners attached (CDP + Playwright WebSocket fallback)');
  console.log('');

  console.log(`Navigating to ${BC_URL}...`);
  await page.goto(BC_URL, { timeout: 30000 });
  await loginIfNeeded(page);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📋 READY TO CAPTURE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Perform these actions in the browser:');
  console.log('  1. Click "Edit" button');
  console.log('  2. Wait 2 seconds');
  console.log('  3. Change "Name" field');
  console.log('  4. Wait 2 seconds');
  console.log('  5. Press Tab or Enter to trigger save');
  console.log('  6. Wait 2 seconds');
  console.log('');
  console.log('Press ENTER when done capturing...');

  // Wait for user input
  await new Promise((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  console.log('');
  console.log('Stopping capture...');

  // Give it a moment for final messages
  await new Promise((r) => setTimeout(r, 2000));

  console.log(`\nCaptured ${wsMessages.length} WebSocket messages`);
  console.log(`Captured ${httpMessages.length} HTTP requests`);

  // Save files
  try {
    writeFileSync(WS_FILE, JSON.stringify(wsMessages, null, 2));
    console.log(`✓ WebSocket saved to: ${WS_FILE}`);
  } catch (err) {
    console.error(`Failed to save WebSocket: ${err.message}`);
  }

  try {
    writeFileSync(HTTP_FILE, JSON.stringify(httpMessages, null, 2));
    console.log(`✓ HTTP saved to: ${HTTP_FILE}`);
  } catch (err) {
    console.error(`Failed to save HTTP: ${err.message}`);
  }

  await browser.close();
  console.log('\n✓ Capture complete');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
