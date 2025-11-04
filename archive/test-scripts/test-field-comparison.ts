/**
 * Field Comparison: Before and After Intelligent Parser
 *
 * Shows exactly which fields are kept vs filtered out.
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { PageMetadataParser } from './src/parsers/page-metadata-parser.js';
import { IntelligentMetadataParser } from './src/parsers/intelligent-metadata-parser.js';
import type { BCConfig } from './src/types.js';

async function showFieldComparison() {
  console.log('='.repeat(80));
  console.log('Field Comparison: Standard vs Intelligent Parser');
  console.log('='.repeat(80));
  console.log('');

  const config: BCConfig = {
    baseUrl: 'http://Cronus27/BC',
    wsEndpoint: 'ws://Cronus27/BC'
  };

  const client = new BCRawWebSocketClient(config, 'sshadows', '1234', 'default');

  try {
    await client.authenticateWeb();
    await client.connect();
    await client.openSession({ interactionsToInvoke: [] });

    // Get handlers by opening the page
    const openResult = await client.openSession({
      interactionsToInvoke: [{
        interactionName: 'OpenForm',
        namedParameters: { page: '21' }
      }]
    });

    if (!openResult) {
      console.error('Failed to open session');
      return;
    }

    // Parse with both parsers
    const standardParser = new PageMetadataParser();
    const intelligentParser = new IntelligentMetadataParser();

    const standardResult = standardParser.parse(openResult);
    const intelligentResult = intelligentParser.parse(openResult);

    if (!standardResult.isOk || !intelligentResult.isOk) {
      console.error('Parse failed');
      return;
    }

    const standard = standardResult.value;
    const intelligent = intelligentResult.value;

    // Show comparison
    console.log('📄 Page:', standard.caption);
    console.log('');

    console.log('1️⃣  BEFORE (Standard Parser):');
    console.log('-'.repeat(80));
    console.log(`Total fields: ${standard.fields.length}`);
    console.log('');
    console.log('First 30 fields (showing name, type, enabled):');
    console.log('');

    standard.fields.slice(0, 30).forEach((field, idx) => {
      const name = field.caption || field.name || '(unnamed)';
      const enabled = field.enabled ? '✓' : '✗';
      const readonly = field.readonly ? '[RO]' : '[RW]';
      console.log(`  ${(idx + 1).toString().padStart(2)}. ${enabled} ${name.padEnd(35)} ${field.type.padEnd(8)} ${readonly}`);
    });

    if (standard.fields.length > 30) {
      console.log(`  ... and ${standard.fields.length - 30} more fields`);
    }
    console.log('');

    console.log('2️⃣  AFTER (Intelligent Parser):');
    console.log('-'.repeat(80));
    console.log(`Filtered fields: ${intelligent.fields.length} (${((intelligent.fields.length / standard.fields.length) * 100).toFixed(1)}% kept)`);
    console.log('');
    console.log('Fields kept:');
    console.log('');

    intelligent.fields.forEach((field, idx) => {
      const editable = field.editable ? '[EDIT]' : '[READ]';
      const options = field.options ? ` (${field.options.length} options)` : '';
      console.log(`  ${(idx + 1).toString().padStart(2)}. ${field.name.padEnd(35)} ${field.type.padEnd(8)} ${editable}${options}`);
    });
    console.log('');

    // Show what was filtered out
    console.log('3️⃣  FILTERED OUT:');
    console.log('-'.repeat(80));

    const keptNames = new Set(intelligent.fields.map(f => f.name));
    const filteredOut = standard.fields.filter(f => {
      const name = f.caption || f.name || '';
      return !keptNames.has(name);
    });

    console.log(`Removed ${filteredOut.length} fields (${((filteredOut.length / standard.fields.length) * 100).toFixed(1)}%):`);
    console.log('');

    // Group by reason
    const systemFields: string[] = [];
    const hiddenFields: string[] = [];
    const internalControls: string[] = [];
    const unnamed: string[] = [];

    filteredOut.forEach(field => {
      const name = field.caption || field.name || '(unnamed)';

      if (!field.caption && !field.name) {
        unnamed.push(`${name} [${field.type}]`);
      } else if (!field.enabled) {
        hiddenFields.push(`${name} [${field.type}]`);
      } else if (field.type === 'gc' || field.type === 'stackc' || field.type === 'fhc' || field.type === 'ssc') {
        internalControls.push(`${name} [${field.type}]`);
      } else if (name.match(/SystemId|timestamp|Last.*Modified|GUID/i)) {
        systemFields.push(`${name} [${field.type}]`);
      } else {
        hiddenFields.push(`${name} [${field.type}] - Other reason`);
      }
    });

    if (systemFields.length > 0) {
      console.log(`❌ System Fields (${systemFields.length}):`);
      systemFields.slice(0, 10).forEach(f => console.log(`   - ${f}`));
      if (systemFields.length > 10) console.log(`   ... and ${systemFields.length - 10} more`);
      console.log('');
    }

    if (hiddenFields.length > 0) {
      console.log(`🔒 Hidden/Disabled Fields (${hiddenFields.length}):`);
      hiddenFields.slice(0, 10).forEach(f => console.log(`   - ${f}`));
      if (hiddenFields.length > 10) console.log(`   ... and ${hiddenFields.length - 10} more`);
      console.log('');
    }

    if (internalControls.length > 0) {
      console.log(`⚙️  Internal/Layout Controls (${internalControls.length}):`);
      internalControls.slice(0, 10).forEach(f => console.log(`   - ${f}`));
      if (internalControls.length > 10) console.log(`   ... and ${internalControls.length - 10} more`);
      console.log('');
    }

    if (unnamed.length > 0) {
      console.log(`❓ Unnamed Controls (${unnamed.length}):`);
      unnamed.slice(0, 10).forEach(f => console.log(`   - ${f}`));
      if (unnamed.length > 10) console.log(`   ... and ${unnamed.length - 10} more`);
      console.log('');
    }

    // Summary
    console.log('4️⃣  SUMMARY:');
    console.log('='.repeat(80));
    console.log(`Original fields:     ${standard.fields.length}`);
    console.log(`Filtered to:         ${intelligent.fields.length} (${((intelligent.fields.length / standard.fields.length) * 100).toFixed(1)}% kept)`);
    console.log(`Removed:             ${filteredOut.length} (${((filteredOut.length / standard.fields.length) * 100).toFixed(1)}% filtered)`);
    console.log('');
    console.log('Why filtered:');
    console.log(`  - System fields:   ${systemFields.length}`);
    console.log(`  - Hidden/disabled: ${hiddenFields.length}`);
    console.log(`  - Internal/layout: ${internalControls.length}`);
    console.log(`  - Unnamed:         ${unnamed.length}`);
    console.log('');
    console.log('✅ Result: LLM sees only essential, actionable fields!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.disconnect();
  }
}

showFieldComparison().catch(console.error);
