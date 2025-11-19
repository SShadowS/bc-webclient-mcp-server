/**
 * Test Filter Metadata Caching in BCRawWebSocketClient
 *
 * Verifies the new filter metadata extraction and caching functionality
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { readFileSync } from 'fs';

console.log('═══════════════════════════════════════════════════════════');
console.log('  Filter Metadata Caching Test');
console.log('═══════════════════════════════════════════════════════════\n');

// Load captured LoadForm response handlers
const data = JSON.parse(readFileSync('./dataset-metadata-investigation.json', 'utf-8'));

console.log('Creating BCRawWebSocketClient...');
const client = new BCRawWebSocketClient(
  { baseUrl: 'http://Cronus27/BC' },
  'sshadows',
  '1234',
  'default'
);

console.log('Caching filter metadata for test form...\n');

// Cache metadata from the handlers
const formId = '680'; // Test form ID
const fieldCount = client.cacheFilterMetadata(formId, data);

console.log(`✓ Cached ${fieldCount} fields\n`);

// Test resolution
console.log('Testing field resolution:\n');

const testCases = [
  'Name',
  'No.',
  'Balance (LCY)',
  'Phone No.',
  'City',
  'Invalid Field Name' // Should return null
];

for (const caption of testCases) {
  try {
    const id = client.resolveFilterFieldId(formId, caption);
    if (id) {
      console.log(`  ✓ "${caption}" → ${id}`);
    } else {
      console.log(`  ✗ "${caption}" → NOT FOUND`);
    }
  } catch (error: any) {
    console.log(`  ✗ "${caption}" → ERROR: ${error.message}`);
  }
}

// Verify known mapping from capture
console.log('\nVerifying known mapping from filter pane capture:');
const knownCaption = 'Name';
const knownId = '18_Customer.2';
const resolved = client.resolveFilterFieldId(formId, knownCaption);

if (resolved === knownId) {
  console.log(`  ✓ SUCCESS: "${knownCaption}" → ${knownId}`);
} else {
  console.log(`  ✗ FAILED: "${knownCaption}" → ${resolved} (expected ${knownId})`);
  process.exit(1);
}

// Test getAvailableFilterCaptions
console.log('\nTesting getAvailableFilterCaptions:');
const captions = client.getAvailableFilterCaptions(formId);
if (captions && captions.length > 0) {
  console.log(`  ✓ Found ${captions.length} available filter captions`);
  console.log(`\n  First 10 captions:`);
  captions.slice(0, 10).forEach(c => console.log(`    - ${c}`));
} else {
  console.log(`  ✗ No captions found`);
  process.exit(1);
}

// Test error handling for uncached form
console.log('\nTesting error handling for uncached form:');
try {
  client.resolveFilterFieldId('999', 'Name');
  console.log('  ✗ Should have thrown error for uncached form');
  process.exit(1);
} catch (error: any) {
  if (error.message.includes('not cached')) {
    console.log(`  ✓ Correctly throws error: ${error.message.substring(0, 80)}...`);
  } else {
    console.log(`  ✗ Unexpected error: ${error.message}`);
    process.exit(1);
  }
}

console.log('\n✓ All tests passed!');
