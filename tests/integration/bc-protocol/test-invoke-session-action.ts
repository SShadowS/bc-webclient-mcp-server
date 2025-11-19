/**
 * Test InvokeSessionAction (Tell Me Dialog)
 *
 * Standalone script to verify InvokeSessionAction with systemAction: 220
 */

import { BCRawWebSocketClient } from './src/connection/clients/BCRawWebSocketClient.js';
import { bcConfig } from './src/core/config.js';

async function test() {
  console.error('═══════════════════════════════════════════════════════════');
  console.error('  Test InvokeSessionAction (Tell Me Dialog)');
  console.error('═══════════════════════════════════════════════════════════\n');

  const { baseUrl, username, password, tenantId } = bcConfig;

  const client = new BCRawWebSocketClient(
    { baseUrl } as any,
    username,
    password,
    tenantId
  );

  try {
    console.error('[1/3] Authenticating and connecting...');
    await client.authenticateWeb();
    await client.connect();
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });
    console.error('✓ Connected\n');

    // Extract role center form
    const fs = await import('fs/promises');
    const openSessionData = JSON.parse(
      await fs.readFile('opensession-response.json', 'utf-8')
    );

    const formHandler = openSessionData.find((h: any) =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    );

    if (!formHandler) {
      throw new Error('No role center form found');
    }

    const ownerFormId = formHandler.parameters[1].ServerId;
    console.error(`[2/3] Triggering Tell Me dialog (systemAction: 220)...`);
    console.error(`     OwnerFormId: ${ownerFormId}\n`);

    // Define predicate to detect dialog
    const isTellMeDialog = (handlers: any[]) => {
      console.error(`[Dialog Debug] Received ${handlers.length} handlers:`);
      handlers.forEach((h, i) => {
        console.error(`  [${i}] ${h.handlerType}`, h.parameters?.[0] || '');
        if (h.handlerType === 'DN.LogicalClientEventRaisingHandler' && h.parameters?.[0] === 'FormToShow') {
          console.error(`      → Caption: "${h.parameters?.[1]?.Caption}"`);
        }
      });

      const formToShow = handlers.find((h: any) =>
        h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
        h.parameters?.[0] === 'FormToShow' &&
        h.parameters?.[1]?.ServerId
      );

      if (formToShow) {
        const formData = formToShow.parameters[1];
        console.error(`[Dialog Debug] Found FormToShow: ServerId=${formData.ServerId}, Caption="${formData.Caption}"`);
        return { matched: true, data: formData };
      }

      return { matched: false };
    };

    // Set up listener FIRST
    console.error('  Setting up event listener for Tell Me dialog...');
    const dialogPromise = client.waitForHandlers(isTellMeDialog, { timeoutMs: 15000 });

    // Trigger Tell Me dialog
    console.error('  Sending InvokeSessionAction (systemAction: 220)...\n');
    void client.invoke({
      interactionName: 'InvokeSessionAction',
      namedParameters: {
        systemAction: 220,
        ownerForm: ownerFormId,
        data: { SearchValue: '' },
      },
      openFormIds: [ownerFormId],
    }).catch(() => {
      // Swallow invoke errors - dialogPromise will timeout if invoke fails
    });

    // Wait for dialog
    let dialogData: any;
    try {
      dialogData = await dialogPromise;
      console.error(`  ✓ Event-driven wait caught Tell Me dialog!\n`);
    } catch (error) {
      console.error(`  ✗ Event-driven wait timeout: ${error}\n`);
      throw new Error('Tell Me dialog did not open');
    }

    console.error('[3/3] Analyzing dialog...\n');
    console.error(`  ServerId: ${dialogData.ServerId}`);
    console.error(`  Caption: "${dialogData.Caption}"`);

    console.error('\n═══════════════════════════════════════════════════════════');
    console.error('✓ SUCCESS! Tell Me dialog opened');
    console.error('═══════════════════════════════════════════════════════════\n');

    await client.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('✗ FAILED:', error);
    await client.disconnect();
    process.exit(1);
  }
}

test();
