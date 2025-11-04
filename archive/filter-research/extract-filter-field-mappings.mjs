/**
 * Extract Filter Field Mappings from Page Metadata
 */

import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('./dataset-metadata-investigation.json', 'utf-8'));

// Find all objects with Id and Caption
function findFilterFields(obj, results = []) {
  if (!obj || typeof obj !== 'object') return results;

  if (obj.Id && obj.Caption && obj.Id.match(/^\d+_\w+\.\d+/)) {
    results.push({
      id: obj.Id,
      caption: obj.Caption,
      scope: obj.source?.scope,
      submenu: obj.Submenu
    });
  }

  for (const value of Object.values(obj)) {
    if (typeof value === 'object') {
      findFilterFields(value, results);
    }
  }

  return results;
}

const fields = findFilterFields(data);

console.log('═══════════════════════════════════════════════════════════');
console.log('  Filter Field Mappings from Page Metadata');
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`Found ${fields.length} filterable fields:\n`);

// Remove duplicates
const uniqueFields = [];
const seen = new Set();
for (const field of fields) {
  const key = `${field.id}:${field.caption}`;
  if (!seen.has(key)) {
    seen.add(key);
    uniqueFields.push(field);
  }
}

console.log(`Unique fields: ${uniqueFields.length}\n`);

uniqueFields.forEach(f => {
  const scope = f.scope ? ` [${f.scope}]` : '';
  const submenu = f.submenu ? ` (submenu: ${f.submenu})` : '';
  console.log(`  ${f.id.padEnd(30)} → ${f.caption}${scope}${submenu}`);
});

// Save mapping
const mapping = {};
uniqueFields.forEach(f => {
  mapping[f.caption] = f.id;
});

writeFileSync('filter-field-mapping.json', JSON.stringify({
  total: uniqueFields.length,
  mapping,
  allFields: uniqueFields
}, null, 2));

console.log('\n✓ Saved mapping to: filter-field-mapping.json');
