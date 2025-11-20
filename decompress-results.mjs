import fs from 'fs/promises';
import { gunzipSync } from 'zlib';

const responseData = JSON.parse(await fs.readFile('search-response-with-results.json', 'utf-8'));

// Check for compressed payload
const compressedPayload = responseData.payload?.compressedResult;

if (!compressedPayload) {
  console.log('No compressed payload found');
  process.exit(1);
}

// Decompress
console.log('Decompressing payload...');
const buffer = Buffer.from(compressedPayload, 'base64');
const decompressed = gunzipSync(buffer);
const jsonString = decompressed.toString('utf8');
const handlers = JSON.parse(jsonString);

console.log(`Found ${handlers.length} handlers`);

// Find LogicalForm
const formHandler = handlers.find(h =>
  h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
  h.parameters?.[0] === 'FormToShow'
);

if (!formHandler) {
  console.log('No FormToShow handler found');
  process.exit(1);
}

const logicalForm = formHandler.parameters[1];
console.log(`LogicalForm ID: ${logicalForm.ServerId}`);

// Save full decompressed response
await fs.writeFile(
  'decompressed-search-with-results.json',
  JSON.stringify(handlers, null, 2)
);
console.log('Saved decompressed handlers to decompressed-search-with-results.json');

// Extract repeater control
const repeater = logicalForm.Children?.[1] || logicalForm.Controls?.[1];
console.log(`\nRepeater control:`);
console.log(`  Type: ${repeater?.t}`);
console.log(`  MappingHint: ${repeater?.MappingHint}`);

// Check for Value
const resultsArray = repeater?.Value || repeater?.Properties?.Value;
console.log(`  Has results: ${!!resultsArray}`);
console.log(`  Result count: ${resultsArray?.length || 0}`);

if (resultsArray && resultsArray.length > 0) {
  console.log(`\nFirst result structure:`);
  console.log(JSON.stringify(resultsArray[0], null, 2));

  // Save just the results array
  await fs.writeFile(
    'tellme-results-array.json',
    JSON.stringify(resultsArray, null, 2)
  );
  console.log('\nSaved results array to tellme-results-array.json');
} else {
  console.log('\nNo results found in repeater!');
}
