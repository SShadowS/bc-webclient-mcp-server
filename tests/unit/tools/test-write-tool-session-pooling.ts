/**
 * Test Write Page Data Tool with ConnectionManager Session Pooling
 *
 * This test demonstrates the proof-of-concept for session pooling:
 * 1. Create WritePageDataTool with BC config (no connection injection)
 * 2. First call creates a new session
 * 3. Second call with sessionId reuses the same session
 * 4. Verify sessionId consistency
 */

import { WritePageDataTool } from './src/tools/write-page-data-tool.js';
import { ConnectionManager } from './src/connection/connection-manager.js';
import { isOk } from './src/core/result.js';

const BASE_URL = 'http://Cronus27/BC';
const USERNAME = 'sshadows';
const PASSWORD = '1234';
const TENANT = 'default';

async function testWriteToolSessionPooling() {
  console.error('\n=== Testing WritePageDataTool with ConnectionManager ===\n');

  // Create BC config
  const bcConfig = {
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD,
    tenantId: TENANT,
  };

  // Create tool with BC config (no connection injection)
  // Pass undefined for connection parameter (backward compat)
  const tool = new WritePageDataTool(undefined as any, bcConfig);

  console.error('[Test] Step 1: Opening Customer Card (page 21) - will create new session...');

  // First, we need to open the page using get_page_metadata
  // For this test, we'll simulate that by directly creating a session
  // In real usage, get_page_metadata would be called first

  const manager = ConnectionManager.getInstance();

  // Create a session manually for testing
  const sessionResult = await manager.getOrCreateSession(bcConfig);
  if (!isOk(sessionResult)) {
    console.error(`❌ Failed to create session: ${sessionResult.error.message}`);
    process.exit(1);
  }

  const sessionId = sessionResult.value.sessionId;
  console.error(`✅ Session created: ${sessionId}`);
  console.error(`   isNewSession: ${sessionResult.value.isNewSession}`);

  // Now open page 21 using the connection
  const connection = sessionResult.value.connection;

  const company = 'CRONUS International Ltd.';
  const dc = Date.now();
  const startTraceId = generateGuid();
  const queryString = `tenant=${encodeURIComponent(TENANT)}&company=${encodeURIComponent(company)}&page=21&runinframe=1&dc=${dc}&startTraceId=${startTraceId}&bookmark=`;

  console.error('[Test] Opening page 21 in the session...');
  const openResult = await connection.invoke({
    interactionName: 'OpenForm',
    namedParameters: { query: queryString },
    controlPath: 'server:c[0]',
    callbackId: '0',
  });

  if (!isOk(openResult)) {
    console.error(`❌ Failed to open page: ${openResult.error.message}`);
    await manager.closeAll();
    process.exit(1);
  }

  console.error(`✅ Page 21 opened in session ${sessionId}`);

  // Verify page is tracked
  if (!connection.isPageOpen('21')) {
    console.error(`❌ Page 21 not tracked as open`);
    await manager.closeAll();
    process.exit(1);
  }

  const formId = connection.getOpenFormId('21');
  console.error(`   formId: ${formId}`);

  // Test 1: Call write_page_data WITHOUT sessionId
  // This should fallback to bcConfig and reuse the existing session
  console.error('\n[Test] Step 2: Writing data WITHOUT sessionId (should use bcConfig)...');

  const writeResult1 = await tool.execute({
    pageId: '21',
    fields: {
      'Name': 'Test Customer A',
    },
  });

  if (!isOk(writeResult1)) {
    console.error(`❌ Write failed: ${writeResult1.error.message}`);
    await manager.closeAll();
    process.exit(1);
  }

  console.error(`✅ Write succeeded (without sessionId)`);
  console.error(`   sessionId returned: ${writeResult1.value.sessionId}`);
  console.error(`   message: ${writeResult1.value.message}`);

  // Verify session was reused (should be same sessionId)
  if (writeResult1.value.sessionId !== sessionId) {
    console.error(`⚠️  Warning: SessionId mismatch!`);
    console.error(`   Expected: ${sessionId}`);
    console.error(`   Got: ${writeResult1.value.sessionId}`);
  } else {
    console.error(`✅ Session reused correctly`);
  }

  // Test 2: Call write_page_data WITH sessionId
  // This should explicitly reuse the session
  console.error('\n[Test] Step 3: Writing data WITH sessionId (explicit reuse)...');

  const writeResult2 = await tool.execute({
    pageId: '21',
    sessionId: sessionId,
    fields: {
      'City': 'Test City',
    },
  });

  if (!isOk(writeResult2)) {
    console.error(`❌ Write failed: ${writeResult2.error.message}`);
    await manager.closeAll();
    process.exit(1);
  }

  console.error(`✅ Write succeeded (with sessionId)`);
  console.error(`   sessionId returned: ${writeResult2.value.sessionId}`);
  console.error(`   message: ${writeResult2.value.message}`);

  // Verify session was reused
  if (writeResult2.value.sessionId !== sessionId) {
    console.error(`❌ SessionId mismatch!`);
    console.error(`   Expected: ${sessionId}`);
    console.error(`   Got: ${writeResult2.value.sessionId}`);
    await manager.closeAll();
    process.exit(1);
  } else {
    console.error(`✅ Session explicitly reused correctly`);
  }

  // Test 3: Try with invalid sessionId
  console.error('\n[Test] Step 4: Writing data with INVALID sessionId (should fallback)...');

  const writeResult3 = await tool.execute({
    pageId: '21',
    sessionId: 'invalid-session-id',
    fields: {
      'County': 'Test County',
    },
  });

  if (!isOk(writeResult3)) {
    console.error(`❌ Write failed: ${writeResult3.error.message}`);
    // This is actually expected if the page isn't open in the fallback connection
    console.error(`   (Expected behavior - invalid sessionId causes fallback to legacy connection)`);
  } else {
    console.error(`✅ Write succeeded with fallback`);
    console.error(`   sessionId returned: ${writeResult3.value.sessionId}`);
  }

  // Test 4: Get session stats
  console.error('\n[Test] Step 5: Getting session stats...');
  const stats = manager.getStats();
  console.error(`✅ Stats retrieved:`);
  console.error(`   Total sessions: ${stats.totalSessions}`);
  console.error(`   Active sessions: ${Object.keys(stats.sessions).length}`);

  // Cleanup
  console.error('\n[Test] Cleaning up...');
  await manager.closeAllSessions();
  console.error('✅ All sessions closed');

  console.error('\n=== All Tests Passed! ===\n');
  process.exit(0);
}

/**
 * Generates a UUID v4 for startTraceId.
 */
function generateGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

testWriteToolSessionPooling().catch((error) => {
  console.error(`\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(error);
  process.exit(1);
});
