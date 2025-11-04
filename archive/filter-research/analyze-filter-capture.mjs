/**
 * Analyze Filter Capture
 *
 * Extracts and analyzes filter-related messages from the capture
 */

import { readFileSync, writeFileSync } from 'fs';

const wsData = JSON.parse(readFileSync('filter-websocket-capture.json', 'utf-8'));

console.log('═══════════════════════════════════════════════════════════');
console.log('  BC Filter Protocol Analysis');
console.log('═══════════════════════════════════════════════════════════\n');

console.log(`Total messages: ${wsData.length}`);
console.log(`Sent: ${wsData.filter(m => m.direction === 'sent').length}`);
console.log(`Received: ${wsData.filter(m => m.direction === 'received').length}\n`);

// Find SaveValue messages (filter operations)
const saveValueMessages = wsData.filter(m => {
  if (m.direction !== 'sent') return false;
  if (!m.payload) return false;
  const str = JSON.stringify(m.payload);
  return str.includes('SaveValue') || str.includes('saveValue');
});

console.log(`SaveValue messages found: ${saveValueMessages.length}\n`);

// Group messages by timestamp proximity (within 5 seconds = same interaction)
const interactions = [];
let currentInteraction = null;

for (const msg of wsData) {
  if (!currentInteraction || (msg.timestamp - currentInteraction.startTime > 5000)) {
    currentInteraction = {
      startTime: msg.timestamp,
      messages: []
    };
    interactions.push(currentInteraction);
  }
  currentInteraction.messages.push(msg);
}

console.log(`Grouped into ${interactions.length} interactions\n`);

// Find filter-related interactions (contains SaveValue)
const filterInteractions = interactions.filter(int =>
  int.messages.some(m => JSON.stringify(m.payload || {}).includes('SaveValue'))
);

console.log(`Filter interactions: ${filterInteractions.length}\n`);

// Analyze each filter interaction
filterInteractions.forEach((interaction, idx) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Filter Interaction ${idx + 1}`);
  console.log(`${'='.repeat(60)}\n`);

  const sent = interaction.messages.filter(m => m.direction === 'sent');
  const received = interaction.messages.filter(m => m.direction === 'received');

  console.log(`Messages: ${sent.length} sent, ${received.length} received\n`);

  // Show sent messages
  sent.forEach((msg, i) => {
    console.log(`[${i + 1}] SENT at ${new Date(msg.timestamp).toISOString()}`);

    if (msg.payload?.method) {
      console.log(`    Method: ${msg.payload.method}`);
    }

    // Check for SaveValue
    const paramsStr = JSON.stringify(msg.payload?.params || {});
    if (paramsStr.includes('SaveValue')) {
      const params = msg.payload.params;
      if (Array.isArray(params) && params.length > 0) {
        const invocations = params[0];

        if (Array.isArray(invocations)) {
          invocations.forEach((inv, invIdx) => {
            if (inv.interactionName === 'SaveValue') {
              console.log(`    SaveValue #${invIdx + 1}:`);
              console.log(`      formId: ${inv.formId}`);
              console.log(`      controlPath: ${inv.controlPath || '(none)'}`);

              if (inv.namedParameters) {
                try {
                  const named = typeof inv.namedParameters === 'string'
                    ? JSON.parse(inv.namedParameters)
                    : inv.namedParameters;
                  console.log(`      newValue: ${JSON.stringify(named.newValue)}`);
                  console.log(`      alwaysCommitChange: ${named.alwaysCommitChange}`);
                } catch (e) {
                  console.log(`      namedParameters: ${inv.namedParameters}`);
                }
              }
            }
          });
        }
      }
    }
    console.log('');
  });

  // Show received messages (summarized)
  console.log(`Received ${received.length} responses\n`);

  // Check for specific handler types
  const changeHandlers = received.filter(m => {
    const str = JSON.stringify(m.payload || {});
    return str.includes('LogicalClientChangeHandler') || str.includes('DataRefreshChange');
  });

  if (changeHandlers.length > 0) {
    console.log(`  → ${changeHandlers.length} ChangeHandler responses (list data updated)\n`);
  }
});

// Save filtered data for detailed inspection
const filterMessages = filterInteractions.flatMap(int => int.messages);
writeFileSync('filter-messages-only.json', JSON.stringify(filterMessages, null, 2));
console.log(`\n✓ Filtered messages saved to: filter-messages-only.json`);

// Extract SaveValue patterns
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  SaveValue Pattern Summary');
console.log('═══════════════════════════════════════════════════════════\n');

const saveValuePatterns = [];

saveValueMessages.forEach(msg => {
  if (!msg.payload?.params?.[0]) return;

  const invocations = msg.payload.params[0];
  if (!Array.isArray(invocations)) return;

  invocations.forEach(inv => {
    if (inv.interactionName !== 'SaveValue') return;

    let newValue = null;
    if (inv.namedParameters) {
      try {
        const named = typeof inv.namedParameters === 'string'
          ? JSON.parse(inv.namedParameters)
          : inv.namedParameters;
        newValue = named.newValue;
      } catch (e) {}
    }

    saveValuePatterns.push({
      formId: inv.formId,
      controlPath: inv.controlPath,
      newValue,
      timestamp: msg.timestamp
    });
  });
});

console.log('SaveValue calls:');
saveValuePatterns.forEach((pattern, idx) => {
  console.log(`  ${idx + 1}. formId: ${pattern.formId}, controlPath: ${pattern.controlPath || '(none)'}`);
  console.log(`     newValue: ${JSON.stringify(pattern.newValue)}`);
});

console.log('\n✓ Analysis complete!');
