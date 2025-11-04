/**
 * Analyze FULL WebSocket Capture
 *
 * Analyzes websocket-cdp-capture.json which includes both sent AND received messages.
 */

import { readFileSync } from 'fs';

const captures = JSON.parse(readFileSync('websocket-cdp-capture.json', 'utf8'));

console.log('═══════════════════════════════════════════════════════════');
console.log('  Full WebSocket Capture Analysis');
console.log('  (Including sent AND received messages)');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log(`Total messages: ${captures.length}`);
console.log('');

// Direction breakdown
const byDirection = { sent: 0, received: 0 };
for (const msg of captures) {
  byDirection[msg.direction]++;
}

console.log('By direction:');
console.log(`  Sent:     ${byDirection.sent}`);
console.log(`  Received: ${byDirection.received}`);
console.log('');

// Extract all interactions from all messages
const allInteractions = [];
const receivedInteractions = [];

for (const msg of captures) {
  if (msg.payload?.params) {
    const params = Array.isArray(msg.payload.params) ? msg.payload.params[0] : msg.payload.params;
    const interactions = params?.interactionsToInvoke || [];
    for (const int of interactions) {
      allInteractions.push({ ...int, messageDirection: msg.direction });
      if (msg.direction === 'received') {
        receivedInteractions.push(int);
      }
    }
  }

  // Check for interactions in results (server responses)
  if (msg.payload?.result) {
    const result = msg.payload.result;
    const handlers = result.handlers || result.invokeResult?.handlers || [];
    if (handlers.length > 0) {
      console.log(`\n📨 Found ${handlers.length} handlers in received message`);
      console.log(`   Message direction: ${msg.direction}`);
      if (handlers.length <= 3) {
        for (const h of handlers) {
          console.log(`   - ${h.handlerType || 'unknown handler'}`);
        }
      }
    }
  }
}

console.log(`Total interactions found: ${allInteractions.length}`);
console.log(`  From sent messages: ${allInteractions.filter(i => i.messageDirection === 'sent').length}`);
console.log(`  From received messages: ${allInteractions.filter(i => i.messageDirection === 'received').length}`);
console.log('');

// Group by interaction name
const byName = new Map();
for (const int of allInteractions) {
  const key = `${int.interactionName} (${int.messageDirection})`;
  byName.set(key, (byName.get(key) || 0) + 1);
}

console.log('Interactions by type and direction:');
for (const [name, count] of Array.from(byName.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name}: ${count}`);
}
console.log('');

// Search for specific keywords
const keywords = ['ChangeField', 'InvokeAction', 'Navigate', 'SetFilter'];
console.log('Keyword search in ALL messages:');
for (const keyword of keywords) {
  const count = captures.filter(msg => {
    const text = JSON.stringify(msg.payload || {});
    return text.includes(keyword);
  }).length;
  console.log(`  "${keyword}": ${count} messages`);
}
console.log('');

// Find examples of ChangeField and InvokeAction
const changeFieldMsgs = captures.filter(msg => {
  const text = JSON.stringify(msg.payload || {});
  return text.includes('ChangeField');
});

const invokeActionMsgs = captures.filter(msg => {
  const text = JSON.stringify(msg.payload || {});
  return text.includes('InvokeAction');
});

if (changeFieldMsgs.length > 0) {
  console.log(`\n🎯 Found ${changeFieldMsgs.length} messages containing "ChangeField"`);
  console.log('   Directions:');
  console.log(`   - Sent: ${changeFieldMsgs.filter(m => m.direction === 'sent').length}`);
  console.log(`   - Received: ${changeFieldMsgs.filter(m => m.direction === 'received').length}`);
}

if (invokeActionMsgs.length > 0) {
  console.log(`\n🎯 Found ${invokeActionMsgs.length} messages containing "InvokeAction"`);
  console.log('   Directions:');
  console.log(`   - Sent: ${invokeActionMsgs.filter(m => m.direction === 'sent').length}`);
  console.log(`   - Received: ${invokeActionMsgs.filter(m => m.direction === 'received').length}`);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('📋 SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

if (changeFieldMsgs.length > 0 || invokeActionMsgs.length > 0) {
  console.log('✅ SUCCESS! Found target interactions in full capture!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Extract ChangeField examples');
  console.log('  2. Extract InvokeAction examples');
  console.log('  3. Compare with tool implementations');
  console.log('');
} else {
  console.log('⚠️  ChangeField and InvokeAction NOT found in capture');
  console.log('');
  console.log('This means the actions you performed were not captured.');
  console.log('Recommendation: Run a new focused capture session.');
  console.log('');
}
