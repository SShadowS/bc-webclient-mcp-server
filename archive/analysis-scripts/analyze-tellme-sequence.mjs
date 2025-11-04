import fs from 'fs/promises';
import { gunzipSync } from 'zlib';

const data = JSON.parse(await fs.readFile('captured-websocket.json', 'utf-8'));

// Find SaveValue for search
const saveValueIdx = data.findIndex(m =>
  m.payload &&
  JSON.stringify(m.payload).includes('SaveValue') &&
  JSON.stringify(m.payload).includes('isFilterAsYouType')
);

console.log(`Found SaveValue at index ${saveValueIdx}`);
console.log('\n=== MESSAGE SEQUENCE AFTER SaveValue ===\n');

for (let i = saveValueIdx; i < saveValueIdx + 10 && i < data.length; i++) {
  const msg = data[i];

  console.log(`[${i}] ${msg.direction || (msg.type === 'message' ? 'RECEIVED' : 'SENT')}`);
  console.log(`    Timestamp: ${msg.iso || msg.timestamp}`);

  if (msg.payload) {
    const p = msg.payload;

    if (p.method) {
      console.log(`    Method: ${p.method}`);

      if (p.method === 'Invoke' && p.params && p.params[0]) {
        const invokes = p.params[0].interactionsToInvoke;
        if (invokes) {
          invokes.forEach(inv => {
            console.log(`      → ${inv.interactionName}`);
          });
        }
      }
    }

    if (p.compressedResult) {
      try {
        const buffer = Buffer.from(p.compressedResult, 'base64');
        const decompressed = gunzipSync(buffer);
        const handlers = JSON.parse(decompressed.toString('utf8'));

        console.log(`    Response: ${handlers.length} handlers`);
        handlers.forEach((h, idx) => {
          console.log(`      [${idx}] ${h.handlerType}`);

          if (h.handlerType === 'DN.LogicalClientChangeHandler') {
            const changes = h.parameters?.[1];
            if (Array.isArray(changes)) {
              const refreshChanges = changes.filter(c => c.t === 'DataRefreshChange');
              refreshChanges.forEach(rc => {
                const rowCount = rc.RowChanges?.length || 0;
                console.log(`          → DataRefreshChange: ${rowCount} rows (${rc.ControlReference?.controlPath})`);
              });
            }
          }
        });
      } catch (e) {
        console.log(`    (Could not decompress: ${e.message})`);
      }
    }
  }

  console.log('');
}
