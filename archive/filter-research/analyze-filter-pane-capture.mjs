/**
 * Analyze Filter Pane Capture
 *
 * Extracts and analyzes filter pane related interactions from the capture.
 */

import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('./filter-pane-capture.json', 'utf-8'));

console.log('═══════════════════════════════════════════════════════════');
console.log('  Filter Pane Capture Analysis');
console.log('═══════════════════════════════════════════════════════════\n');

console.log(`Total WebSocket messages: ${data.websocketMessages.length}`);
console.log(`Total HTTP requests: ${data.httpRequests.length}\n`);

// Extract sent messages (client → server)
const sentMessages = data.websocketMessages
  .filter(m => m.direction === 'sent' && m.payload?.method)
  .map(m => ({
    timestamp: m.iso,
    method: m.payload.method,
    params: m.payload.params,
    id: m.payload.id,
  }));

// Extract interactions from Message/Invoke methods
const sentInteractions = data.websocketMessages
  .filter(m => m.direction === 'sent' && (m.payload?.method === 'Message' || m.payload?.method === 'Invoke'))
  .flatMap(m => {
    const params = m.payload?.params?.[0] || {};
    const interactions = params.interactionsToInvoke || [];
    return interactions.map(interaction => ({
      timestamp: m.iso,
      messageMethod: m.payload.method,
      ...interaction
    }));
  });

console.log(`\nSent messages by method:`);
const messagesByMethod = {};
sentMessages.forEach(m => {
  if (!messagesByMethod[m.method]) messagesByMethod[m.method] = [];
  messagesByMethod[m.method].push(m);
});
for (const [method, msgs] of Object.entries(messagesByMethod)) {
  console.log(`  ${method}: ${msgs.length}`);
}

console.log(`\nFound ${sentInteractions.length} client interactions:\n`);

// Group by interaction type
const byType = {};
sentInteractions.forEach(i => {
  const name = i.interactionName;
  if (!byType[name]) byType[name] = [];
  byType[name].push(i);
});

for (const [name, interactions] of Object.entries(byType)) {
  console.log(`${name}: ${interactions.length} times`);

  // Show details for filter-related interactions
  if (name.toLowerCase().includes('filter') ||
      name === 'SaveValue' ||
      name === 'Command' ||
      name === 'InvokeAction') {
    interactions.forEach((interaction, idx) => {
      console.log(`\n  [${idx + 1}] ${interaction.timestamp}`);
      console.log(`      formId: ${interaction.formId}`);
      console.log(`      controlPath: ${interaction.controlPath}`);
      if (interaction.namedParameters) {
        const params = typeof interaction.namedParameters === 'string'
          ? JSON.parse(interaction.namedParameters)
          : interaction.namedParameters;
        console.log(`      params:`, JSON.stringify(params, null, 8));
      }
    });
  }
}

// Look for DataRefreshChange responses that might contain filter picker items
console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('  Looking for Filter Picker Data');
console.log('═══════════════════════════════════════════════════════════\n');

const receivedMessages = data.websocketMessages
  .filter(m => m.direction === 'received' && m.payload?.result);

let pickerDataFound = false;

receivedMessages.forEach((msg, idx) => {
  const handlers = msg.payload?.result?.handlers || [];

  handlers.forEach(handler => {
    if (handler.handlerType === 'DN.LogicalClientChangeHandler') {
      const changes = handler.parameters?.[1] || [];

      changes.forEach(change => {
        // Look for DataRefreshChange with RowChanges (picker items)
        if (change.t === 'DataRefreshChange' && change.RowChanges) {
          const controlRef = change.ControlReference;
          const rowCount = change.RowChanges.length;

          console.log(`\nFound DataRefreshChange:`);
          console.log(`  formId: ${controlRef?.formId}`);
          console.log(`  controlPath: ${controlRef?.controlPath}`);
          console.log(`  rows: ${rowCount}`);

          // Extract first few rows to see structure
          change.RowChanges.slice(0, 3).forEach((row, i) => {
            if (row.t === 'DataRowInserted') {
              const rowData = row.DataRowInserted[1];
              const cells = rowData.cells || {};
              console.log(`\n  Row ${i + 1} cells:`, Object.keys(cells));

              // Show cell data
              for (const [cellId, cellData] of Object.entries(cells)) {
                if (cellData.stringValue) {
                  console.log(`    ${cellId}: "${cellData.stringValue}"`);
                  pickerDataFound = true;
                }
              }
            }
          });
        }
      });
    }
  });
});

if (!pickerDataFound) {
  console.log('No picker data found in DataRefreshChange responses.');
  console.log('The filter picker might use a different mechanism.');
}

// Save detailed analysis
const analysis = {
  summary: {
    totalMessages: data.websocketMessages.length,
    sentInteractions: sentInteractions.length,
    interactionTypes: Object.keys(byType),
  },
  interactionsByType: byType,
  allSentInteractions: sentInteractions,
};

writeFileSync('filter-pane-analysis.json', JSON.stringify(analysis, null, 2));
console.log('\n\n✓ Detailed analysis saved to: filter-pane-analysis.json');
