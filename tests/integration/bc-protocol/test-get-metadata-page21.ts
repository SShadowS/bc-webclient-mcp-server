/**
 * Test get_page_metadata with Page 21
 *
 * Standalone script to verify get_page_metadata works correctly.
 */

import { BCRawWebSocketClient } from './src/connection/clients/BCRawWebSocketClient.js';
import { bcConfig } from './src/core/config.js';

async function test() {
  console.error('═══════════════════════════════════════════════════════════');
  console.error('  Test get_page_metadata with Page 21');
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
    const companyName = client.getCompanyName() || 'CRONUS Danmark A/S';
    const tenantId = client.getTenantId() || 'default';

    console.error(`[2/3] Opening Page 21 (Customer Card)...`);
    console.error(`     OwnerFormId: ${ownerFormId}`);
    console.error(`     Company: ${companyName}`);
    console.error(`     Tenant: ${tenantId}\n`);

    // Build proper query string for OpenForm (CRITICAL: BC requires 'query' parameter!)
    const dc = Date.now();
    const startTraceId = 'test-' + dc;
    const queryString = `tenant=${encodeURIComponent(tenantId)}&company=${encodeURIComponent(companyName)}&page=21&runinframe=1&dc=${dc}&startTraceId=${startTraceId}&bookmark=`;

    // Define predicate to detect page opening
    const isPageOpened = (handlers: any[]) => {
      console.error(`[Page Open Debug] Received ${handlers.length} handlers:`);
      handlers.forEach((h, i) => {
        console.error(`  [${i}] ${h.handlerType}`, h.parameters?.[0] || '');
      });

      const formToShow = handlers.find((h: any) =>
        h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
        h.parameters?.[0] === 'FormToShow' &&
        h.parameters?.[1]?.ServerId
      );

      if (formToShow) {
        const formData = formToShow.parameters[1];
        console.error(`[Page Open Debug] Found FormToShow: ServerId=${formData.ServerId}, Caption="${formData.Caption}"`);
        return { matched: true, data: formData };
      }

      return { matched: false };
    };

    // Set up listener FIRST
    console.error('  Setting up event listener for page opening...');
    const pageDataPromise = client.waitForHandlers(isPageOpened, { timeoutMs: 15000 });

    // Open page 21 with CORRECT query parameter format
    console.error('  Sending OpenForm for page 21...');
    console.error(`  Query: ${queryString}\n`);
    void client.invoke({
      interactionName: 'OpenForm',
      namedParameters: { query: queryString },
      controlPath: 'server:c[0]',
      openFormIds: [ownerFormId],
    }).catch(() => {
      // Swallow invoke errors - pageDataPromise will timeout if invoke fails
    });

    // Wait for page to open
    let pageData: any;
    try {
      pageData = await pageDataPromise;
      console.error(`  ✓ Event-driven wait caught page opening!\n`);
    } catch (error) {
      console.error(`  ✗ Event-driven wait timeout: ${error}\n`);
      throw new Error('Page 21 did not open');
    }

    console.error('[3/3] Analyzing page metadata...\n');
    console.error(`  ServerId: ${pageData.ServerId}`);
    console.error(`  Caption: "${pageData.Caption}"`);
    console.error(`  PageType: ${pageData.PageType || 'N/A'}`);

    // Extract fields
    const logicalForm = pageData;
    if (logicalForm.LogicalFormFields) {
      console.error(`  Fields: ${logicalForm.LogicalFormFields.length}`);
      console.error(`  Sample fields:`);
      logicalForm.LogicalFormFields.slice(0, 5).forEach((field: any) => {
        console.error(`    - ${field.ControlPath}: ${field.Caption || field.DataField || 'N/A'}`);
      });
    }

    // Extract actions
    if (logicalForm.LogicalFormActions) {
      console.error(`  Actions: ${logicalForm.LogicalFormActions.length}`);
    }

    console.error('\n═══════════════════════════════════════════════════════════');
    console.error('✓ SUCCESS! Page 21 metadata retrieved');
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
