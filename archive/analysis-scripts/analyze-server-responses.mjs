/**
 * Analyze server responses from WebSocket capture
 * Look for formId declarations and LoadForm instructions
 */

import { readFileSync } from 'fs';

const allFrames = JSON.parse(readFileSync('websocket-cdp-capture.json', 'utf-8'));

// Filter received frames only
const receivedFrames = allFrames.filter(frame => frame.direction === 'received');

console.log(`\n${'═'.repeat(80)}`);
console.log(`  Server Response Analysis`);
console.log(`  Total frames: ${allFrames.length}`);
console.log(`  Received frames: ${receivedFrames.length}`);
console.log(`${'═'.repeat(80)}\n`);

// Group by WebSocket URL (session)
const sessionFrames = new Map();
receivedFrames.forEach(frame => {
  const url = frame.url || 'unknown';
  if (!sessionFrames.has(url)) {
    sessionFrames.set(url, []);
  }
  sessionFrames.get(url).push(frame);
});

console.log(`Sessions found: ${sessionFrames.size}\n`);

// Analyze each session
let sessionIndex = 1;
for (const [url, frames] of sessionFrames) {
  const shortUrl = url.substring(0, 50) + '...';
  console.log(`${'─'.repeat(80)}`);
  console.log(`Session ${sessionIndex}: ${shortUrl}`);
  console.log(`Received frames: ${frames.length}`);
  console.log(`${'─'.repeat(80)}\n`);

  // Look for frames with formId references
  frames.forEach((frame, i) => {
    const payload = frame.payload;
    if (!payload) return;

    // Look for result/response patterns
    if (payload.result || payload.method) {
      const hasFormId = JSON.stringify(payload).includes('formId') ||
                        JSON.stringify(payload).includes('FormId') ||
                        JSON.stringify(payload).includes('ServerId');

      if (hasFormId) {
        console.log(`  [${i + 1}] Frame at ${frame.iso}`);
        console.log(`      Method: ${payload.method || 'response'}`);
        console.log(`      Has formId references: YES`);

        // Try to extract formId references
        const payloadStr = JSON.stringify(payload, null, 2);
        const lines = payloadStr.split('\n');
        const formIdLines = lines.filter(line =>
          line.includes('formId') ||
          line.includes('FormId') ||
          line.includes('ServerId')
        );

        if (formIdLines.length > 0 && formIdLines.length < 50) {
          console.log(`      FormId references:`);
          formIdLines.slice(0, 10).forEach(line => {
            console.log(`        ${line.trim()}`);
          });
          if (formIdLines.length > 10) {
            console.log(`        ... and ${formIdLines.length - 10} more`);
          }
        }
        console.log();
      }
    }
  });

  sessionIndex++;
}

// Look for specific patterns in first session (Page 22)
console.log(`\n${'═'.repeat(80)}`);
console.log(`  Detailed Analysis of First Session (Page 22)`);
console.log(`${'═'.repeat(80)}\n`);

const firstSession = Array.from(sessionFrames.values())[0];
if (firstSession) {
  // Look for responses that might contain LoadForm instructions
  const potentialLoadFormInstructions = firstSession.filter(frame => {
    const payloadStr = JSON.stringify(frame.payload || {});
    return payloadStr.includes('LoadForm') ||
           payloadStr.includes('265') || // Known formIds from our capture
           payloadStr.includes('264') ||
           payloadStr.includes('267') ||
           payloadStr.includes('268');
  });

  console.log(`Frames mentioning LoadForm or known formIds: ${potentialLoadFormInstructions.length}\n`);

  potentialLoadFormInstructions.slice(0, 3).forEach((frame, i) => {
    console.log(`[${i + 1}] ${frame.iso}`);
    console.log(`Payload snippet:`);
    const snippet = JSON.stringify(frame.payload, null, 2).substring(0, 500);
    console.log(snippet);
    console.log('...\n');
  });
}
