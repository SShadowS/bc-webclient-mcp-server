/**
 * Analyze which child forms should be LoadForm'd based on properties
 */

import { readFileSync, writeFileSync } from 'fs';

const decomp = JSON.parse(readFileSync('decompressed-responses.json', 'utf-8'));
const first = decomp[0];

console.log(`\n${'═'.repeat(80)}`);
console.log(`  Analyzing LoadForm Criteria`);
console.log(`${'═'.repeat(80)}\n`);

const rootForm = first.data[9].parameters[1];
const childIndices = [5, 7, 8, 10, 14, 15]; // From serverid-structure.json

// From WebSocket capture, BC LoadForm'd these:
const loadFormedIds = ['265', '264', '267', '268'];
const notLoadFormedIds = ['263', '266'];

console.log('LoadForm Analysis:\n');
console.log('  LoadForm\'d by browser:', loadFormedIds.join(', '));
console.log('  NOT LoadForm\'d:', notLoadFormedIds.join(', '));
console.log();

const analysis = [];

for (const idx of childIndices) {
  const container = rootForm.Children[idx];
  const childForm = container?.Children?.[0];

  if (!childForm) continue;

  const wasLoadFormed = loadFormedIds.includes(childForm.ServerId);

  console.log(`ServerId ${childForm.ServerId} (${childForm.Caption}):`);
  console.log(`  Index: ${idx}`);
  console.log(`  LoadForm'd: ${wasLoadFormed ? 'YES ✓' : 'NO ✗'}`);
  console.log(`  Container.Visible: ${container.Visible !== undefined ? container.Visible : 'undefined'}`);
  console.log(`  Container.LocalVisible: ${container.LocalVisible !== undefined ? container.LocalVisible : 'undefined'}`);
  console.log(`  Form.DelayedControls: ${childForm.DelayedControls !== undefined ? 'true' : 'false'}`);
  console.log(`  Form.State: ${childForm.State !== undefined ? childForm.State : 'undefined'}`);
  console.log(`  Form.PageType: ${childForm.PageType !== undefined ? childForm.PageType : 'undefined'}`);

  // Check ExpressionProperties for visibility expressions
  if (container.ExpressionProperties) {
    console.log(`  Container.ExpressionProperties: present`);
    const exprKeys = Object.keys(container.ExpressionProperties);
    if (exprKeys.length > 0) {
      console.log(`    Keys: ${exprKeys.join(', ')}`);
    }
  }

  console.log();

  analysis.push({
    serverId: childForm.ServerId,
    caption: childForm.Caption,
    index: idx,
    wasLoadFormed,
    container: {
      visible: container.Visible,
      localVisible: container.LocalVisible,
      hasExpressionProperties: !!container.ExpressionProperties
    },
    form: {
      hasDelayedControls: !!childForm.DelayedControls,
      state: childForm.State,
      pageType: childForm.PageType
    }
  });
}

console.log(`${'─'.repeat(80)}\n`);
console.log('Pattern Analysis:\n');

// Group by LoadForm status
const loadFormed = analysis.filter(a => a.wasLoadFormed);
const notLoadFormed = analysis.filter(a => !a.wasLoadFormed);

console.log('LoadForm\'d forms (4):');
for (const a of loadFormed) {
  console.log(`  ${a.serverId}: Visible=${a.container.visible}, State=${a.form.state}, PageType=${a.form.pageType}`);
}

console.log('\nNOT LoadForm\'d forms (2):');
for (const a of notLoadFormed) {
  console.log(`  ${a.serverId}: Visible=${a.container.visible}, State=${a.form.state}, PageType=${a.form.pageType}`);
}

// Check for pattern
console.log('\n');
console.log('Pattern Detection:');
const allLoadFormedVisible = loadFormed.every(a => a.container.visible !== false);
const allNotLoadFormedNotVisible = notLoadFormed.every(a => a.container.visible === false);

if (allLoadFormedVisible && allNotLoadFormedNotVisible) {
  console.log('  ✓ CLEAR PATTERN: LoadForm only when container.Visible !== false');
} else {
  console.log('  ? Pattern not clear from Visible property alone');
  console.log(`    LoadForm'd with Visible=true: ${loadFormed.filter(a => a.container.visible === true).length}`);
  console.log(`    LoadForm'd with Visible=undefined: ${loadFormed.filter(a => a.container.visible === undefined).length}`);
  console.log(`    NOT LoadForm'd with Visible=false: ${notLoadFormed.filter(a => a.container.visible === false).length}`);
}

console.log();

// Save analysis
writeFileSync('loadform-criteria-analysis.json', JSON.stringify({
  summary: {
    totalChildForms: analysis.length,
    loadFormed: loadFormed.length,
    notLoadFormed: notLoadFormed.length
  },
  loadFormedForms: loadFormed,
  notLoadFormedForms: notLoadFormed,
  pattern: {
    visibilityRule: 'LoadForm only when container.Visible !== false',
    verified: allLoadFormedVisible && allNotLoadFormedNotVisible
  }
}, null, 2));

console.log('✓ Saved to loadform-criteria-analysis.json\n');
