import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('filter-websocket-capture.json', 'utf-8'));
const sent = data.filter(m => m.direction === 'sent');

console.log('═══════════════════════════════════════════════════════════');
console.log('  Extracting interactionsToInvoke');
console.log('═══════════════════════════════════════════════════════════\n');

const allInteractions = [];

sent.forEach((msg, idx) => {
  try {
    const payload = JSON.parse(msg.payloadText);

    if (payload.params && payload.params[0] && payload.params[0].interactionsToInvoke) {
      const interactions = payload.params[0].interactionsToInvoke;

      if (Array.isArray(interactions)) {
        interactions.forEach(inv => {
          allInteractions.push({
            messageIndex: idx,
            timestamp: msg.iso,
            interactionName: inv.interactionName,
            formId: inv.formId,
            controlPath: inv.controlPath,
            raw: inv
          });
        });
      }
    }
  } catch (e) {
    console.log(`Message ${idx + 1}: Parse error - ${e.message}`);
  }
});

console.log(`Found ${allInteractions.length} interactions\n`);

// Group by interaction name
const byName = {};
allInteractions.forEach(int => {
  if (!byName[int.interactionName]) {
    byName[int.interactionName] = [];
  }
  byName[int.interactionName].push(int);
});

console.log('Interaction types:');
Object.keys(byName).forEach(name => {
  console.log(`  ${name}: ${byName[name].length}`);
});
console.log('');

// Extract SaveValue interactions
const saveValues = allInteractions.filter(int => int.interactionName === 'SaveValue');

console.log(`SaveValue interactions: ${saveValues.length}\n`);

saveValues.forEach((sv, idx) => {
  console.log(`${idx + 1}. ${sv.timestamp}`);
  console.log(`   formId: ${sv.formId}`);
  console.log(`   controlPath: ${sv.controlPath || '(none)'}`);

  if (sv.raw.namedParameters) {
    try {
      const params = typeof sv.raw.namedParameters === 'string'
        ? JSON.parse(sv.raw.namedParameters)
        : sv.raw.namedParameters;

      console.log(`   newValue: ${JSON.stringify(params.newValue)}`);

      if (params['Control name']) {
        console.log(`   Control name: "${params['Control name']}"`);
      }
    } catch (e) {
      console.log(`   (Could not parse namedParameters)`);
    }
  }
  console.log('');
});

// Save all interactions
writeFileSync('all-interactions.json', JSON.stringify(allInteractions, null, 2));
console.log('✓ Saved to: all-interactions.json');
