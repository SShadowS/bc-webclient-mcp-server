#!/usr/bin/env node
/**
 * Debug script to examine OpenForm response structure
 * and understand where child form IDs are located
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';

async function debugOpenFormResponse() {
  const client = new BCRawWebSocketClient(
    { baseUrl: 'http://Cronus27/BC' },
    'default\\sshadows',
    'Demo123456!',
    'default'
  );

  try {
    console.log('🔐 Authenticating...');
    await client.authenticateWeb();

    console.log('🔌 Connecting to SignalR hub...');
    await client.connect();

    console.log('📋 Opening BC session...');
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '26.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });

    // Test Page 22
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('Testing Page 22 (Customer List)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const response = await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: { Page: '22' },
      controlPath: 'server:c[0]',
      callbackId: '0',
      openFormIds: [],
      lastClientAckSequenceNumber: -1,
    });

    console.log('📦 Response contains', response.length, 'handlers\n');

    // Examine each handler
    response.forEach((handler, index) => {
      console.log(`\nHandler ${index}: ${handler.handlerType}`);

      if (handler.handlerType === 'DN.LogicalClientEventRaisingHandler') {
        console.log('  Event:', handler.parameters[0]);

        if (handler.parameters[0] === 'FormToShow' && handler.parameters[1]) {
          const form = handler.parameters[1];
          console.log('\n  🎯 FormToShow data:');
          console.log('    ServerId:', form.ServerId);
          console.log('    Caption:', form.Caption);
          console.log('    Children:', Array.isArray(form.Children) ? form.Children.length : 'none');

          if (Array.isArray(form.Children)) {
            console.log('\n    🔍 Examining Children:');
            form.Children.forEach((child, childIndex) => {
              console.log(`\n    Child ${childIndex}:`);
              console.log('      Type:', child.t);
              console.log('      ServerId:', child.ServerId);
              console.log('      Caption:', child.Caption);
              console.log('      Visible:', child.Visible);
              console.log('      DelayedControls:', child.DelayedControls ? 'YES' : 'NO');
              console.log('      ExpressionProperties:', child.ExpressionProperties ? 'YES' : 'NO');

              // Check nested Children (BC's actual pattern)
              if (Array.isArray(child.Children)) {
                console.log(`      Nested Children: ${child.Children.length}`);
                child.Children.forEach((nestedChild, nestedIndex) => {
                  console.log(`\n        Nested Child ${nestedIndex}:`);
                  console.log('          Type:', nestedChild.t);
                  console.log('          ServerId:', nestedChild.ServerId);
                  console.log('          Caption:', nestedChild.Caption);
                  console.log('          DelayedControls:', nestedChild.DelayedControls ? 'YES' : 'NO');
                });
              }
            });
          }
        }
      }

      if (handler.handlerType === 'DN.CallbackResponseProperties') {
        const params = handler.parameters?.[0];
        const completedInteractions = params?.CompletedInteractions;
        if (Array.isArray(completedInteractions) && completedInteractions.length > 0) {
          const formId = completedInteractions[0].Result?.value;
          console.log('  📝 FormId from callback:', formId);
        }
      }
    });

    await client.disconnect();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

debugOpenFormResponse();