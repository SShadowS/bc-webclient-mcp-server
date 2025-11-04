/**
 * Examine form object properties to understand LoadForm criteria
 */

import { readFileSync, writeFileSync } from 'fs';

const decomp = JSON.parse(readFileSync('decompressed-responses.json', 'utf-8'));
const first = decomp[0];

console.log(`\n${'═'.repeat(80)}`);
console.log(`  Examining Form Properties in First Response`);
console.log(`${'═'.repeat(80)}\n`);

// Get the form structure handler
const rootForm = first.data[9].parameters[1];

console.log('Root Form (Shell):');
console.log(`  ServerId: ${rootForm.ServerId}`);
console.log(`  Properties: ${Object.keys(rootForm).join(', ')}\n`);

// Examine a few key properties
const keyProps = ['Caption', 'Type', 'ControlType', 'Visible', 'LoadOnDemand'];
for (const prop of keyProps) {
  if (rootForm[prop] !== undefined) {
    const val = typeof rootForm[prop] === 'object'
      ? JSON.stringify(rootForm[prop]).substring(0, 100)
      : rootForm[prop];
    console.log(`  ${prop}: ${val}`);
  }
}

console.log(`\n${'─'.repeat(80)}\n`);
console.log('Child Forms:\n');

// Examine child forms
const childIndices = [5, 7, 8, 10, 14, 15]; // From serverid-structure.json

for (const idx of childIndices) {
  const container = rootForm.Children[idx];
  const childForm = container?.Children?.[0];

  if (!childForm) continue;

  console.log(`Children[${idx}].Children[0]:`);
  console.log(`  ServerId: ${childForm.ServerId}`);
  console.log(`  Properties: ${Object.keys(childForm).slice(0, 15).join(', ')}`);

  // Show key properties
  for (const prop of keyProps) {
    if (childForm[prop] !== undefined) {
      const val = typeof childForm[prop] === 'object'
        ? JSON.stringify(childForm[prop]).substring(0, 50)
        : childForm[prop];
      console.log(`    ${prop}: ${val}`);
    }
  }

  // Check for other interesting properties
  const interestingProps = [
    'PageId', 'pageId', 'PageType', 'ControlId',
    'Name', 'PagePartId', 'SystemPartId',
    'PartType', 'SubPageLink'
  ];

  for (const prop of interestingProps) {
    if (childForm[prop] !== undefined) {
      const val = typeof childForm[prop] === 'object'
        ? JSON.stringify(childForm[prop]).substring(0, 50)
        : childForm[prop];
      console.log(`    ${prop}: ${val}`);
    }
  }

  console.log();
}

// Also examine the container properties
console.log(`\n${'─'.repeat(80)}\n`);
console.log('Container Properties (Children[N]):\n');

for (const idx of childIndices.slice(0, 3)) { // First 3 for brevity
  const container = rootForm.Children[idx];

  console.log(`Children[${idx}]:`);
  console.log(`  Properties: ${Object.keys(container).slice(0, 10).join(', ')}`);

  for (const prop of ['Type', 'ControlType', 'Name', 'Caption', 'Visible']) {
    if (container[prop] !== undefined) {
      const val = typeof container[prop] === 'object'
        ? JSON.stringify(container[prop]).substring(0, 50)
        : container[prop];
      console.log(`    ${prop}: ${val}`);
    }
  }
  console.log();
}

// Save detailed inspection
const inspection = {
  rootForm: {
    serverId: rootForm.ServerId,
    properties: Object.keys(rootForm),
    caption: rootForm.Caption,
    type: rootForm.Type
  },
  childForms: childIndices.map(idx => {
    const container = rootForm.Children[idx];
    const childForm = container?.Children?.[0];
    return {
      index: idx,
      container: {
        type: container?.Type,
        controlType: container?.ControlType,
        name: container?.Name,
        visible: container?.Visible
      },
      form: childForm ? {
        serverId: childForm.ServerId,
        properties: Object.keys(childForm).slice(0, 20),
        caption: childForm.Caption,
        type: childForm.Type,
        controlType: childForm.ControlType,
        pageId: childForm.PageId || childForm.pageId,
        partType: childForm.PartType,
        systemPartId: childForm.SystemPartId
      } : null
    };
  })
};

writeFileSync('form-properties-inspection.json', JSON.stringify(inspection, null, 2));
console.log('✓ Saved to form-properties-inspection.json\n');
