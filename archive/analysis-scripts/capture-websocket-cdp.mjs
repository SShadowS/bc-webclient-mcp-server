/**
 * Capture WebSocket Traffic Using Chrome DevTools Protocol
 *
 * This script uses CDP to capture all WebSocket frames during BC page navigation.
 * It captures both text and binary frames and attempts to parse JSON content.
 * It also includes a Playwright-level WebSocket listener as a fallback in case
 * the socket originates from a worker that the page-level CDP session misses.
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

const BC_URL = 'http://Cronus27/BC/?tenant=default';
const USERNAME = 'sshadows';
const PASSWORD = '1234';

// Output locations
const OUT_DIR = 'C:\\bc4ubuntu\\Decompiled\\bc-poc';
const ALL_MESSAGES_FILE = path.join(OUT_DIR, 'websocket-cdp-capture.json');
const INVOKE_FILE = path.join(OUT_DIR, 'invoke-calls-captured.json');

// Timings
const WAIT_AFTER_UI_ACTION_MS = 4000; // time to allow RPCs after a click
const EXTRA_CAPTURE_AFTER_LAST_ACTION_MS = 5000; // final quiet period before saving and exiting
const DEFAULT_SELECTOR_TIMEOUT = 15000;

function ensureOutDir() {
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }
}

function maybeParseJSON(text) {
  if (typeof text !== 'string') return { ok: false };
  const t = text.trim();
  if (!t) return { ok: false };
  const startsJSON = t.startsWith('{') || t.startsWith('[');
  if (!startsJSON) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false };
  }
}

function nowISO() {
  return new Date().toISOString();
}

async function attachCdpNetworkListeners(page) {
  const context = page.context();
  const cdpSession = await context.newCDPSession(page);

  // Map requestId -> { url, createdAt }
  const socketMeta = new Map();

  // Collected messages: capture both raw and parsed
  const wsMessages = [];

  await cdpSession.send('Network.enable');

  // Helpful logging
  cdpSession.on('Network.webSocketCreated', ({ requestId, url }) => {
    socketMeta.set(requestId, { url, createdAt: Date.now() });
    console.log(`[WS] Created: ${url} (${requestId})`);
  });

  cdpSession.on('Network.webSocketClosed', ({ requestId }) => {
    const meta = socketMeta.get(requestId);
    console.log(`[WS] Closed: ${meta?.url || requestId}`);
  });

  function recordFrame(direction, params) {
    const { requestId, response } = params;
    const { opcode, payloadData, mask } = response || {};
    const meta = socketMeta.get(requestId);
    const url = meta?.url;

    const base = {
      source: 'cdp',
      direction,           // 'sent' | 'received'
      timestamp: Date.now(),
      iso: nowISO(),
      requestId,
      url,
      opcode,              // 1 = text, 2 = binary
      masked: Boolean(mask),
    };

    let payloadText = null;
    let parsed = null;

    if (opcode === 1 && typeof payloadData === 'string') {
      payloadText = payloadData;
      const parseRes = maybeParseJSON(payloadText);
      if (parseRes.ok) parsed = parseRes.value;
    } else {
      // Binary or unknown; keep the raw payload as a best-effort string
      payloadText = typeof payloadData === 'string' ? payloadData : null;
    }

    const record = { ...base, payloadText };
    if (parsed !== null) record.payload = parsed;

    wsMessages.push(record);

    // Lightweight console hint
    if (parsed && typeof parsed === 'object') {
      const method = parsed.method || (parsed.result ? 'response' : 'unknown');
      const arrow = direction === 'sent' ? '→' : '←';
      console.log(`[${arrow}] ${direction} ${method} ${url ? `(${url})` : ''}`);
    }
  }

  cdpSession.on('Network.webSocketFrameReceived', (params) => {
    try {
      recordFrame('received', params);
    } catch (err) {
      console.warn('[CDP] FrameReceived handler error:', err);
    }
  });

  cdpSession.on('Network.webSocketFrameSent', (params) => {
    try {
      recordFrame('sent', params);
    } catch (err) {
      console.warn('[CDP] FrameSent handler error:', err);
    }
  });

  // Also capture frame errors for visibility
  cdpSession.on('Network.webSocketFrameError', ({ requestId, errorMessage }) => {
    const url = socketMeta.get(requestId)?.url;
    console.warn(`[WS] Frame error on ${url || requestId}: ${errorMessage}`);
  });

  return { cdpSession, wsMessages };
}

// Fallback: Playwright's WS listeners (covers worker-originated sockets)
function attachPlaywrightWsFallback(page, wsMessages) {
  page.on('websocket', (ws) => {
    console.log(`[PW] WebSocket open: ${ws.url()}`);

    ws.on('framesent', (event) => {
      const text = event.payload;
      const parsed = maybeParseJSON(text);
      const rec = {
        source: 'playwright',
        direction: 'sent',
        timestamp: Date.now(),
        iso: nowISO(),
        requestId: null,
        url: ws.url(),
        opcode: 1,
        masked: false,
        payloadText: text,
      };
      if (parsed.ok) rec.payload = parsed.value;
      wsMessages.push(rec);
    });

    ws.on('framereceived', (event) => {
      const text = event.payload;
      const parsed = maybeParseJSON(text);
      const rec = {
        source: 'playwright',
        direction: 'received',
        timestamp: Date.now(),
        iso: nowISO(),
        requestId: null,
        url: ws.url(),
        opcode: 1,
        masked: false,
        payloadText: text,
      };
      if (parsed.ok) rec.payload = parsed.value;
      wsMessages.push(rec);
    });

    ws.on('close', () => {
      console.log(`[PW] WebSocket closed: ${ws.url()}`);
    });
  });
}

async function loginIfNeeded(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_SELECTOR_TIMEOUT }).catch(() => {});

  // Detect if a login form is present. We keep this generic.
  const usernameSelector = 'input[name="UserName"], input[name="username"], input[aria-label*="User"], input[placeholder*="User"], input[type="email"]';
  const passwordSelector = 'input[name="Password"], input[aria-label*="Password"], input[placeholder*="Password"], input[type="password"]';
  const submitSelector = 'button[type="submit"], button:has-text("Sign in"), input[type="submit"]';

  const hasPasswordField = (await page.locator(passwordSelector).count()) > 0;

  if (hasPasswordField) {
    console.log('Filling in credentials...');
    // Some pages split username/password across steps; try to fill both if present
    const userField = page.locator(usernameSelector).first();
    if ((await userField.count()) > 0) {
      await userField.fill(USERNAME, { timeout: DEFAULT_SELECTOR_TIMEOUT }).catch(() => {});
    }

    const passField = page.locator(passwordSelector).first();
    await passField.fill(PASSWORD, { timeout: DEFAULT_SELECTOR_TIMEOUT }).catch(() => {});

    const submitBtn = page.locator(submitSelector).first();
    if ((await submitBtn.count()) > 0) {
      await submitBtn.click({ timeout: DEFAULT_SELECTOR_TIMEOUT }).catch(() => {});
    } else {
      // Fallback to pressing Enter
      await page.keyboard.press('Enter').catch(() => {});
    }
  } else {
    console.log('No login form detected; assuming already signed in.');
  }

  // Wait for the BC shell to load
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
}

/**
 * Try to navigate to a page inside the BC shell to trigger "Invoke Navigate".
 * We start with UI clicks and fall back to URL navigation if needed.
 */
async function navigateToBcPage(page, pageId, uiHints = []) {
  console.log(`\n═══ Navigating to Page ${pageId} ═══`);

  // Attempt UI first: click a link/button that contains a hint text
  for (const hint of uiHints) {
    const locator = page.locator(`text=${hint}`).first();
    if ((await locator.count()) > 0) {
      try {
        await locator.click({ timeout: DEFAULT_SELECTOR_TIMEOUT });
        await page.waitForTimeout(WAIT_AFTER_UI_ACTION_MS);
        return;
      } catch {
        // Try next hint
      }
    }
  }

  // Fallback to URL-based navigation
  const url = `http://Cronus27/BC/?tenant=default&page=${pageId}`;
  console.log(`UI hint not found; falling back to URL: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function captureWebSocketTraffic() {
  console.log('Starting WebSocket capture with CDP...\n');

  ensureOutDir();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Attach CDP and PW fallback listeners
  const { wsMessages } = await attachCdpNetworkListeners(page);
  attachPlaywrightWsFallback(page, wsMessages);

  console.log('Navigating to BC...');
  await page.goto(BC_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await loginIfNeeded(page);

  // Navigate using UI (preferred) to trigger Invoke Navigate
  await navigateToBcPage(page, 22, ['Customers', 'Customer List', 'Customers (Page 22)']);

  // Items page
  await navigateToBcPage(page, 31, ['Items', 'Item List', 'Items (Page 31)']);

  // Item Card page
  // If there is a direct "Item Card" entry, the UI click will trigger Navigate. Otherwise, fall back to URL.
  await navigateToBcPage(page, 30, ['Item Card', 'Item Card (Page 30)']);

  // Give some extra time for trailing RPCs
  await page.waitForTimeout(EXTRA_CAPTURE_AFTER_LAST_ACTION_MS);

  // Persist data
  console.log('\nSaving captured WebSocket messages...');
  try {
    writeFileSync(ALL_MESSAGES_FILE, JSON.stringify(wsMessages, null, 2));
    console.log(`Captured ${wsMessages.length} WebSocket frames`);
    console.log(`Saved to: ${ALL_MESSAGES_FILE}`);
  } catch (err) {
    console.error('Failed to save websocket capture:', err);
  }

  const invokeCalls = wsMessages.filter(
    (msg) => msg.direction === 'sent' && msg.payload && msg.payload.method === 'Invoke'
  );

  console.log(`\nFound ${invokeCalls.length} Invoke calls`);
  try {
    writeFileSync(INVOKE_FILE, JSON.stringify(invokeCalls, null, 2));
    console.log(`Invoke calls saved to: ${INVOKE_FILE}`);
  } catch (err) {
    console.error('Failed to save Invoke calls:', err);
  }

  // Print summary of Invoke interactions
  console.log('\n═══ Invoke Interaction Summary ═══');
  invokeCalls.forEach((call, i) => {
    const params = call.payload?.params;
    const interactionName = params?.interaction?.interactionName || 'unknown';
    const namedParams = params?.interaction?.namedParameters || {};
    const formId = params?.interaction?.formId || 'none';
    const controlPath = params?.interaction?.controlPath || 'none';

    console.log(`\n[${i + 1}] ${interactionName}`);
    console.log(`    formId: ${formId}`);
    console.log(`    controlPath: ${controlPath}`);
    console.log(`    namedParameters: ${JSON.stringify(namedParams, null, 4)}`);
  });

  console.log('\nClosing browser…');
  await browser.close();
}

captureWebSocketTraffic().catch((err) => {
  console.error('Fatal error in captureWebSocketTraffic:', err);
  process.exitCode = 1;
});
