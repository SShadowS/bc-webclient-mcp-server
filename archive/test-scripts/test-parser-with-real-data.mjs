import fs from 'fs/promises';
import { gunzipSync } from 'zlib';

// Load the captured response with real results
const responseData = JSON.parse(await fs.readFile('search-response-with-results.json', 'utf-8'));

// Decompress
const buffer = Buffer.from(responseData.payload.compressedResult, 'base64');
const decompressed = gunzipSync(buffer);
const handlers = JSON.parse(decompressed.toString('utf8'));

console.log('Testing parser with real captured data...\n');

// Simulate our parser logic
const changeHandler = handlers.find(h => h.handlerType === 'DN.LogicalClientChangeHandler');

if (!changeHandler) {
  console.log('❌ No LogicalClientChangeHandler found');
  process.exit(1);
}

const changes = changeHandler.parameters?.[1];
const pagesDataChange = changes.find(c =>
  c.t === 'DataRefreshChange' &&
  c.ControlReference?.controlPath === 'server:c[1]'
);

if (!pagesDataChange) {
  console.log('❌ No pages DataRefreshChange found');
  process.exit(1);
}

console.log(`✓ Found DataRefreshChange with ${pagesDataChange.RowChanges.length} rows\n`);

// Extract results
const results = pagesDataChange.RowChanges
  .filter(row => row.t === 'DataRowInserted')
  .map(row => {
    const rowData = row.DataRowInserted?.[1];
    const cells = rowData?.cells;

    if (!cells) return null;

    // Extract page ID from CacheKey
    const cacheKey = cells.CacheKey?.stringValue || '';
    const pageIdMatch = cacheKey.match(/^(\d+):/);
    const pageId = pageIdMatch ? pageIdMatch[1] : '';

    const name = cells.Name?.stringValue || '';
    const category = cells.DepartmentCategory?.stringValue || '';

    return {
      name,
      category,
      pageId,
      cacheKey: cacheKey.substring(0, 50) + '...'
    };
  })
  .filter(r => r !== null);

console.log('Parsed Results:\n');
results.slice(0, 5).forEach((r, i) => {
  console.log(`${i + 1}. ${r.name}`);
  console.log(`   Page ID: ${r.pageId}`);
  console.log(`   Category: ${r.category}`);
  console.log('');
});

console.log(`✅ Successfully parsed ${results.length} pages!`);
