import fs from 'fs/promises';

const data = JSON.parse(await fs.readFile('captured-websocket.json', 'utf-8'));

// Find Tell Me related messages
const tellmeMessages = data.filter((msg, index) => {
  const payload = msg.payload;

  // Check for systemAction 220 (open Tell Me)
  if (payload?.params?.[0]?.interactionsToInvoke?.some(i =>
    i.namedParameters?.includes('systemAction') &&
    i.namedParameters?.includes('220')
  )) {
    console.log(`[${index}] Found Tell Me open request`);
    return true;
  }

  // Check for SaveValue (search query)
  if (payload?.params?.[0]?.interactionsToInvoke?.some(i =>
    i.interactionName === 'SaveValue' &&
    i.namedParameters?.includes('ven')
  )) {
    console.log(`[${index}] Found SaveValue with "ven"`);
    return true;
  }

  // Check for responses with LogicalForm
  if (payload?.compressedResult || payload?.result) {
    // This might be a response, include it
    return index > 0 && data[index - 1].direction === 'sent';
  }

  return false;
});

console.log(`\nFound ${tellmeMessages.length} Tell Me related messages`);

// Save to file
await fs.writeFile(
  'tellme-with-results.json',
  JSON.stringify(tellmeMessages, null, 2)
);

console.log('Saved to tellme-with-results.json');

// Now let's specifically look for the search response with results
const searchResponse = data.find((msg, index) => {
  if (msg.direction === 'received' && index > 0) {
    const prevMsg = data[index - 1];
    if (prevMsg.direction === 'sent' &&
        prevMsg.payload?.params?.[0]?.interactionsToInvoke?.some(i =>
          i.interactionName === 'SaveValue' &&
          i.namedParameters?.includes('ven')
        )) {
      return true;
    }
  }
  return false;
});

if (searchResponse) {
  console.log('\nFound search response! Extracting compressed payload...');
  await fs.writeFile(
    'search-response-with-results.json',
    JSON.stringify(searchResponse, null, 2)
  );
  console.log('Saved to search-response-with-results.json');
}
