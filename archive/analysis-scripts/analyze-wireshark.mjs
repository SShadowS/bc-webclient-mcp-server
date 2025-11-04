/**
 * Parse Wireshark WebSocket capture to extract OpenForm parameters
 */
import { readFileSync } from 'fs';

const captureFile = 'C:\\bc4ubuntu\\Decompiled\\WiresharkWebSocket2.txt';
const content = readFileSync(captureFile, 'utf-8');

// Split into lines and find ALL interactions to analyze workflow
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
              openFormIds: params.openFormIds,
            }
          });
        }
      }
    }

    // Also check for OpenSession
    if (json.method === 'OpenSession' && json.params) {
      const params = json.params[0];
      if (params.interactionsToInvoke) {
        for (const interaction of params.interactionsToInvoke) {
          let namedParams = {};
          try {
            namedParams = JSON.parse(interaction.namedParameters || '{}');
          } catch {
            namedParams = { raw: interaction.namedParameters };
          }

          allInteractions.push({
            method: 'OpenSession',
            interactionName: interaction.interactionName,
            namedParameters: namedParams,
            formId: interaction.formId,
            controlPath: interaction.controlPath,
            callbackId: interaction.callbackId,
            sessionInfo: {
              company: params.company,
              tenantId: params.tenantId,
              openFormIds: params.openFormIds,
            }
          });
        }
      }
    }
  } catch (err) {
    // Skip malformed lines
  }
}

console.log(`Found ${allInteractions.length} total interactions\n`);

// Group by interaction type
const interactionsByType = {};
for (const interaction of allInteractions) {
  if (!interactionsByType[interaction.interactionName]) {
    interactionsByType[interaction.interactionName] = [];
  }
  interactionsByType[interaction.interactionName].push(interaction);
}

// Show summary
console.log('═══════════════════════════════════════════════════════════');
console.log('Interaction Type Summary');
console.log('═══════════════════════════════════════════════════════════\n');
for (const [type, interactions] of Object.entries(interactionsByType)) {
  console.log(`${type}: ${interactions.length} occurrences`);
}

// Show detailed workflow
console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('Interaction Workflow (Chronological Order)');
console.log('═══════════════════════════════════════════════════════════\n');

for (let i = 0; i < allInteractions.length; i++) {
  const req = allInteractions[i];
  console.log(`\n${i + 1}. ${req.method} > ${req.interactionName}`);
  console.log('─────────────────────────────────────────────────────────');

  console.log(`  Method: ${req.method}`);
  if (req.formId) {
    console.log(`  FormId: ${req.formId}`);
  }
  if (req.controlPath) {
    console.log(`  ControlPath: ${req.controlPath}`);
  }
  console.log(`  Callback ID: ${req.callbackId}`);

  if (req.sessionInfo.openFormIds && req.sessionInfo.openFormIds.length > 0) {
    console.log(`  OpenFormIds: [${req.sessionInfo.openFormIds.join(', ')}]`);
  }

  console.log('\n  Named Parameters:');
  if (req.namedParameters.query) {
    // Parse query string
    const query = req.namedParameters.query;
    const params = new URLSearchParams(query);
    for (const [key, value] of params.entries()) {
      console.log(`    ${key}: ${value}`);
    }
  } else {
    // Direct parameters
    for (const [key, value] of Object.entries(req.namedParameters)) {
      const displayValue = typeof value === 'string' && value.length > 80
        ? value.substring(0, 80) + '...'
        : value;
      console.log(`    ${key}: ${displayValue}`);
    }
  }
}

// Summary of unique parameter keys
console.log(`\n\n═══════════════════════════════════════════════════════════`);
console.log(`Parameter Key Summary`);
console.log(`═══════════════════════════════════════════════════════════\n`);

const paramsByInteractionType = {};

for (const req of allInteractions) {
  if (!paramsByInteractionType[req.interactionName]) {
    paramsByInteractionType[req.interactionName] = new Set();
  }

  for (const key of Object.keys(req.namedParameters)) {
    paramsByInteractionType[req.interactionName].add(key);
  }
}

for (const [type, keys] of Object.entries(paramsByInteractionType)) {
  console.log(`${type} parameters: ${Array.from(keys).join(', ')}`);
}
