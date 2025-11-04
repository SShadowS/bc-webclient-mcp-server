import fs from 'fs/promises';
import { gunzipSync } from 'zlib';

const responseData = JSON.parse(await fs.readFile('search-response-with-results.json', 'utf-8'));
const compressedPayload = responseData.payload.compressedResult;

// Decompress
const buffer = Buffer.from(compressedPayload, 'base64');
const decompressed = gunzipSync(buffer);
const handlers = JSON.parse(decompressed.toString('utf8'));

console.log('Handlers:');
handlers.forEach((h, i) => {
  console.log(`  ${i}: ${h.handlerType}`);
});

// Get the LogicalClientChangeHandler
const changeHandler = handlers.find(h => h.handlerType === 'DN.LogicalClientChangeHandler');

if (!changeHandler) {
  console.log('\nNo LogicalClientChangeHandler found!');
  process.exit(1);
}

console.log('\nLogicalClientChangeHandler found!');
console.log('Parameters:', changeHandler.parameters);

// The parameters should contain the form changes
// Save full handler for analysis
await fs.writeFile(
  'change-handler.json',
  JSON.stringify(changeHandler, null, 2)
);
console.log('Saved to change-handler.json');

// Look for LogicalForm or form changes
const params = changeHandler.parameters;
if (params && params.length > 0) {
  console.log(`\nFirst parameter type: ${params[0]?.t || params[0]?.constructor?.name || typeof params[0]}`);

  // Save first parameter
  await fs.writeFile(
    'form-changes.json',
    JSON.stringify(params[0], null, 2)
  );
  console.log('Saved first parameter to form-changes.json');
}
