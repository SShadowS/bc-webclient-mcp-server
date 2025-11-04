/**
 * Deep Parameter Analysis
 *
 * Analyzes all parameters to find field changes and actions,
 * regardless of interaction name.
 */

import { readFileSync } from 'fs';

console.log('═══════════════════════════════════════════════════════════');
console.log('  BC Deep Parameter Analysis');
console.log('  Looking for field changes and action clicks');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const captures = JSON.parse(readFileSync('invoke-calls-captured.json', 'utf8'));

const invokeMessages = captures.filter(
  (msg) => msg.direction === 'sent' && msg.payload?.method === 'Invoke'
);

console.log(`📄 Analyzing ${invokeMessages.length} Invoke messages`);
console.log('');

// Group by interaction name AND parameter patterns
const detailedAnalysis = new Map();

for (const msg of invokeMessages) {
  const params = msg.payload?.params?.[0];
  const interactions = params?.interactionsToInvoke || [];

  for (const interaction of interactions) {
    const name = interaction.interactionName;

    // Parse namedParameters
    let namedParams = interaction.namedParameters;
    if (typeof namedParams === 'string') {
      try {
        namedParams = JSON.parse(namedParams);
      } catch {
        namedParams = { _raw: namedParams };
      }
    }

    // Create a key based on interaction name + parameter keys
    const paramKeys = typeof namedParams === 'object'
      ? Object.keys(namedParams).sort().join(',')
      : 'none';

    const key = `${name}:${paramKeys}`;

    if (!detailedAnalysis.has(key)) {
      detailedAnalysis.set(key, {
        name,
        paramKeys,
        count: 0,
        examples: [],
      });
    }

    const info = detailedAnalysis.get(key);
    info.count++;

    if (info.examples.length < 2) {
      info.examples.push({
        controlPath: interaction.controlPath,
        formId: interaction.formId,
        callbackId: interaction.callbackId,
        parameters: namedParams,
      });
    }
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`📊 Found ${detailedAnalysis.size} unique interaction patterns`);
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// Sort by count
const sorted = Array.from(detailedAnalysis.entries()).sort((a, b) => b[1].count - a[1].count);

for (const [key, info] of sorted) {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n📍 ${info.name}`);
  console.log(`   Parameters: ${info.paramKeys || '(none)'}`);
  console.log(`   Count: ${info.count}`);
  console.log('━'.repeat(60));
  console.log('');

  for (let i = 0; i < info.examples.length; i++) {
    const ex = info.examples[i];
    console.log(`Example ${i + 1}:`);

    if (ex.formId !== undefined) {
      console.log(`  formId: ${ex.formId}`);
    }
    if (ex.controlPath !== undefined) {
      console.log(`  controlPath: ${ex.controlPath}`);
    }
    console.log(`  callbackId: ${ex.callbackId}`);
    console.log('  parameters:');

    if (typeof ex.parameters === 'object' && ex.parameters !== null) {
      for (const [k, v] of Object.entries(ex.parameters)) {
        const vStr = typeof v === 'object'
          ? JSON.stringify(v, null, 2).split('\n').map((line, idx) =>
              idx === 0 ? line : '      ' + line
            ).join('\n')
          : String(v);

        // Highlight potential field changes or actions
        let highlight = '';
        if (k.toLowerCase().includes('action') ||
            k.toLowerCase().includes('field') ||
            k.toLowerCase().includes('value') ||
            k.toLowerCase().includes('name')) {
          highlight = ' 🔍';
        }

        if (vStr.length > 300) {
          console.log(`    ${k}: ${vStr.substring(0, 300)}...${highlight}`);
        } else {
          console.log(`    ${k}: ${vStr}${highlight}`);
        }
      }
    } else {
      console.log(`    ${ex.parameters}`);
    }
    console.log('');
  }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('🔍 SEARCH RESULTS');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// Look for specific patterns
const actionPatterns = sorted.filter(([k, v]) =>
  k.includes('Action') ||
  v.paramKeys.includes('action') ||
  v.paramKeys.includes('systemAction')
);

const fieldPatterns = sorted.filter(([k, v]) =>
  k.includes('Field') ||
  k.includes('Change') ||
  v.paramKeys.includes('field') ||
  v.paramKeys.includes('value') ||
  v.paramKeys.includes('newValue')
);

console.log(`Action-related patterns: ${actionPatterns.length}`);
for (const [k, v] of actionPatterns) {
  console.log(`  - ${k} (${v.count}x)`);
}
console.log('');

console.log(`Field-related patterns: ${fieldPatterns.length}`);
for (const [k, v] of fieldPatterns) {
  console.log(`  - ${k} (${v.count}x)`);
}
console.log('');
