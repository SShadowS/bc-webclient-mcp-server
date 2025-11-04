/**
 * Examine ExpressionProperties to understand conditional visibility
 */

import { readFileSync, writeFileSync } from 'fs';

const decomp = JSON.parse(readFileSync('decompressed-responses.json', 'utf-8'));
const first = decomp[0];

console.log(`\n${'═'.repeat(80)}`);
console.log(`  Examining ExpressionProperties`);
console.log(`${'═'.repeat(80)}\n`);

const rootForm = first.data[9].parameters[1];
const childIndices = [5, 7, 8, 10, 14, 15];
const loadFormedIds = ['265', '264', '267', '268'];

for (const idx of childIndices) {
  const container = rootForm.Children[idx];
  const childForm = container?.Children?.[0];

  if (!childForm) continue;

  const wasLoadFormed = loadFormedIds.includes(childForm.ServerId);

  console.log(`ServerId ${childForm.ServerId} - ${wasLoadFormed ? 'LoadForm\'d ✓' : 'NOT LoadForm\'d ✗'}`);
  console.log(`  Index: ${idx}`);
  console.log(`  Caption: ${childForm.Caption}`);

  if (container.ExpressionProperties) {
    console.log(`  ExpressionProperties:`);
    for (const [key, value] of Object.entries(container.ExpressionProperties)) {
      console.log(`    ${key}:`);
      if (typeof value === 'object' && value !== null) {
        // Pretty print nested object
        console.log(`      ${JSON.stringify(value, null, 6).replace(/\n/g, '\n      ')}`);
      } else {
        console.log(`      ${value}`);
      }
    }
  } else {
    console.log(`  ExpressionProperties: none`);
  }

  // Also check if there's an InitiallyVisible property
  if (container.InitiallyVisible !== undefined) {
    console.log(`  InitiallyVisible: ${container.InitiallyVisible}`);
  }

  // Check container Type
  console.log(`  Container.Type: ${container.t}`);

  console.log();
}

// Look for any other properties that might differ
console.log(`${'─'.repeat(80)}\n`);
console.log('All Container Properties:\n');

for (const idx of [5, 10]) { // The two NOT LoadForm'd
  const container = rootForm.Children[idx];
  const childForm = container?.Children?.[0];

  console.log(`Index ${idx} (ServerId ${childForm.ServerId}) - NOT LoadForm'd:`);
  console.log(`  All container keys: ${Object.keys(container).join(', ')}`);
  console.log();
}

for (const idx of [7, 8]) { // Two that WERE LoadForm'd
  const container = rootForm.Children[idx];
  const childForm = container?.Children?.[0];

  console.log(`Index ${idx} (ServerId ${childForm.ServerId}) - LoadForm'd:`);
  console.log(`  All container keys: ${Object.keys(container).join(', ')}`);
  console.log();
}

// Save full container objects for manual inspection
const containers = {};
for (const idx of childIndices) {
  const container = rootForm.Children[idx];
  const childForm = container?.Children?.[0];
  if (childForm) {
    containers[`${idx}_${childForm.ServerId}`] = container;
  }
}

writeFileSync('container-objects-full.json', JSON.stringify(containers, null, 2));
console.log('✓ Saved to container-objects-full.json\n');
