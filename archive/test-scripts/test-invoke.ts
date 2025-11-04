// Load environment variables from .env file
import 'dotenv/config';

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import type { BCConfig } from './src/types.js';
import * as fs from 'fs/promises';

/**
 * Test invoking a BC action from the role center
 *
 * This demonstrates calling the same action that the browser sends
 * when you click on a role center element.
 */
async function testInvoke() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Business Central Invoke Test                           ║');
  console.log('║  Testing InvokeAction from Role Center                   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Configuration
  const config: BCConfig = {
    tenantId: process.env.BC_TENANT_ID || 'default',
    environment: process.env.BC_ENVIRONMENT || 'production',
    baseUrl: process.env.BC_BASE_URL || 'http://cronus27/BC/',
    companyName: process.env.BC_COMPANY_NAME || undefined,
    azureClientId: process.env.AZURE_CLIENT_ID || '',
    azureTenantId: process.env.AZURE_TENANT_ID || '',
    azureAuthority: process.env.AZURE_AUTHORITY || '',
    roleCenterPageId: parseInt(process.env.ROLE_CENTER_PAGE_ID || '9022', 10)
  };

  const username = process.env.BC_USERNAME || '';
  const password = process.env.BC_PASSWORD || '';

  if (!username || !password) {
    console.error('❌ BC_USERNAME and BC_PASSWORD must be set in .env');
    process.exit(1);
  }

  const client = new BCRawWebSocketClient(config, username, password, config.tenantId);

  try {
    // Step 1: Authenticate
    console.log('Step 1: Authenticating via web login...');
    console.log('─'.repeat(60));
    await client.authenticateWeb();
    console.log('');

    // Step 2: Connect
    console.log('Step 2: Connecting to WebSocket...');
    console.log('─'.repeat(60));
    await client.connect();
    console.log('');

    // Step 3: Open Session
    console.log('Step 3: Opening BC session...');
    console.log('─'.repeat(60));
    const userSettings = await client.openSession({
      clientType: 'WebClient',
      clientVersion: '26.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC'
    });
    console.log('✓ Session opened');
    console.log(`  Company: ${userSettings.companyName}`);
    console.log('');

    // Step 4: Invoke the action from your role center
    console.log('Step 4: Invoking action (opening page 9300)...');
    console.log('─'.repeat(60));

    // This matches the exact action you showed:
    // Opening page 9300 (embedded) from the role center
    const result = await client.invoke({
      interactionName: 'InvokeAction',
      openFormIds: ['4E', '99'],  // Forms currently open
      formId: '3F',  // The form containing the control that was clicked
      controlPath: 'server:c[2]/c[0]/c[0]',  // Path to the control
      namedParameters: {
        systemAction: 0,  // 0 = open/navigate action
        key: null,
        expectedForm: {
          cacheKey: '9300:embedded(False)',
          hash: '6U+ODO3s30A='
        },
        repeaterControlTarget: null
      },
      sequenceNo: 'poc#1',
      lastClientAckSequenceNumber: -1
    });

    console.log('✓ Action invoked successfully!');
    console.log('');
    console.log(`Received ${result.length} handlers:`);

    // Display handler types
    result.forEach((handler: any, i: number) => {
      console.log(`  ${i + 1}. ${handler.handlerType}`);
    });
    console.log('');

    // Save full response for analysis
    await fs.writeFile('invoke-response.json', JSON.stringify(result, null, 2));
    console.log('✓ Full response saved to invoke-response.json');
    console.log('');

    // Try to find interesting data in the response
    console.log('Looking for page data in response...');
    const searchForPageData = (obj: any, depth = 0): void => {
      if (depth > 5) return;  // Limit recursion

      if (Array.isArray(obj)) {
        obj.forEach(item => searchForPageData(item, depth + 1));
      } else if (obj && typeof obj === 'object') {
        // Look for page-related fields
        if (obj.pageId || obj.PageId) {
          console.log(`  Found pageId: ${obj.pageId || obj.PageId}`);
        }
        if (obj.caption || obj.Caption) {
          console.log(`  Found caption: ${obj.caption || obj.Caption}`);
        }
        if (obj.controls || obj.Controls) {
          console.log(`  Found controls array with ${(obj.controls || obj.Controls).length} items`);
        }

        Object.values(obj).forEach(value => searchForPageData(value, depth + 1));
      }
    };

    searchForPageData(result);
    console.log('');

    // Disconnect
    console.log('Step 5: Disconnecting...');
    console.log('─'.repeat(60));
    await client.disconnect();
    console.log('');

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  ✓ Invoke Test Completed Successfully!                  ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

  } catch (error) {
    console.error('\n❌ Error occurred:');
    console.error(error);

    try {
      await client.disconnect();
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    process.exit(1);
  }
}

// Run the test
testInvoke().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
