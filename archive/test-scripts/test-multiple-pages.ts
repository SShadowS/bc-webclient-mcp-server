/**
 * Test script to check multiple page openings and form ID tracking
 */

import { BCSessionConnection } from './src/connection/bc-session-connection.js';
import { HandlerParser } from './src/parsers/handler-parser.js';
import fs from 'fs/promises';

async function testMultiplePages() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Testing Multiple Page Opens - Form ID Tracking');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Create connection
  const connection = new BCSessionConnection({
    baseUrl: 'http://Cronus27/BC/',
    username: 'sshadows',
    password: '1234',
    tenantId: 'default',
    timeout: 30000,
  });

  try {
    // Connect
    console.log('Step 1: Connecting to BC...');
    const connectResult = await connection.connect();
    if (!connectResult.ok) {
      console.error('❌ Connection failed:', connectResult.error);
      return;
    }
    console.log('✓ Connected\n');

    const parser = new HandlerParser();

    // Test Page 21
    console.log('Step 2: Opening Page 21 (Customer Card)...');
    const page21Result = await connection.invoke({
      interactionName: 'OpenForm',
      namedParameters: { Page: '21' },
      callbackId: '0',
    });

    if (!page21Result.ok) {
      console.error('❌ Page 21 failed:', page21Result.error);
      return;
    }

    await fs.writeFile('test-page-21-response.json', JSON.stringify(page21Result.value, null, 2));
    console.log('  ✓ Saved response to test-page-21-response.json');

    const form21 = parser.extractLogicalForm(page21Result.value);
    if (form21.ok) {
      console.log(`  ✓ Page 21 - Caption: "${form21.value.Caption}", CacheKey: "${form21.value.CacheKey}"`);
      console.log(`  ✓ ServerId: "${form21.value.ServerId}"\n`);
    } else {
      console.error('  ❌ Failed to extract LogicalForm:', form21.error);
    }

    // Test Page 22
    console.log('Step 3: Opening Page 22 (Customer List)...');
    const page22Result = await connection.invoke({
      interactionName: 'OpenForm',
      namedParameters: { Page: '22' },
      callbackId: '0',
    });

    if (!page22Result.ok) {
      console.error('❌ Page 22 failed:', page22Result.error);
      return;
    }

    await fs.writeFile('test-page-22-response.json', JSON.stringify(page22Result.value, null, 2));
    console.log('  ✓ Saved response to test-page-22-response.json');

    const form22 = parser.extractLogicalForm(page22Result.value);
    if (form22.ok) {
      console.log(`  ✓ Page 22 - Caption: "${form22.value.Caption}", CacheKey: "${form22.value.CacheKey}"`);
      console.log(`  ✓ ServerId: "${form22.value.ServerId}"\n`);

      if (form22.value.CacheKey !== '22:embedded(False)') {
        console.error(`  ❌ WRONG CacheKey! Expected "22:embedded(False)" but got "${form22.value.CacheKey}"`);
      }
    } else {
      console.error('  ❌ Failed to extract LogicalForm:', form22.error);
    }

    // Test Page 30
    console.log('Step 4: Opening Page 30 (Item Card)...');
    const page30Result = await connection.invoke({
      interactionName: 'OpenForm',
      namedParameters: { Page: '30' },
      callbackId: '0',
    });

    if (!page30Result.ok) {
      console.error('❌ Page 30 failed:', page30Result.error);
      return;
    }

    await fs.writeFile('test-page-30-response.json', JSON.stringify(page30Result.value, null, 2));
    console.log('  ✓ Saved response to test-page-30-response.json');

    const form30 = parser.extractLogicalForm(page30Result.value);
    if (form30.ok) {
      console.log(`  ✓ Page 30 - Caption: "${form30.value.Caption}", CacheKey: "${form30.value.CacheKey}"`);
      console.log(`  ✓ ServerId: "${form30.value.ServerId}"\n`);

      if (form30.value.CacheKey !== '30:embedded(False)') {
        console.error(`  ❌ WRONG CacheKey! Expected "30:embedded(False)" but got "${form30.value.CacheKey}"`);
      }
    } else {
      console.error('  ❌ Failed to extract LogicalForm:', form30.error);
    }

    // Close connection
    console.log('Step 5: Closing connection...');
    await connection.close();
    console.log('✓ Closed\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Test Complete - Check generated JSON files');
    console.log('═══════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testMultiplePages().catch(console.error);
