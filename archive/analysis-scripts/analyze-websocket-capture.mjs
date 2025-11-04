/**
 * Analyze captured WebSocket Invoke calls from real BC web client
 */

import { readFileSync } from 'fs';

const invokeCalls = JSON.parse(readFileSync('invoke-calls-captured.json', 'utf-8'));

console.log(`\n${'═'.repeat(80)}`);
console.log(`  WebSocket Capture Analysis`);
console.log(`  Total Invoke calls: ${invokeCalls.length}`);
console.log(`${'═'.repeat(80)}\n`);

// Count interaction types
const interactionCounts = new Map();
invokeCalls.forEach(call => {
  const invokes = call.payload?.params?.[0]?.interactionsToInvoke || [];
  invokes.forEach(int => {
    const name = int.interactionName;
    interactionCounts.set(name, (interactionCounts.get(name) || 0) + 1);
  });
});

console.log('Interaction Types Found:');
for (const [name, count] of interactionCounts) {
  console.log(`  ${name}: ${count}`);
}

console.log(`\n${'─'.repeat(80)}\n`);

// Show details of each call
invokeCalls.forEach((call, index) => {
  const params = call.payload?.params?.[0];

  if (!params) {
    console.log(`[${index + 1}] No params found`);
    return;
  }

  const { openFormIds, sequenceNo, interactionsToInvoke } = params;

  console.log(`[${index + 1}] Sequence: ${sequenceNo}`);
  console.log(`     Open Forms: [${openFormIds?.join(', ') || ''}]`);

  if (!interactionsToInvoke || interactionsToInvoke.length === 0) {
    console.log(`     No interactions\n`);
    return;
  }

  console.log(`     Interactions (${interactionsToInvoke.length}):`);

  interactionsToInvoke.forEach((interaction, i) => {
    console.log(`\n       [${i + 1}] ${interaction.interactionName}`);
    console.log(`           formId: ${interaction.formId || 'none'}`);
    console.log(`           controlPath: ${interaction.controlPath || 'none'}`);
    console.log(`           callbackId: ${interaction.callbackId}`);

    // Parse namedParameters
    let namedParams = interaction.namedParameters;
    if (typeof namedParams === 'string') {
      try {
        namedParams = JSON.parse(namedParams);
      } catch (e) {
        console.log(`           namedParameters: ${namedParams.substring(0, 100)}...`);
        return;
      }
    }

    if (namedParams && typeof namedParams === 'object') {
      console.log(`           namedParameters:`);
      for (const [key, value] of Object.entries(namedParams)) {
        if (typeof value === 'object' && value !== null) {
          console.log(`             ${key}:`);
          for (const [k, v] of Object.entries(value)) {
            const valStr = JSON.stringify(v);
            const displayVal = valStr.length > 50 ? valStr.substring(0, 47) + '...' : valStr;
            console.log(`               ${k}: ${displayVal}`);
          }
        } else {
          const valStr = JSON.stringify(value);
          const displayVal = valStr.length > 50 ? valStr.substring(0, 47) + '...' : valStr;
          console.log(`             ${key}: ${displayVal}`);
        }
      }
    }
  });

  console.log();
});
