/**
 * Final comprehensive LoadForm pattern analysis
 */

import { readFileSync, writeFileSync } from 'fs';

const decomp = JSON.parse(readFileSync('decompressed-responses.json', 'utf-8'));
const first = decomp[0];

console.log(`\n${'═'.repeat(80)}`);
console.log(`  Final LoadForm Pattern Analysis`);
console.log(`${'═'.repeat(80)}\n`);

const rootForm = first.data[9].parameters[1];
const childIndices = [5, 7, 8, 10, 14, 15];
const loadFormedIds = ['265', '264', '267', '268'];

const table = [];

console.log('Complete Property Matrix:\n');
console.log('ServerId | Loaded | Visible | DelayedControls | ExpressionProps');
console.log('---------|--------|---------|-----------------|----------------');

for (const idx of childIndices) {
  const container = rootForm.Children[idx];
  const childForm = container?.Children?.[0];

  if (!childForm) continue;

  const wasLoadFormed = loadFormedIds.includes(childForm.ServerId);
  const hasVisible = container.Visible !== undefined;
  const visibleValue = container.Visible;
  const hasDelayedControls = childForm.DelayedControls !== undefined;
  const hasExpressionProps = container.ExpressionProperties !== undefined;

  console.log(
    `  ${childForm.ServerId}    |  ${wasLoadFormed ? 'YES ✓' : 'NO ✗'}  | ${visibleValue !== undefined ? visibleValue : 'undef'}    | ${hasDelayedControls ? 'YES' : 'NO'}             | ${hasExpressionProps ? 'YES' : 'NO'}`
  );

  table.push({
    serverId: childForm.ServerId,
    caption: childForm.Caption,
    wasLoadFormed,
    containerVisible: visibleValue,
    hasDelayedControls,
    hasExpressionProps
  });
}

console.log('\n');

// Determine pattern
console.log(`${'─'.repeat(80)}\n`);
console.log('Pattern Detection:\n');

// Rule 1: Visible=false → NOT loaded
const rule1Violations = table.filter(
  r => r.containerVisible === false && r.wasLoadFormed
);
console.log(`Rule 1: If Visible=false → NOT loaded`);
console.log(`  Violations: ${rule1Violations.length}`);
if (rule1Violations.length === 0) {
  console.log(`  ✓ CONFIRMED`);
} else {
  console.log(`  ✗ VIOLATED`);
}

// Rule 2: DelayedControls=true → loaded (if Visible !== false)
const hasDelayed = table.filter(r => r.hasDelayedControls && r.containerVisible !== false);
const hasDelayedAndLoaded = hasDelayed.filter(r => r.wasLoadFormed);
console.log(`\nRule 2: If DelayedControls exists (and Visible !== false) → loaded`);
console.log(`  Forms with DelayedControls: ${hasDelayed.length}`);
console.log(`  Of those, loaded: ${hasDelayedAndLoaded.length}`);
if (hasDelayed.length === hasDelayedAndLoaded.length && hasDelayed.length > 0) {
  console.log(`  ✓ CONFIRMED`);
} else {
  console.log(`  ? Partial match`);
}

// Rule 3: ExpressionProperties → loaded (if Visible !== false)
const hasExpr = table.filter(r => r.hasExpressionProps && r.containerVisible !== false);
const hasExprAndLoaded = hasExpr.filter(r => r.wasLoadFormed);
console.log(`\nRule 3: If ExpressionProperties exists (and Visible !== false) → loaded`);
console.log(`  Forms with ExpressionProperties: ${hasExpr.length}`);
console.log(`  Of those, loaded: ${hasExprAndLoaded.length}`);
if (hasExpr.length === hasExprAndLoaded.length && hasExpr.length > 0) {
  console.log(`  ✓ CONFIRMED`);
} else if (hasExprAndLoaded.length > 0) {
  console.log(`  ? Partial match`);
} else {
  console.log(`  ✗ FAILED`);
}

// Combined rule
console.log(`\n${'─'.repeat(80)}\n`);
console.log('FINAL PATTERN:\n');
console.log('LoadForm a child form if ALL of:');
console.log('  1. Container.Visible !== false (not explicitly hidden)');
console.log('  2. EITHER:');
console.log('     a) Form has DelayedControls property, OR');
console.log('     b) Container has ExpressionProperties (conditional visibility)');
console.log('\n');

// Verify final pattern
let patternMatches = 0;
let patternViolations = 0;

for (const row of table) {
  const shouldLoad =
    row.containerVisible !== false &&
    (row.hasDelayedControls || row.hasExpressionProps);

  if (shouldLoad === row.wasLoadFormed) {
    patternMatches++;
  } else {
    patternViolations++;
    console.log(`✗ VIOLATION: ${row.serverId} (${row.caption})`);
    console.log(`  Expected: ${shouldLoad ? 'Load' : 'Skip'}, Actual: ${row.wasLoadFormed ? 'Loaded' : 'Skipped'}`);
  }
}

console.log();
console.log(`Pattern Matches: ${patternMatches}/${table.length}`);
console.log(`Pattern Violations: ${patternViolations}/${table.length}`);

if (patternViolations === 0) {
  console.log('\n✓✓✓ PATTERN CONFIRMED ✓✓✓\n');
} else {
  console.log('\n? Pattern needs refinement\n');
}

// Save result
writeFileSync('loadform-pattern-final.json', JSON.stringify({
  pattern: {
    description: 'LoadForm if Visible !== false AND (hasDelayedControls OR hasExpressionProps)',
    matches: patternMatches,
    total: table.length,
    confirmed: patternViolations === 0
  },
  details: table
}, null, 2));

console.log('✓ Saved to loadform-pattern-final.json\n');
