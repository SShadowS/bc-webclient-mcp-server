/**
 * Parse Wireshark WebSocket capture to extract BC interaction flow
 * Outputs format matching analyze-our-calls.mjs for easy comparison
 */
import { readFileSync, writeFileSync } from 'fs';

const captureFile = 'C:\\bc4ubuntu\\Decompiled\\WiresharkWebSocket2.txt';
const content = readFileSync(captureFile, 'utf-8');

const lines = content.split('\n');
const allInteractions = [];

for (const line of lines) {
  try {
    const json = JSON.parse(line);

    // Check if this is an Invoke method
    if (json.method === 'Invoke' && json.params) {
      const params = json.params[0];
      if (params.interactionsToInvoke) {
        for (const interaction of params.interactionsToInvoke) {
          // Parse namedParameters (it's a JSON string)
          let namedParams = {};
          try {
            namedParams = JSON.parse(interaction.namedParameters || '{}');
          } catch {
            namedParams = { raw: interaction.namedParameters };
          }

          allInteractions.push({
            method: 'Invoke',
            interactionName: interaction.interactionName,
            namedParameters: namedParams,
            formId: interaction.formId,
            controlPath: interaction.controlPath,
            callbackId: interaction.callbackId,
            sessionInfo: {
              company: params.company,
              tenantId: params.tenantId,
              openFormIds: params.openFormIds || [],
            }
          });
        }
      }
    }
  } catch (err) {
    // Skip malformed lines
  }
}

// Format output to match our-bc-calls.txt structure
let output = '═══════════════════════════════════════════════════════════\n';
output += 'REAL BC WEB CLIENT INTERACTIONS (from Wireshark)\n';
output += '═══════════════════════════════════════════════════════════\n\n';

// Group interactions by type for better visibility
const interactionsByType = {};
for (const interaction of allInteractions) {
  const type = interaction.interactionName;
  if (!interactionsByType[type]) {
    interactionsByType[type] = [];
  }
  interactionsByType[type].push(interaction);
}

// Show OpenForm interactions first (should be only 1)
if (interactionsByType['OpenForm']) {
  output += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += 'OpenForm Interactions (Page Opening at Session Start)\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  for (let i = 0; i < interactionsByType['OpenForm'].length; i++) {
    const interaction = interactionsByType['OpenForm'][i];
    output += `${i + 1}. OpenForm\n`;
    output += `   Parameters:\n`;
    for (const [key, value] of Object.entries(interaction.namedParameters)) {
      output += `     ${key}: ${JSON.stringify(value)}\n`;
    }
    output += `   formId: ${interaction.formId || 'null'}\n`;
    output += `   controlPath: ${interaction.controlPath || 'null'}\n`;
    output += `   openFormIds: [${interaction.sessionInfo.openFormIds.join(', ')}]\n`;
    output += `   tracked forms: ${interaction.sessionInfo.openFormIds.length}\n\n`;
  }
}

// Show Navigate interactions (page navigation from menu)
if (interactionsByType['Navigate']) {
  output += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += 'Navigate Interactions (Page Navigation from Menu)\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  for (let i = 0; i < interactionsByType['Navigate'].length; i++) {
    const interaction = interactionsByType['Navigate'][i];
    output += `${i + 1}. Navigate\n`;
    output += `   Parameters:\n`;
    for (const [key, value] of Object.entries(interaction.namedParameters)) {
      output += `     ${key}: ${JSON.stringify(value)}\n`;
    }
    output += `   formId: ${interaction.formId || 'null'}\n`;
    output += `   controlPath: ${interaction.controlPath || 'null'}\n`;
    output += `   openFormIds: [${interaction.sessionInfo.openFormIds.join(', ')}]\n`;
    output += `   tracked forms: ${interaction.sessionInfo.openFormIds.length}\n\n`;
  }
}

// Show InvokeAction interactions (opening related records)
if (interactionsByType['InvokeAction']) {
  output += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += 'InvokeAction Interactions (Opening Related Records)\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  for (let i = 0; i < interactionsByType['InvokeAction'].length; i++) {
    const interaction = interactionsByType['InvokeAction'][i];
    output += `${i + 1}. InvokeAction\n`;
    output += `   Parameters:\n`;
    for (const [key, value] of Object.entries(interaction.namedParameters)) {
      output += `     ${key}: ${JSON.stringify(value)}\n`;
    }
    output += `   formId: ${interaction.formId || 'null'}\n`;
    output += `   controlPath: ${interaction.controlPath || 'null'}\n`;
    output += `   openFormIds: [${interaction.sessionInfo.openFormIds.join(', ')}]\n`;
    output += `   tracked forms: ${interaction.sessionInfo.openFormIds.length}\n\n`;
  }
}

// Show LoadForm interactions (loading data into existing forms)
if (interactionsByType['LoadForm']) {
  output += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += 'LoadForm Interactions (Loading Data into Existing Forms)\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  // Only show first 5 LoadForm interactions (there are many)
  const loadFormCount = Math.min(5, interactionsByType['LoadForm'].length);
  for (let i = 0; i < loadFormCount; i++) {
    const interaction = interactionsByType['LoadForm'][i];
    output += `${i + 1}. LoadForm\n`;
    output += `   Parameters:\n`;
    for (const [key, value] of Object.entries(interaction.namedParameters)) {
      output += `     ${key}: ${JSON.stringify(value)}\n`;
    }
    output += `   formId: ${interaction.formId || 'null'}\n`;
    output += `   controlPath: ${interaction.controlPath || 'null'}\n`;
    output += `   openFormIds: [${interaction.sessionInfo.openFormIds.join(', ')}]\n`;
    output += `   tracked forms: ${interaction.sessionInfo.openFormIds.length}\n\n`;
  }

  if (interactionsByType['LoadForm'].length > 5) {
    output += `   ... and ${interactionsByType['LoadForm'].length - 5} more LoadForm interactions\n\n`;
  }
}

// Summary
output += '\n═══════════════════════════════════════════════════════════\n';
output += 'SUMMARY\n';
output += '═══════════════════════════════════════════════════════════\n\n';

output += `Total interactions: ${allInteractions.length}\n\n`;
output += 'Interaction breakdown:\n';
for (const [type, interactions] of Object.entries(interactionsByType)) {
  output += `  ${type}: ${interactions.length}\n`;
}

// Key insights
output += '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
output += 'KEY INSIGHTS\n';
output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

output += '1. OpenForm is used ONLY ONCE at session start\n';
output += '2. New pages are opened via Navigate (menu navigation)\n';
output += '3. Related records are opened via InvokeAction\n';
output += '4. LoadForm is used to load data into existing forms (factboxes/parts)\n';
output += '5. openFormIds accumulates across the session as forms stay open\n';
output += '6. Real BC never calls OpenForm repeatedly for different pages!\n\n';

// Write to file
writeFileSync('wireshark-bc-calls.txt', output);
console.log('✓ Wireshark analysis written to wireshark-bc-calls.txt');
console.log(`  ${allInteractions.length} interactions analyzed`);
console.log(`  ${Object.keys(interactionsByType).length} interaction types found`);
