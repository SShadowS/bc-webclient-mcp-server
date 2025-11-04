/**
 * Analyze Enhanced BC Capture
 *
 * Analyzes both WebSocket and HTTP captures to find field changes and action invocations.
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';

const WS_FILE = 'captured-websocket.json';
const HTTP_FILE = 'captured-http.json';

console.log('═══════════════════════════════════════════════════════════');
console.log('  Enhanced BC Capture Analysis');
console.log('  WebSocket + HTTP Traffic');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// ============================================================
// Load Capture Files
// ============================================================

let wsCaptures = [];
let httpCaptures = [];

if (existsSync(WS_FILE)) {
  wsCaptures = JSON.parse(readFileSync(WS_FILE, 'utf8'));
  console.log(`✓ Loaded ${WS_FILE}: ${wsCaptures.length} messages`);
} else {
  console.log(`⚠️  ${WS_FILE} not found`);
}

if (existsSync(HTTP_FILE)) {
  httpCaptures = JSON.parse(readFileSync(HTTP_FILE, 'utf8'));
  console.log(`✓ Loaded ${HTTP_FILE}: ${httpCaptures.length} requests`);
} else {
  console.log(`⚠️  ${HTTP_FILE} not found`);
}

if (wsCaptures.length === 0 && httpCaptures.length === 0) {
  console.log('');
  console.log('❌ No capture files found!');
  console.log('');
  console.log('Run the capture script first:');
  console.log('  node capture-all-traffic.mjs');
  console.log('');
  process.exit(1);
}

console.log('');

// ============================================================
// WebSocket Analysis
// ============================================================

if (wsCaptures.length > 0) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📡 WEBSOCKET ANALYSIS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Direction breakdown
  const byDirection = { sent: 0, received: 0 };
  for (const msg of wsCaptures) {
    byDirection[msg.direction]++;
  }

  console.log('By direction:');
  console.log(`  Sent:     ${byDirection.sent}`);
  console.log(`  Received: ${byDirection.received}`);
  console.log('');

  // Extract interactions from Invoke messages
  const allInteractions = [];

  for (const msg of wsCaptures) {
    if (msg.payload?.method === 'Invoke') {
      const params = Array.isArray(msg.payload.params) ? msg.payload.params[0] : msg.payload.params;
      const interactions = params?.interactionsToInvoke || [];

      for (const int of interactions) {
        allInteractions.push({
          ...int,
          messageDirection: msg.direction,
          timestamp: msg.timestamp,
          iso: msg.iso,
        });
      }
    }
  }

  console.log(`Interactions extracted: ${allInteractions.length}`);
  console.log(`  From sent messages: ${allInteractions.filter(i => i.messageDirection === 'sent').length}`);
  console.log(`  From received messages: ${allInteractions.filter(i => i.messageDirection === 'received').length}`);
  console.log('');

  // Group by interaction name
  const byName = new Map();
  for (const int of allInteractions) {
    const key = `${int.interactionName} (${int.messageDirection})`;
    byName.set(key, (byName.get(key) || 0) + 1);
  }

  if (byName.size > 0) {
    console.log('Interactions by type:');
    for (const [name, count] of Array.from(byName.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${name}: ${count}`);
    }
    console.log('');
  }

  // Search for target interactions
  const changeFieldInteractions = allInteractions.filter(i => i.interactionName === 'ChangeField');
  const invokeActionInteractions = allInteractions.filter(i => i.interactionName === 'InvokeAction');

  console.log('🎯 Target Interactions:');
  console.log(`  ChangeField: ${changeFieldInteractions.length}`);
  console.log(`  InvokeAction: ${invokeActionInteractions.length}`);
  console.log('');

  // Show examples if found
  if (changeFieldInteractions.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 ChangeField Examples:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    for (let i = 0; i < Math.min(3, changeFieldInteractions.length); i++) {
      const int = changeFieldInteractions[i];
      console.log(`Example ${i + 1}:`);
      console.log(`  Direction: ${int.messageDirection}`);
      console.log(`  Time: ${int.iso}`);
      console.log(`  Interaction:`, JSON.stringify(int, null, 2).split('\n').slice(1, -1).join('\n  '));
      console.log('');
    }
  }

  if (invokeActionInteractions.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔘 InvokeAction Examples:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    for (let i = 0; i < Math.min(3, invokeActionInteractions.length); i++) {
      const int = invokeActionInteractions[i];
      console.log(`Example ${i + 1}:`);
      console.log(`  Direction: ${int.messageDirection}`);
      console.log(`  Time: ${int.iso}`);
      console.log(`  Interaction:`, JSON.stringify(int, null, 2).split('\n').slice(1, -1).join('\n  '));
      console.log('');
    }
  }

  // Keyword search in all WebSocket messages
  const keywords = ['ChangeField', 'InvokeAction', 'field', 'Field', 'value', 'Value', 'action', 'Action'];
  const foundKeywords = new Map();

  for (const msg of wsCaptures) {
    const text = JSON.stringify(msg.payload || {});
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        foundKeywords.set(keyword, (foundKeywords.get(keyword) || 0) + 1);
      }
    }
  }

  if (foundKeywords.size > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 Keyword Search (WebSocket):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    for (const [keyword, count] of Array.from(foundKeywords.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  "${keyword}": ${count} messages`);
    }
    console.log('');
  }
}

// ============================================================
// HTTP Analysis
// ============================================================

if (httpCaptures.length > 0) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌐 HTTP ANALYSIS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Method breakdown
  const byMethod = new Map();
  for (const req of httpCaptures) {
    byMethod.set(req.method, (byMethod.get(req.method) || 0) + 1);
  }

  console.log('By method:');
  for (const [method, count] of byMethod.entries()) {
    console.log(`  ${method}: ${count}`);
  }
  console.log('');

  // Status code breakdown
  const byStatus = new Map();
  for (const req of httpCaptures) {
    if (req.responseStatus !== undefined) {
      byStatus.set(req.responseStatus, (byStatus.get(req.responseStatus) || 0) + 1);
    }
  }

  if (byStatus.size > 0) {
    console.log('By status code:');
    for (const [status, count] of Array.from(byStatus.entries()).sort((a, b) => a - b)) {
      console.log(`  ${status}: ${count}`);
    }
    console.log('');
  }

  // Search for field-related HTTP requests
  const fieldUpdates = httpCaptures.filter(req => {
    const url = req.url.toLowerCase();
    const postData = JSON.stringify(req.postDataParsed || req.postData || '').toLowerCase();
    const responseBody = JSON.stringify(req.responseBody || '').toLowerCase();

    return (
      postData.includes('field') ||
      postData.includes('name') ||
      postData.includes('value') ||
      url.includes('field') ||
      url.includes('update') ||
      url.includes('patch') ||
      responseBody.includes('field')
    );
  });

  console.log(`🎯 Field-related HTTP requests: ${fieldUpdates.length}`);
  console.log('');

  if (fieldUpdates.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Field-related HTTP Examples:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    for (let i = 0; i < Math.min(3, fieldUpdates.length); i++) {
      const req = fieldUpdates[i];
      console.log(`Example ${i + 1}:`);
      console.log(`  Method: ${req.method}`);
      console.log(`  URL: ${req.url}`);
      console.log(`  Status: ${req.responseStatus} ${req.responseStatusText || ''}`);

      if (req.postDataParsed) {
        console.log(`  Request Body (parsed):`);
        const bodyStr = JSON.stringify(req.postDataParsed, null, 2);
        const lines = bodyStr.split('\n');
        for (const line of lines.slice(0, 10)) {
          console.log(`    ${line}`);
        }
        if (lines.length > 10) console.log(`    ... (${lines.length - 10} more lines)`);
      } else if (req.postData) {
        console.log(`  Request Body: ${req.postData.substring(0, 200)}${req.postData.length > 200 ? '...' : ''}`);
      }

      if (req.responseBody) {
        console.log(`  Response Body:`);
        const bodyStr = JSON.stringify(req.responseBody, null, 2);
        const lines = bodyStr.split('\n');
        for (const line of lines.slice(0, 10)) {
          console.log(`    ${line}`);
        }
        if (lines.length > 10) console.log(`    ... (${lines.length - 10} more lines)`);
      }

      console.log('');
    }
  }

  // Keyword search in HTTP
  const httpKeywords = ['ChangeField', 'InvokeAction', 'field', 'action', 'Name', 'value'];
  const foundHttpKeywords = new Map();

  for (const req of httpCaptures) {
    const text = JSON.stringify(req).toLowerCase();
    for (const keyword of httpKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        foundHttpKeywords.set(keyword, (foundHttpKeywords.get(keyword) || 0) + 1);
      }
    }
  }

  if (foundHttpKeywords.size > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 Keyword Search (HTTP):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    for (const [keyword, count] of Array.from(foundHttpKeywords.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  "${keyword}": ${count} requests`);
    }
    console.log('');
  }
}

// ============================================================
// Summary
// ============================================================

console.log('═══════════════════════════════════════════════════════════');
console.log('📋 SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const hasChangeField = wsCaptures.some(msg => {
  const text = JSON.stringify(msg.payload || {});
  return text.includes('ChangeField');
});

const hasInvokeAction = wsCaptures.some(msg => {
  const text = JSON.stringify(msg.payload || {});
  return text.includes('InvokeAction');
});

const hasFieldInHttp = httpCaptures.some(req => {
  const text = JSON.stringify(req).toLowerCase();
  return text.includes('field') || text.includes('name') || text.includes('value');
});

if (hasChangeField || hasInvokeAction) {
  console.log('✅ SUCCESS! Found target interactions in WebSocket traffic!');
  console.log('');
  if (hasChangeField) console.log('  ✓ ChangeField interactions detected');
  if (hasInvokeAction) console.log('  ✓ InvokeAction interactions detected');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review the examples above');
  console.log('  2. Compare with tool implementations:');
  console.log('     - execute-action-tool.ts (InvokeAction)');
  console.log('     - update-field-tool.ts (ChangeField)');
  console.log('  3. Update tools if protocols differ');
  console.log('');
} else if (hasFieldInHttp) {
  console.log('⚠️  Target interactions NOT found in WebSocket');
  console.log('');
  console.log('However, field-related HTTP traffic was detected!');
  console.log('BC may be using HTTP POST/PUT/PATCH for field updates.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review HTTP examples above');
  console.log('  2. Determine if BC uses HTTP instead of WebSocket for updates');
  console.log('  3. Consider implementing HTTP-based field update mechanism');
  console.log('');
} else {
  console.log('⚠️  Target interactions NOT found in either WebSocket or HTTP');
  console.log('');
  console.log('Possible reasons:');
  console.log('  1. Actions were not performed during capture');
  console.log('  2. Timing issue - messages sent outside capture window');
  console.log('  3. BC uses different interaction names');
  console.log('  4. BC batches interactions differently');
  console.log('');
  console.log('Recommendations:');
  console.log('  1. Run a new capture session');
  console.log('  2. Ensure you wait 2 seconds between each action');
  console.log('  3. Wait 5 seconds after last action before stopping');
  console.log('  4. Focus on ONE action at a time:');
  console.log('     - Session 1: Only change "Name" field');
  console.log('     - Session 2: Only click "Edit" button');
  console.log('');
}

// Show what was captured
console.log('What was captured:');
if (wsCaptures.length > 0) {
  console.log(`  ✓ ${wsCaptures.length} WebSocket messages (${byDirection.sent} sent, ${byDirection.received} received)`);
}
if (httpCaptures.length > 0) {
  console.log(`  ✓ ${httpCaptures.length} HTTP requests`);
}
console.log('');
