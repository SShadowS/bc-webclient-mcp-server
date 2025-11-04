/**
 * Find Filter Fields Metadata in LoadForm Responses
 *
 * Searches for column/field metadata containing canonical filter IDs
 */

import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('./filter-pane-capture.json', 'utf-8'));

console.log('═══════════════════════════════════════════════════════════');
console.log('  Searching for Filter Field Metadata');
console.log('═══════════════════════════════════════════════════════════\n');

// Get received messages (server responses)
const receivedMessages = data.websocketMessages.filter(m => m.direction === 'received');

console.log(`Total received messages: ${receivedMessages.length}\n`);

// Search through all handlers for metadata containing field IDs
let foundMetadata = [];

receivedMessages.forEach((msg, msgIdx) => {
  const result = msg.payload?.result;
  if (!result) return;

  const handlers = result.handlers || [];

  handlers.forEach((handler, handlerIdx) => {
    // Look for PropertyChanges handlers (contain metadata)
    if (handler.handlerType === 'DN.LogicalClientChangeHandler') {
      const formId = handler.parameters?.[0];
      const changes = handler.parameters?.[1] || [];

      changes.forEach((change, changeIdx) => {
        if (change.t === 'PropertyChanges') {
          // Look for filter-related properties
          const props = change.PropertyChanges || {};

          // Search recursively for any property containing "filter" or field IDs
          function searchForFilterMetadata(obj, path = '') {
            if (!obj || typeof obj !== 'object') return;

            for (const [key, value] of Object.entries(obj)) {
              const currentPath = path ? `${path}.${key}` : key;

              // Check if key or value contains filter-related info
              const isFilterRelated =
                key.toLowerCase().includes('filter') ||
                key.toLowerCase().includes('field') ||
                key.toLowerCase().includes('column') ||
                (typeof value === 'string' && value.match(/^\d+_\w+\.\d+$/)); // Match "18_Customer.2" format

              if (isFilterRelated) {
                foundMetadata.push({
                  messageIndex: msgIdx,
                  handlerIndex: handlerIdx,
                  changeIndex: changeIdx,
                  path: currentPath,
                  key,
                  value: typeof value === 'object' ? JSON.stringify(value).substring(0, 200) : value,
                  formId
                });
              }

              if (typeof value === 'object' && !Array.isArray(value)) {
                searchForFilterMetadata(value, currentPath);
              } else if (Array.isArray(value)) {
                value.forEach((item, idx) => {
                  if (typeof item === 'object') {
                    searchForFilterMetadata(item, `${currentPath}[${idx}]`);
                  }
                });
              }
            }
          }

          searchForFilterMetadata(props);
        }

        // Also check for any other change types that might contain field metadata
        if (change.t !== 'PropertyChanges' && change.t !== 'DataRefreshChange') {
          const changeStr = JSON.stringify(change);
          if (changeStr.includes('filter') || changeStr.includes('Filter') ||
              changeStr.match(/\d+_\w+\.\d+/)) {
            foundMetadata.push({
              messageIndex: msgIdx,
              changeType: change.t,
              snippet: changeStr.substring(0, 300)
            });
          }
        }
      });
    }

    // Also check the handler parameters directly
    const handlerStr = JSON.stringify(handler);
    if (handlerStr.includes('18_Customer') || handlerStr.match(/filterColumn|FilterColumn/)) {
      foundMetadata.push({
        messageIndex: msgIdx,
        handlerIndex: handlerIdx,
        handlerType: handler.handlerType,
        snippet: handlerStr.substring(0, 300)
      });
    }
  });
});

console.log(`Found ${foundMetadata.length} potential filter metadata entries:\n`);

if (foundMetadata.length > 0) {
  foundMetadata.slice(0, 10).forEach((meta, idx) => {
    console.log(`[${idx + 1}] Message ${meta.messageIndex}, Handler ${meta.handlerIndex}`);
    if (meta.path) {
      console.log(`    Path: ${meta.path}`);
      console.log(`    Key: ${meta.key}`);
      console.log(`    Value: ${meta.value}`);
    } else if (meta.snippet) {
      console.log(`    Snippet: ${meta.snippet}`);
    }
    console.log('');
  });

  if (foundMetadata.length > 10) {
    console.log(`... and ${foundMetadata.length - 10} more entries\n`);
  }
} else {
  console.log('No filter field metadata found in PropertyChanges.\n');
  console.log('Let me search for repeater/grid column definitions...\n');

  // Alternative: Look for repeater column definitions
  receivedMessages.forEach((msg, msgIdx) => {
    const result = msg.payload?.result;
    if (!result) return;

    const handlers = result.handlers || [];
    handlers.forEach((handler) => {
      if (handler.handlerType === 'DN.LogicalClientChangeHandler') {
        const changes = handler.parameters?.[1] || [];
        changes.forEach((change) => {
          if (change.t === 'PropertyChanges') {
            const props = change.PropertyChanges || {};

            // Look for columns/repeater definitions
            function findColumnDefs(obj, path = '') {
              if (!obj || typeof obj !== 'object') return;

              for (const [key, value] of Object.entries(obj)) {
                if (key === 'columns' || key === 'Columns' || key === 'repeaterColumns') {
                  console.log(`Found columns at: ${path}.${key}`);
                  console.log(`  Type: ${typeof value}`);
                  if (Array.isArray(value)) {
                    console.log(`  Count: ${value.length}`);
                    console.log(`  First column:`, JSON.stringify(value[0], null, 2).substring(0, 500));
                  }
                  console.log('');
                }

                if (typeof value === 'object') {
                  findColumnDefs(value, path ? `${path}.${key}` : key);
                }
              }
            }

            findColumnDefs(props);
          }
        });
      }
    });
  });
}

// Save detailed results
writeFileSync('filter-metadata-search.json', JSON.stringify({
  totalReceived: receivedMessages.length,
  foundMetadata,
  timestamp: new Date().toISOString()
}, null, 2));

console.log('✓ Detailed results saved to: filter-metadata-search.json');
