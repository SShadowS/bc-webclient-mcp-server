import { readFileSync } from 'fs';

const data = JSON.parse(readFileSync('filter-websocket-capture.json', 'utf-8'));
const sent = data.filter(m => m.direction === 'sent');

console.log('Sent messages:\n');

sent.forEach((msg, idx) => {
  try {
    const payload = JSON.parse(msg.payloadText);
    console.log(`${idx + 1}. ${payload.method || 'unknown'} at ${msg.iso}`);

    if (payload.params && payload.params[0]) {
      const param = payload.params[0];
      if (Array.isArray(param)) {
        console.log(`   Array with ${param.length} items`);
        param.forEach((item, i) => {
          if (item.interactionName) {
            console.log(`     [${i}] interactionName: ${item.interactionName}`);
          }
        });
      } else if (typeof param === 'object') {
        const keys = Object.keys(param).slice(0, 10);
        console.log('   Object keys:', keys.join(', '));
      }
    }
  } catch (e) {
    console.log(`${idx + 1}. Failed to parse: ${e.message}`);
  }
  console.log('');
});
