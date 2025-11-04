/**
 * Analyze ALL WebSocket Messages
 *
 * Checks all messages, not just Invoke, to find field changes and actions.
 */

import { readFileSync } from 'fs';

const captures = JSON.parse(readFileSync('invoke-calls-captured.json', 'utf8'));

console.log('═══════════════════════════════════════════════════════════');
console.log('  Complete WebSocket Message Analysis');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log(`Total messages: ${captures.length}`);
console.log('');

// Categorize messages
const byDirection = { sent: 0, received: 0 };
const byMethod = new Map();
const allInteractions = [];

for (const msg of captures) {
  byDirection[msg.direction]++;

  if (msg.payload?.method) {
    const method = msg.payload.method;
    byMethod.set(method, (byMethod.get(method) || 0) + 1);

    // Collect interactions from Invoke messages
    if (method === 'Invoke') {
      const params = msg.payload?.params?.[0];
      const interactions = params?.interactionsToInvoke || [];
      allInteractions.push(...interactions);
    }
  }
}

console.log('Messages by direction:');
for (const [dir, count] of Object.entries(byDirection)) {
  console.log(`  ${dir}: ${count}`);
}
console.log('');

console.log('Messages by RPC method:');
for (const [method, count] of byMethod.entries()) {
  console.log(`  ${method}: ${count}`);
}
console.log('');

console.log(`Total interactions extracted: ${allInteractions.length}`);
console.log('');

// Group interactions by name
const byInteraction = new Map();
for (const int of allInteractions) {
  const name = int.interactionName;
  byInteraction.set(name, (byInteraction.get(name) || 0) + 1);
}

console.log('Interactions by type:');
for (const [name, count] of byInteraction.entries()) {
  console.log(`  ${name}: ${count}`);
}
console.log('');

// Search for anything that might be field changes or actions
console.log('═══════════════════════════════════════════════════════════');
console.log('🔍 SEARCHING FOR FIELD/ACTION PATTERNS');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// Check sent vs received - maybe field changes are in responses?
const sentMessages = captures.filter(m => m.direction === 'sent');
const receivedMessages = captures.filter(m => m.direction === 'received');

console.log(`Sent messages: ${sentMessages.length}`);
console.log(`Received messages: ${receivedMessages.length}`);
console.log('');

// Sample a received message to see format
if (receivedMessages.length > 0) {
  console.log('Sample received message:');
  const sample = receivedMessages[0];
  console.log(`  Direction: ${sample.direction}`);
  console.log(`  Timestamp: ${sample.iso}`);
  if (sample.payload) {
    console.log(`  Method: ${sample.payload.method || 'none'}`);
    console.log(`  Has result: ${sample.payload.result !== undefined}`);
  }
  console.log('');
}

// Look for specific keywords in all message payloads
const keywords = ['ChangeField', 'InvokeAction', 'field', 'Field', 'value', 'Value', 'action', 'Action', 'button', 'Button', 'click', 'Click'];
const foundKeywords = new Map();

for (const msg of captures) {
  const text = JSON.stringify(msg.payload || {});
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      foundKeywords.set(keyword, (foundKeywords.get(keyword) || 0) + 1);
    }
  }
}

console.log('Keyword occurrences in payloads:');
for (const [keyword, count] of foundKeywords.entries()) {
  console.log(`  "${keyword}": ${count} messages`);
}
console.log('');

// Conclusion
console.log('═══════════════════════════════════════════════════════════');
console.log('📋 CONCLUSION');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const hasChangeField = byInteraction.has('ChangeField');
const hasInvokeAction = byInteraction.has('InvokeAction');

if (!hasChangeField && !hasInvokeAction) {
  console.log('⚠️  The capture session did NOT record:');
  console.log('   - ChangeField interactions (field updates)');
  console.log('   - InvokeAction interactions (button clicks)');
  console.log('');
  console.log('💡 Possible reasons:');
  console.log('   1. Actions/fields were clicked but capture timing missed them');
  console.log('   2. BC uses different interaction names than expected');
  console.log('   3. Client-side JS handles these before WebSocket send');
  console.log('   4. Capture tool filtered out some messages');
  console.log('');
  console.log('📌 What WAS captured:');
  for (const [name, count] of byInteraction.entries()) {
    console.log(`   - ${name} (${count}x)`);
  }
  console.log('');
  console.log('🎯 Recommendation:');
  console.log('   Run a NEW focused capture session:');
  console.log('   1. Open ONLY Customer Card (Page 21)');
  console.log('   2. Wait 5 seconds (let page fully load)');
  console.log('   3. Click ONLY "Edit" button');
  console.log('   4. Wait 2 seconds');
  console.log('   5. Change ONLY "Name" field');
  console.log('   6. Wait 2 seconds');
  console.log('   7. Stop capture');
  console.log('');
} else {
  console.log('✅ Success! Found target interactions:');
  if (hasChangeField) {
    console.log(`   - ChangeField: ${byInteraction.get('ChangeField')}x`);
  }
  if (hasInvokeAction) {
    console.log(`   - InvokeAction: ${byInteraction.get('InvokeAction')}x`);
  }
  console.log('');
}
