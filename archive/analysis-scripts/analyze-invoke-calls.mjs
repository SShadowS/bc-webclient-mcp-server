/**
 * Analyze invoke-calls-captured.json
 *
 * Extracts BC interactions from Playwright WebSocket captures.
 */

import { readFileSync } from 'fs';

console.log('═══════════════════════════════════════════════════════════');
console.log('  BC Invoke Calls Analysis');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// Read and parse the captured WebSocket messages
const captures = JSON.parse(readFileSync('invoke-calls-captured.json', 'utf8'));

console.log(`📄 Loaded ${captures.length} WebSocket messages`);
console.log('');

// Filter for sent messages with "Invoke" method
const invokeMessages = captures.filter(
  (msg) => msg.direction === 'sent' && msg.payload?.method === 'Invoke'
);

console.log(`🔍 Found ${invokeMessages.length} Invoke messages`);
console.log('');

// Extract all interactions
const interactionTypes = new Map();
let totalInteractions = 0;

for (const msg of invokeMessages) {
  const params = msg.payload?.params?.[0];
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
      // Parse namedParameters if it's a string
      let namedParams = interaction.namedParameters;
      if (typeof namedParams === 'string') {
        try {
          namedParams = JSON.parse(namedParams);
        } catch {
          // Keep as string if not parseable
        }
      }

      info.examples.push({
        controlPath: interaction.controlPath,
        formId: interaction.formId,
        parameters: namedParams,
        skipExtendingSession: interaction.skipExtendingSessionLifetime,
        callbackId: interaction.callbackId,
      });
    }
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
    if (example.formId !== undefined) {
      console.log(`  formId: ${example.formId}`);
    }
    if (example.controlPath !== undefined) {
      console.log(`  controlPath: ${example.controlPath}`);
    }
    console.log(`  callbackId: ${example.callbackId}`);
    console.log(`  skipExtendingSession: ${example.skipExtendingSession}`);
    console.log(`  parameters:`);

    if (typeof example.parameters === 'object' && example.parameters !== null) {
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
    } else {
      console.log(`    ${example.parameters}`);
    }
    console.log('');
  }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('🎯 KEY FINDINGS');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// Check for InvokeAction and ChangeField
const hasInvokeAction = interactionTypes.has('InvokeAction');
const hasChangeField = interactionTypes.has('ChangeField');

if (hasInvokeAction) {
  console.log('✓ InvokeAction interactions captured');
  console.log('  → Compare with execute-action-tool.ts');
} else {
  console.log('⚠️  NO InvokeAction interactions captured');
  console.log('  → Need to capture: Click "Edit", "New", "Delete" buttons');
}
console.log('');

if (hasChangeField) {
  console.log('✓ ChangeField interactions captured');
  console.log('  → Compare with update-field-tool.ts');
} else {
  console.log('⚠️  NO ChangeField interactions captured');
  console.log('  → Need to capture: Update text field, change dropdown');
}
console.log('');

console.log('Other interaction types found:');
for (const [name, info] of sortedTypes) {
  if (name !== 'InvokeAction' && name !== 'ChangeField') {
    console.log(`  - ${name} (${info.count} times)`);
  }
}
console.log('');
