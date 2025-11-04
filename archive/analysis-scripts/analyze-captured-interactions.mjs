/**
 * Analyze Captured BC Interactions
 *
 * Extracts unique interaction types and their parameters from captured invoke calls.
 */

import { readFileSync } from 'fs';

console.log('═══════════════════════════════════════════════════════════');
console.log('  BC Interaction Capture Analysis');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// Read captured invoke calls
const invokeCallsText = readFileSync('invoke-calls-captured.json', 'utf8');

// Parse each line separately (file is newline-delimited JSON records)
const lines = invokeCallsText.trim().split('\n');
console.log(`📄 Found ${lines.length} captured records`);
console.log('');

// Track unique interaction types and examples
const interactionTypes = new Map();
let totalInteractions = 0;

for (const line of lines) {
  if (!line.trim() || line.trim() === '[' || line.trim() === ']') continue;

  try {
    // Remove trailing comma if present
    const cleanedLine = line.trim().replace(/,$/, '');
    const record = JSON.parse(cleanedLine);

    // Extract payload
    const payload = JSON.parse(record.payloadText);

    // Extract interactions from params
    const params = payload.params?.[0];
    const interactions = params?.interactionsToInvoke || [];

    for (const interaction of interactions) {
      totalInteractions++;

      const name = interaction.interactionName;
      if (!interactionTypes.has(name)) {
        interactionTypes.set(name, {
          count: 0,
          examples: [],
        });
      }

      const info = interactionTypes.get(name);
      info.count++;

      // Store first 3 examples
      if (info.examples.length < 3) {
        const namedParams = JSON.parse(interaction.namedParameters || '{}');
        info.examples.push({
          controlPath: interaction.controlPath || '(none)',
          formId: interaction.formId || '(none)',
          parameters: namedParams,
          skipExtendingSession: interaction.skipExtendingSessionLifetime,
          callbackId: interaction.callbackId,
        });
      }
    }
  } catch (error) {
    // Skip malformed lines
    console.error(`⚠️  Skipped malformed record: ${error.message.substring(0, 60)}`);
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`📊 SUMMARY: ${totalInteractions} total interactions across ${interactionTypes.size} types`);
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// Sort by count
const sortedTypes = Array.from(interactionTypes.entries()).sort((a, b) => b[1].count - a[1].count);

for (const [name, info] of sortedTypes) {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n📍 ${name} (${info.count} occurrences)`);
  console.log('━'.repeat(60));
  console.log('');

  for (let i = 0; i < info.examples.length; i++) {
    const example = info.examples[i];
    console.log(`Example ${i + 1}:`);
    console.log(`  formId: ${example.formId}`);
    console.log(`  controlPath: ${example.controlPath}`);
    console.log(`  callbackId: ${example.callbackId}`);
    console.log(`  skipExtendingSession: ${example.skipExtendingSession}`);
    console.log(`  parameters:`);

    for (const [key, value] of Object.entries(example.parameters)) {
      const valueStr = typeof value === 'object'
        ? JSON.stringify(value, null, 2).split('\n').join('\n      ')
        : String(value);

      if (valueStr.length > 200) {
        console.log(`    ${key}: ${valueStr.substring(0, 200)}...`);
      } else {
        console.log(`    ${key}: ${valueStr}`);
      }
    }
    console.log('');
  }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('🎯 NEXT STEPS');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('1. Compare captured protocols with our tool implementations:');
console.log('   - src/tools/execute-action-tool.ts (InvokeAction)');
console.log('   - src/tools/update-field-tool.ts (ChangeField)');
console.log('');
console.log('2. Look for missing interaction types that need new tools:');
console.log('   - LoadForm (already handled by BCPageConnection)');
console.log('   - Navigate, Filter, SetFilter, etc.');
console.log('');
console.log('3. Check if controlPath is required or optional');
console.log('');
console.log('4. Verify parameter structures match our implementations');
console.log('');
