import { BCRawWebSocketClient } from './src/BCRawWebSocketClient';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function main() {
  const config = {
    baseUrl: process.env.BC_BASE_URL || 'http://Cronus27/BC/',
    tenantId: process.env.BC_TENANT || 'default'
  };

  const username = process.env.BC_USERNAME || 'admin';
  const password = process.env.BC_PASSWORD || '';

  console.log('═══════════════════════════════════════════════════════');
  console.log('  BC Page Metadata Extractor - Test Script');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`BC URL: ${config.baseUrl}`);
  console.log(`Tenant: ${config.tenantId}`);
  console.log(`Username: ${username}\n`);

  const client = new BCRawWebSocketClient(config, username, password, config.tenantId);

  try {
    // Step 1: Authenticate
    console.log('[1/4] Authenticating...');
    await client.authenticateWeb();
    console.log('✓ Authentication successful\n');

    // Step 2: Connect WebSocket
    console.log('[2/4] Connecting WebSocket...');
    await client.connect();
    console.log('✓ WebSocket connected\n');

    // Step 3: Open Session
    console.log('[3/4] Opening Session...');
    const sessionInfo = await client.openSession({
      clientType: 'WebClient',
      clientVersion: '26.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC'
    });
    console.log('✓ Session opened');
    console.log(`  Session ID: ${sessionInfo.sessionId}`);
    console.log(`  Company: ${sessionInfo.company}\n`);

    // Step 4: Open Page 21 (Customer Card)
    console.log('[4/4] Opening Customer Card (Page 21)...');
    console.log('  Sending OpenForm interaction with namedParameters: { Page: "21" }');

    const handlers = await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: {
        Page: '21'  // Page ID as string per OpenFormExecutionStrategy.cs:88
      }
    });

    console.log(`✓ Received ${handlers.length} handlers\n`);

    // Create responses directory if it doesn't exist
    const responsesDir = path.join(__dirname, 'responses');
    if (!fs.existsSync(responsesDir)) {
      fs.mkdirSync(responsesDir, { recursive: true });
    }

    // Save full response
    const fullResponsePath = path.join(responsesDir, 'page-21-full-response.json');
    fs.writeFileSync(fullResponsePath, JSON.stringify(handlers, null, 2));
    console.log(`📄 Full response saved to: ${fullResponsePath}\n`);

    // Analyze handlers
    console.log('Handler Analysis:');
    console.log('─────────────────────────────────────────────────────────');

    handlers.forEach((handler: any, i: number) => {
      console.log(`\n${i + 1}. ${handler.handlerType}`);

      if (handler.handlerType === 'DN.CallbackResponseProperties') {
        const props = handler.parameters?.[0];
        console.log(`   SequenceNumber: ${props?.SequenceNumber}`);
        if (props?.CompletedInteractions) {
          props.CompletedInteractions.forEach((ci: any) => {
            console.log(`   - Interaction ${ci.InvocationId}: ${ci.Duration}ms`);
            if (ci.Result) {
              console.log(`     Result: ${JSON.stringify(ci.Result)}`);
            }
          });
        }
      }

      if (handler.handlerType === 'DN.LogicalClientEventRaisingHandler') {
        const eventName = handler.parameters?.[0];
        console.log(`   Event: ${eventName}`);

        if (eventName === 'FormToShow') {
          const metadata = handler.parameters?.[2];
          console.log(`   Cache Key: ${metadata?.CacheKey}`);
          console.log(`   Hash: ${metadata?.Hash}`);
          console.log(`   IsReload: ${metadata?.IsReload}`);

          // Save LogicalForm
          const logicalForm = handler.parameters?.[1];
          if (logicalForm) {
            const logicalFormPath = path.join(responsesDir, 'page-21-logical-form.json');
            fs.writeFileSync(logicalFormPath, JSON.stringify(logicalForm, null, 2));
            console.log(`   📄 LogicalForm saved: ${logicalFormPath}`);

            // Try to extract some basic info
            console.log('\n   LogicalForm Preview:');
            if (logicalForm.caption) {
              console.log(`     Caption: ${logicalForm.caption}`);
            }
            if (logicalForm.name) {
              console.log(`     Name: ${logicalForm.name}`);
            }
            if (logicalForm.formType) {
              console.log(`     Type: ${logicalForm.formType}`);
            }

            // Look for controls
            const controls = findControlsRecursive(logicalForm);
            if (controls.length > 0) {
              console.log(`     Controls found: ${controls.length}`);
              console.log(`     First 5 controls:`);
              controls.slice(0, 5).forEach((c: any) => {
                const name = c.name || c.caption || c.type || 'unknown';
                console.log(`       - ${name}`);
              });
            }
          }
        }
      }

      if (handler.handlerType === 'DN.LogicalClientChangeHandler') {
        const formId = handler.parameters?.[0];
        const changes = handler.parameters?.[1];
        console.log(`   Form ID: ${formId}`);
        if (Array.isArray(changes)) {
          console.log(`   Changes: ${changes.length} items`);
        }
      }

      if (handler.handlerType === 'DN.EmptyPageStackHandler') {
        console.log(`   (No open forms before this)`);
      }
    });

    console.log('\n─────────────────────────────────────────────────────────');

    // Check if we found FormToShow
    const formToShowHandler = handlers.find((h: any) =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    );

    console.log('\n');
    if (formToShowHandler) {
      console.log('✅ SUCCESS: Found FormToShow event!');
      console.log('\nNext Steps:');
      console.log('1. Analyze responses/page-21-logical-form.json to understand structure');
      console.log('2. Build parser for fields, actions, permissions');
      console.log('3. Extract control paths for future interactions');
      console.log('4. Test with other page types (List, Document, etc.)');
    } else {
      console.log('⚠️  FormToShow event not found in response');
      console.log('Review responses/page-21-full-response.json for details');
    }

    // Close connection
    await client.close();
    console.log('\n✓ Connection closed');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Helper function to find controls recursively
function findControlsRecursive(obj: any, depth: number = 0, maxDepth: number = 5): any[] {
  if (depth > maxDepth) return [];

  const controls: any[] = [];

  if (typeof obj !== 'object' || obj === null) {
    return controls;
  }

  // Check if this object is a control
  if (obj.type || obj.controlType || obj.caption || obj.name) {
    controls.push(obj);
  }

  // Check for common control container properties
  const containerProps = ['controls', 'children', 'items', 'repeaterControls', 'fieldGroups'];

  for (const prop of containerProps) {
    if (Array.isArray(obj[prop])) {
      for (const item of obj[prop]) {
        controls.push(...findControlsRecursive(item, depth + 1, maxDepth));
      }
    }
  }

  // Also check all other properties
  for (const key in obj) {
    if (!containerProps.includes(key) && typeof obj[key] === 'object') {
      controls.push(...findControlsRecursive(obj[key], depth + 1, maxDepth));
    }
  }

  return controls;
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
