/**
 * Test to compare raw BC response vs parsed metadata
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { PageMetadataParser } from './src/parsers/page-metadata-parser.js';
import type { BCConfig } from './src/types.js';

async function testParserOutput() {
  console.log('Connecting to BC...');

  const config: BCConfig = {
    baseUrl: 'http://Cronus27/BC',
    wsEndpoint: 'ws://Cronus27/BC'
  };

  const client = new BCRawWebSocketClient(config, 'sshadows', '1234', 'default');

  try {
    await client.authenticateWeb();
    await client.connect();

    // Must open session first
    await client.openSession({
      interactionsToInvoke: []
    });

    console.log('Opening Customer Card (Page 21)...');
    const result = await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: { Page: '21' },
      callbackId: '0'
    });

    if (result.isOk) {
      console.log('\n✅ Got BC response');

      const parser = new PageMetadataParser();
      const metadata = parser.parse(result.value);

      if (metadata.isOk) {
        const json = JSON.stringify(metadata.value, null, 2);

        console.log('\n=== PARSED METADATA (what LLM sees) ===');
        console.log(json);

        console.log('\n=== SIZE COMPARISON ===');
        console.log(`Raw BC response: 729KB`);
        console.log(`Parsed metadata: ${(json.length / 1024).toFixed(2)}KB`);
        console.log(`Reduction: ${(100 - (json.length / (729 * 1024)) * 100).toFixed(1)}%`);

        console.log('\n=== FIELD SUMMARY ===');
        console.log(`Total fields: ${metadata.value.fields.length}`);
        console.log(`Total actions: ${metadata.value.actions.length}`);
        console.log(`Total controls: ${metadata.value.controlCount}`);
      } else {
        console.error('Parse error:', metadata.error);
      }
    } else {
      console.error('Invoke error:', result.error);
    }
  } finally {
    await client.disconnect();
  }
}

testParserOutput().catch(console.error);
