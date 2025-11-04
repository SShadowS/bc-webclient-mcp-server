/**
 * Extract SaveValue messages from filter capture
 */

import { readFileSync, writeFileSync } from 'fs';

const wsData = JSON.parse(readFileSync('filter-websocket-capture.json', 'utf-8'));

console.log('═══════════════════════════════════════════════════════════');
console.log('  Extracting SaveValue Messages');
console.log('═══════════════════════════════════════════════════════════\n');

const sentMessages = wsData.filter(m => m.direction === 'sent');

console.log(`Total sent messages: ${sentMessages.length}\n`);

const saveValueMessages = [];

sentMessages.forEach((msg, idx) => {
  try {
    const payload = JSON.parse(msg.payloadText);

    if (payload.method === 'Invoke' && payload.params?.[0]) {
      const invocations = payload.params[0];

      if (Array.isArray(invocations)) {
        invocations.forEach(inv => {
          if (inv.interactionName === 'SaveValue') {
            let namedParams = inv.namedParameters;
            if (typeof namedParams === 'string') {
              namedParams = JSON.parse(namedParams);
            }

            saveValueMessages.push({
              messageIndex: idx,
              timestamp: msg.iso,
              formId: inv.formId,
              controlPath: inv.controlPath,
              newValue: namedParams?.newValue,
              controlName: namedParams?.['Control name'],
              alwaysCommitChange: namedParams?.alwaysCommitChange,
              notifyBusy: namedParams?.notifyBusy,
            });
          }
        });
      }
    }
  } catch (e) {
    // Skip non-JSON or malformed messages
  }
});

console.log(`Found ${saveValueMessages.length} SaveValue messages:\n`);

saveValueMessages.forEach((sv, idx) => {
  console.log(`${idx + 1}. ${sv.timestamp}`);
  console.log(`   formId: ${sv.formId}`);
  console.log(`   controlPath: ${sv.controlPath || '(none)'}`);
  console.log(`   newValue: ${JSON.stringify(sv.newValue)}`);
  if (sv.controlName) {
    console.log(`   Control name: "${sv.controlName}"`);
  }
  console.log('');
});

// Save detailed SaveValue data
writeFileSync('savevalue-messages.json', JSON.stringify(saveValueMessages, null, 2));
console.log('✓ Saved to: savevalue-messages.json\n');

// Identify filter-specific patterns
console.log('═══════════════════════════════════════════════════════════');
console.log('  Filter Pattern Analysis');
console.log('═══════════════════════════════════════════════════════════\n');

const filterValues = saveValueMessages.filter(sv =>
  sv.controlName && (
    sv.controlName.toLowerCase().includes('filter') ||
    sv.controlName.toLowerCase().includes('search') ||
    sv.controlName.toLowerCase().includes('name')
  )
);

console.log(`Filter-related SaveValue calls: ${filterValues.length}\n`);

filterValues.forEach((sv, idx) => {
  console.log(`${idx + 1}. Control: "${sv.controlName}"`);
  console.log(`   Value: ${JSON.stringify(sv.newValue)}`);
  console.log(`   Path: ${sv.controlPath || '(none)'}`);
  console.log('');
});

if (filterValues.length === 0) {
  console.log('⚠️  No obvious filter controls found.');
  console.log('   The filter might use a different control name.');
  console.log('   Check all SaveValue messages above for patterns.\n');
}

console.log('✓ Analysis complete!');
