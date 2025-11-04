/**
 * Find ServerIds in first server response to understand structure
 */

import { readFileSync, writeFileSync } from 'fs';

const decomp = JSON.parse(readFileSync('decompressed-responses.json', 'utf-8'));

// First response (Page 22)
const first = decomp[0];

console.log(`\n${'═'.repeat(80)}`);
console.log(`  Finding ServerId Structure in First Response`);
console.log(`${'═'.repeat(80)}\n`);

// Recursively search for ServerIds
function findServerIds(obj, path = '', depth = 0) {
  if (depth > 20) return []; // Prevent infinite recursion

  const results = [];

  if (!obj || typeof obj !== 'object') return results;

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      results.push(...findServerIds(item, `${path}[${i}]`, depth + 1));
    });
  } else {
    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;

      if (key === 'ServerId') {
        results.push({ path: newPath, serverId: value });
      }

      if (typeof value === 'object') {
        results.push(...findServerIds(value, newPath, depth + 1));
      }
    }
  }

  return results;
}

const serverIds = findServerIds(first.data);

console.log(`Found ${serverIds.length} ServerId references\n`);
console.log('First 20 ServerIds:\n');
serverIds.slice(0, 20).forEach(({ path, serverId }) => {
  console.log(`  ${serverId.padEnd(6)} @ ${path}`);
});
if (serverIds.length > 20) {
  console.log(`  ... and ${serverIds.length - 20} more\n`);
}

// Extract unique ServerIds
const uniqueIds = [...new Set(serverIds.map(s => s.serverId))];
console.log(`\nUnique ServerIds: ${uniqueIds.join(', ')}\n`);

// Save structure
writeFileSync('serverid-structure.json', JSON.stringify({
  frame: 0,
  timestamp: first.timestamp,
  totalServerIds: serverIds.length,
  uniqueServerIds: uniqueIds,
  allPaths: serverIds.map(s => ({ serverId: s.serverId, path: s.path }))
}, null, 2));

console.log('✓ Saved to serverid-structure.json\n');
