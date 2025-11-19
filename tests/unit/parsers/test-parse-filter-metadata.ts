/**
 * Test Filter Metadata Parser
 *
 * Verifies we can extract filter field mappings from LoadForm response metadata
 */

import { readFileSync } from 'fs';

interface FilterFieldMetadata {
  id: string;           // Canonical field ID (e.g., "18_Customer.2")
  caption: string;      // User-friendly name (e.g., "Name")
  scope?: string;       // "filter" if filterable
  submenu?: string;
  tableFieldNo?: number;
  maxLength?: number;
}

/**
 * Recursively search object tree for filterable field definitions
 */
function findFilterFields(obj: any, results: FilterFieldMetadata[] = []): FilterFieldMetadata[] {
  if (!obj || typeof obj !== 'object') return results;

  // Look for objects with Id and Caption matching canonical field format
  if (obj.Id && obj.Caption && typeof obj.Id === 'string' && obj.Id.match(/^\d+_\w+\.\d+/)) {
    results.push({
      id: obj.Id,
      caption: obj.Caption,
      scope: obj.source?.scope,
      submenu: obj.Submenu,
    });
  }

  // Also look for ColumnBinderPath (alternative location for canonical IDs)
  if (obj.ColumnBinderPath && typeof obj.ColumnBinderPath === 'string' &&
      obj.ColumnBinderPath.match(/^\d+_\w+\.\d+/)) {
    // Try to find associated caption
    const caption = obj.Caption || obj.FieldName || obj.ColumnBinderPath;
    results.push({
      id: obj.ColumnBinderPath,
      caption: caption,
      tableFieldNo: obj.TableFieldNo,
      maxLength: obj.MaxLength,
    });
  }

  // Recursively search nested objects and arrays
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      findFilterFields(value, results);
    }
  }

  return results;
}

/**
 * Build Caption → Canonical ID mapping from filter fields
 */
function buildFilterMapping(fields: FilterFieldMetadata[]): Map<string, string> {
  const mapping = new Map<string, string>();

  // Remove duplicates, preferring entries with scope="filter"
  const uniqueFields = new Map<string, FilterFieldMetadata>();

  for (const field of fields) {
    const existing = uniqueFields.get(field.caption);

    // Prefer fields explicitly marked with scope="filter"
    if (!existing || (field.scope === 'filter' && existing.scope !== 'filter')) {
      uniqueFields.set(field.caption, field);
    }
  }

  // Build caption → ID mapping
  for (const [caption, field] of uniqueFields) {
    mapping.set(caption, field.id);
  }

  return mapping;
}

// Test with dataset-metadata-investigation.json
console.log('═══════════════════════════════════════════════════════════');
console.log('  Filter Metadata Parser Test');
console.log('═══════════════════════════════════════════════════════════\n');

const data = JSON.parse(readFileSync('./dataset-metadata-investigation.json', 'utf-8'));

console.log('Parsing LoadForm response metadata...\n');

const fields = findFilterFields(data);
console.log(`Found ${fields.length} filterable field definitions\n`);

// Build mapping
const mapping = buildFilterMapping(fields);
console.log(`Built mapping with ${mapping.size} unique captions\n`);

// Show sample mappings
console.log('Sample mappings (caption → canonical ID):\n');
const samples = Array.from(mapping.entries()).slice(0, 15);
for (const [caption, id] of samples) {
  console.log(`  "${caption}".padEnd(30)} → ${id}`);
}

if (mapping.size > 15) {
  console.log(`  ... and ${mapping.size - 15} more\n`);
}

// Test specific lookups
console.log('\nTesting lookups:');
const testCases = ['Name', 'No.', 'Balance', 'Phone No.', 'City'];

for (const caption of testCases) {
  const id = mapping.get(caption);
  if (id) {
    console.log(`  ✓ "${caption}" → ${id}`);
  } else {
    console.log(`  ✗ "${caption}" → NOT FOUND`);
  }
}

// Verify known mapping from capture
console.log('\nVerifying known mapping from filter capture:');
const knownCaption = 'Name';
const knownId = '18_Customer.2';
const resolved = mapping.get(knownCaption);

if (resolved === knownId) {
  console.log(`  ✓ SUCCESS: "${knownCaption}" → ${knownId}`);
} else {
  console.log(`  ✗ FAILED: "${knownCaption}" → ${resolved} (expected ${knownId})`);
}

console.log('\n✓ Parser test complete');
