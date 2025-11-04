import { readFileSync } from 'fs';

const data = JSON.parse(readFileSync('./dataset-metadata-investigation.json', 'utf-8'));
const ds = data.datasetInfo[0];

console.log('═══════════════════════════════════════════════════════════');
console.log('  DataRefreshChange Structure');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('ControlReference:', JSON.stringify(ds.controlReference, null, 2));
console.log('\nDataSetId:', ds.dataSetId);
console.log('\nColumns:', ds.columns ? ds.columns.length : 'undefined');
console.log('\nRowChanges:', ds.rowChanges ? JSON.stringify(ds.rowChanges, null, 2).substring(0, 500) + '...' : 'undefined');
console.log('\nUpdates:', ds.updates ? JSON.stringify(ds.updates, null, 2).substring(0, 500) + '...' : 'undefined');

if (ds.rawChange) {
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  Raw Change Object Keys');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(Object.keys(ds.rawChange).join(', '));

  // Look for RowChanges structure
  if (ds.rawChange.RowChanges) {
    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('  RowChanges Structure');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('Type:', Array.isArray(ds.rawChange.RowChanges) ? 'Array' : typeof ds.rawChange.RowChanges);
    console.log('Length:', ds.rawChange.RowChanges.length || 'N/A');

    if (Array.isArray(ds.rawChange.RowChanges) && ds.rawChange.RowChanges.length > 0) {
      console.log('\nFirst RowChange:');
      const firstRow = ds.rawChange.RowChanges[0];
      console.log('  Type:', firstRow.t);
      console.log('  Keys:', Object.keys(firstRow).join(', '));

      // Look for column data in the first row
      if (firstRow.DataRowInserted) {
        console.log('\n  DataRowInserted structure:');
        console.log('    ', JSON.stringify(firstRow.DataRowInserted, null, 4).substring(0, 1000));
      }
    }
  }
}

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('  Looking for Column Metadata');
console.log('═══════════════════════════════════════════════════════════\n');

// Search for column-like structures in the entire response
function findColumnStructures(obj, path = '') {
  if (!obj || typeof obj !== 'object') return;

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;

    // Look for arrays that might be column definitions
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (first && typeof first === 'object' && (first.id || first.fieldId || first.caption || first.name)) {
        console.log(`Found potential column array at: ${currentPath}`);
        console.log(`  Length: ${value.length}`);
        console.log(`  First element:`, JSON.stringify(first));
        console.log('');
      }
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      findColumnStructures(value, currentPath);
    }
  }
}

findColumnStructures(ds.rawChange);
