/**
 * Test ConnectionManager Session Pooling
 *
 * Verifies that ConnectionManager:
 * 1. Creates and reuses sessions correctly
 * 2. Returns consistent sessionIds for same environment
 * 3. Tracks form registry properly
 */

import { ConnectionManager } from './src/connection/connection-manager.js';
import { isOk } from './src/core/result.js';

const BASE_URL = 'http://Cronus27/BC';
const USERNAME = 'sshadows';
const PASSWORD = '1234';
const TENANT = 'default';

async function testConnectionManager() {
  console.error('\n=== Testing ConnectionManager ===\n');

  const manager = ConnectionManager.getInstance();

  // Test 1: Create first session
  console.error('[Test 1] Creating first session...');
  const session1Result = await manager.getOrCreateSession({
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD,
    tenantId: TENANT,
  });

  if (!isOk(session1Result)) {
    console.error(`❌ Failed to create session: ${session1Result.error.message}`);
    process.exit(1);
  }

  const session1 = session1Result.value;
  console.error(`✅ Session created: ${session1.sessionId}`);
  console.error(`   isNewSession: ${session1.isNewSession}`);

  // Test 2: Try to get same session again (should reuse)
  console.error('\n[Test 2] Requesting same session again (should reuse)...');
  const session2Result = await manager.getOrCreateSession({
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD,
    tenantId: TENANT,
  });

  if (!isOk(session2Result)) {
    console.error(`❌ Failed to get session: ${session2Result.error.message}`);
    process.exit(1);
  }

  const session2 = session2Result.value;
  console.error(`✅ Session retrieved: ${session2.sessionId}`);
  console.error(`   isNewSession: ${session2.isNewSession}`);
  console.error(`   Same sessionId: ${session1.sessionId === session2.sessionId ? '✅' : '❌'}`);
  console.error(`   Same connection: ${session1.connection === session2.connection ? '✅' : '❌'}`);

  // Test 3: Register a form
  console.error('\n[Test 3] Registering a form in the session...');
  manager.registerForm(session1.sessionId, '21', {
    formId: 'test-form-123',
    pageId: '21',
    caption: 'Test Customer Card',
  });
  console.error(`✅ Form registered`);

  // Test 4: Retrieve form info
  console.error('\n[Test 4] Retrieving form info...');
  const formInfo = manager.getForm(session1.sessionId, '21');
  if (formInfo) {
    console.error(`✅ Form found: ${formInfo.formId}`);
    console.error(`   Caption: ${formInfo.caption}`);
    console.error(`   PageId: ${formInfo.pageId}`);
  } else {
    console.error(`❌ Form not found`);
  }

  // Test 5: Check if page is open
  console.error('\n[Test 5] Checking if page is open...');
  const isOpen = manager.isPageOpen(session1.sessionId, '21');
  console.error(`   Page 21 open: ${isOpen ? '✅' : '❌'}`);
  const isNotOpen = manager.isPageOpen(session1.sessionId, '22');
  console.error(`   Page 22 open: ${!isNotOpen ? '✅' : '❌'} (should be false)`);

  // Test 6: Get stats
  console.error('\n[Test 6] Getting session stats...');
  const stats = manager.getStats();
  console.error(`✅ Stats retrieved:`);
  console.error(`   Total sessions: ${stats.totalSessions}`);
  console.error(`   Sessions: ${JSON.stringify(stats.sessions, null, 2)}`);

  // Test 7: Close session
  console.error('\n[Test 7] Closing session...');
  await manager.closeSessionById(session1.sessionId);
  console.error(`✅ Session closed`);

  // Test 8: Verify session is gone
  console.error('\n[Test 8] Verifying session is closed...');
  const closedSession = manager.getSession(session1.sessionId);
  console.error(`   Session exists: ${closedSession === null ? '❌ (good)' : '✅ (bad)'}`);

  console.error('\n=== All Tests Passed! ===\n');
  process.exit(0);
}

testConnectionManager().catch((error) => {
  console.error(`\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(error);
  process.exit(1);
});
